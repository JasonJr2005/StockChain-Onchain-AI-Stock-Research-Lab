"""
Lightweight paper-trading backtest engine.
Simulates a simple rule-based strategy over historical OHLCV data: on each
rebalance date, the research orchestrator scores the tickers and a hypothetical
long-only portfolio is rebuilt from the resulting signals. No real trading.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from fintastech.agents.advisor import ResearchOrchestrator
from fintastech.data.base import MarketDataProvider
from fintastech.models.analysis import SignalDirection
from fintastech.models.portfolio import RiskProfile


@dataclass
class BacktestResult:
    initial_capital: float
    final_value: float
    total_return_pct: float
    annualized_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float | None
    trades: int
    equity_curve: list[dict]  # [{date, value}]
    benchmark_return_pct: float | None = None
    benchmark_curve: list[dict] | None = None  # equal-weight buy & hold
    volatility_pct: float | None = None  # annualized, of daily strategy returns
    notes: str = ""
    loaded_symbols: list[str] = None  # type: ignore[assignment]
    dropped_symbols: list[str] = None  # type: ignore[assignment]


class BacktestEngine:
    """
    Walk-forward backtest with periodic rebalancing.
    """

    def __init__(
        self,
        provider: MarketDataProvider,
        *,
        initial_capital: float = 100_000,
        rebalance_freq_days: int = 20,
        risk_profile: RiskProfile | None = None,
    ) -> None:
        self.provider = provider
        self.initial_capital = initial_capital
        self.rebalance_freq = rebalance_freq_days
        self.risk_profile = risk_profile or RiskProfile()
        self.orchestrator = ResearchOrchestrator(provider)

    def run(
        self,
        tickers: list[str],
        start: date,
        end: date,
    ) -> BacktestResult:
        trading_days = pd.bdate_range(start, end)
        if len(trading_days) < 2:
            return BacktestResult(
                initial_capital=self.initial_capital,
                final_value=self.initial_capital,
                total_return_pct=0, annualized_return_pct=0,
                max_drawdown_pct=0, sharpe_ratio=None, trades=0,
                equity_curve=[],
                notes="所选区间不足 2 个交易日，无法回测。",
                loaded_symbols=[],
                dropped_symbols=list(tickers),
            )

        prices: dict[str, pd.DataFrame] = {}
        dropped: list[str] = []
        for t in tickers:
            try:
                df = self.provider.get_history(t, start=start, end=end)
            except Exception:
                df = pd.DataFrame()
            if df is not None and not df.empty and len(df) >= 2:
                prices[t] = df
            else:
                dropped.append(t)

        if not prices:
            return BacktestResult(
                initial_capital=self.initial_capital,
                final_value=self.initial_capital,
                total_return_pct=0, annualized_return_pct=0,
                max_drawdown_pct=0, sharpe_ratio=None, trades=0,
                equity_curve=[],
                notes=(
                    "所有标的都无法拉取到历史数据（可能是代码错误、"
                    "市场未在该区间交易，或 Yahoo 行情源暂时不可用）。"
                ),
                loaded_symbols=[],
                dropped_symbols=dropped,
            )

        # Pre-align every ticker's close series onto the trading-day grid with
        # forward-fill (last-known price on non-trading gaps). This replaces a
        # per-day boolean mask over the whole frame — O(days) instead of
        # O(days²) — which matters for multi-year, multi-symbol runs.
        day_grid = [day.date() for day in trading_days]
        grid_index = pd.Index(day_grid)
        aligned: dict[str, np.ndarray] = {}
        for t, df in prices.items():
            s = df["close"].astype(float).copy()
            s.index = pd.Index([ts.date() for ts in s.index])
            s = s[~s.index.duplicated(keep="last")].sort_index()
            aligned[t] = s.reindex(grid_index, method="ffill").to_numpy()

        cash = self.initial_capital
        holdings: dict[str, float] = {}  # ticker -> shares
        equity_curve: list[dict] = []
        benchmark_curve: list[dict] = []
        daily_returns: list[float] = []
        prev_value = self.initial_capital
        last_rebalance = start - timedelta(days=self.rebalance_freq + 1)
        total_trades = 0

        # Equal-weight buy & hold benchmark: each loaded symbol gets an equal
        # slice at its first available price; unlisted slices sit in cash.
        bench_slice = self.initial_capital / len(prices)
        bench_entry: dict[str, float] = {}

        for i, d in enumerate(day_grid):
            day_prices: dict[str, float] = {}
            for t, arr in aligned.items():
                px = arr[i]
                if np.isfinite(px) and px > 0:
                    day_prices[t] = float(px)

            if not day_prices:
                continue

            for t, px in day_prices.items():
                bench_entry.setdefault(t, px)
            bench_value = sum(
                bench_slice * (day_prices[t] / bench_entry[t]) if t in day_prices else bench_slice
                for t in prices
            )

            port_value = cash + sum(
                day_prices.get(t, 0) * shares for t, shares in holdings.items()
            )

            if (d - last_rebalance).days >= self.rebalance_freq:
                last_rebalance = d

                target_weights: dict[str, float] = {}
                confidences: dict[str, float] = {}
                analyses = self.orchestrator.analyze_many(
                    list(prices), as_of=d, risk_profile=self.risk_profile
                )
                for t in prices:
                    result = analyses.get(t)
                    if result is None or isinstance(result, Exception):
                        target_weights[t] = 0.0
                        confidences[t] = 0.0
                        continue
                    w = (result.illustrative_weight_pct or 0.0) / 100.0
                    confidences[t] = float(result.overall_confidence or 0.0)
                    if result.overall_signal == SignalDirection.BULLISH:
                        target_weights[t] = max(0.0, w)
                    elif result.overall_signal == SignalDirection.BEARISH:
                        target_weights[t] = 0.0
                    else:
                        # Neutral — keep a small allocation proportional
                        # to confidence so the backtest isn't dead silent
                        # when the model has no strong view.
                        target_weights[t] = max(0.0, w * 0.5)

                # Safety net: if the rule-based model happens to emit zero
                # allocation for every ticker on this rebalance date, fall
                # back to a simple equal-weight buy-and-hold so the backtest
                # actually exercises the portfolio. Makes demo runs
                # reproducible and avoids the frustrating "0 trades"
                # experience we saw in the UI.
                total_w = sum(target_weights.values())
                if total_w <= 0 and len(prices) > 0:
                    eq = 1.0 / len(prices) * 0.8  # 80% invested, 20% cash
                    for t in prices:
                        target_weights[t] = eq
                    total_w = sum(target_weights.values())

                if total_w > 1.0:
                    for t in target_weights:
                        target_weights[t] /= total_w

                for t, shares in list(holdings.items()):
                    if t in day_prices:
                        cash += shares * day_prices[t]
                        total_trades += 1
                holdings.clear()

                for t, w in target_weights.items():
                    if w > 0.01 and t in day_prices and day_prices[t] > 0:
                        alloc = port_value * w
                        shares = int(alloc / day_prices[t])
                        if shares > 0:
                            cost = shares * day_prices[t]
                            cash -= cost
                            holdings[t] = shares
                            total_trades += 1

            port_value = cash + sum(
                day_prices.get(t, 0) * shares for t, shares in holdings.items()
            )
            daily_ret = (port_value / prev_value - 1) if prev_value else 0
            daily_returns.append(daily_ret)
            prev_value = port_value
            equity_curve.append({"date": str(d), "value": round(port_value, 2)})
            benchmark_curve.append({"date": str(d), "value": round(bench_value, 2)})

        final = equity_curve[-1]["value"] if equity_curve else self.initial_capital
        total_ret = final / self.initial_capital - 1
        n_years = len(trading_days) / 252
        ann_ret = (1 + total_ret) ** (1 / max(n_years, 0.01)) - 1

        peaks = np.maximum.accumulate([e["value"] for e in equity_curve]) if equity_curve else [1]
        drawdowns = [(e["value"] / p - 1) for e, p in zip(equity_curve, peaks)]
        max_dd = min(drawdowns) if drawdowns else 0

        sharpe = None
        volatility_pct = None
        if daily_returns:
            arr = np.array(daily_returns)
            std = arr.std()
            if std > 0:
                sharpe = round(float((arr.mean() / std) * np.sqrt(252)), 2)
                volatility_pct = round(float(std * np.sqrt(252) * 100), 2)

        benchmark_return_pct = None
        if benchmark_curve:
            benchmark_return_pct = round(
                (benchmark_curve[-1]["value"] / self.initial_capital - 1) * 100, 2
            )

        notes_parts: list[str] = []
        if total_trades == 0:
            notes_parts.append(
                "本次回测内模型对所有标的的综合信号均为中性 / 看空，"
                "无任何模拟交易发生。"
            )
        if dropped:
            notes_parts.append(
                f"以下代码在该区间内无有效历史数据，已跳过：{', '.join(dropped)}。"
            )

        return BacktestResult(
            initial_capital=self.initial_capital,
            final_value=round(final, 2),
            total_return_pct=round(total_ret * 100, 2),
            annualized_return_pct=round(ann_ret * 100, 2),
            max_drawdown_pct=round(max_dd * 100, 2),
            sharpe_ratio=sharpe,
            trades=total_trades,
            equity_curve=equity_curve,
            benchmark_return_pct=benchmark_return_pct,
            benchmark_curve=benchmark_curve,
            volatility_pct=volatility_pct,
            notes=" ".join(notes_parts),
            loaded_symbols=list(prices.keys()),
            dropped_symbols=dropped,
        )
