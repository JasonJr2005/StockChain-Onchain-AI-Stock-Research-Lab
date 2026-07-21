"""
ResearchOrchestrator — blends technical + fundamental + valuation + sentiment
+ 14 master-investor rule-based agents into a ComprehensiveAnalysis.

This module produces **research signals only** (bullish / bearish / neutral with
a confidence score). It never emits buy/sell recommendations or investment
advice. Any weights in the output are illustrative paper-trading allocations
intended solely for simulation and study.
"""

import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any

from fintastech.utils.cache import TTLCache


def _coerce_float(v: Any) -> float | None:
    """Best-effort conversion to a finite float, or ``None``.

    yfinance occasionally returns numeric fields as strings (e.g.
    ``"N/A"`` or ``"32.5%"``). Downstream analysts do arithmetic like
    ``benchmark - pe`` which blows up with ``int - str``. We centralize
    the defensive parse here so every analyst sees real floats only.
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("%", "")
        if not s or s.lower() in {"n/a", "none", "nan", "null", "-"}:
            return None
        try:
            f = float(s)
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


_NUMERIC_INFO_KEYS: tuple[str, ...] = (
    "market_cap", "pe_ratio", "forward_pe", "pb_ratio", "ps_ratio",
    "peg_ratio", "eps", "forward_eps", "roe", "roa",
    "debt_to_equity", "current_ratio", "profit_margin",
    "revenue_growth", "earnings_growth", "dividend_yield", "beta",
    "fifty_two_week_high", "fifty_two_week_low",
)

from fintastech.agents.fundamental import FundamentalAnalyst
from fintastech.agents.masters import ALL_MASTERS
from fintastech.agents.sentiment import SentimentAnalyst
from fintastech.agents.technical import TechnicalAnalyst
from fintastech.agents.valuation import ValuationAnalyst
from fintastech.data.base import MarketDataProvider
from fintastech.models.analysis import (
    AnalystSignal,
    ComprehensiveAnalysis,
    SignalDirection,
)
from fintastech.models.portfolio import RiskProfile, RiskTolerance
from fintastech.risk.limits import RiskLimits, clip_position_suggestion

_BASE_WEIGHT = {
    "technical_analyst": 0.15,
    "fundamental_analyst": 0.20,
    "valuation_analyst": 0.15,
    "sentiment_analyst": 0.10,
}
_MASTER_WEIGHT_EACH = 0.40 / 14  # remaining 40% shared among 14 masters

_RISK_CAPS: dict[RiskTolerance, float] = {
    RiskTolerance.CONSERVATIVE: 0.10,
    RiskTolerance.MODERATE: 0.20,
    RiskTolerance.AGGRESSIVE: 0.35,
}

_DIRECTION_CN = {
    SignalDirection.BULLISH: "看多",
    SignalDirection.BEARISH: "看空",
    SignalDirection.NEUTRAL: "中性",
}

# Upper bound on concurrent per-symbol research jobs. Each job is I/O-bound
# (Yahoo history + fundamentals), so a modest pool gives a near-linear speedup
# on multi-symbol requests without hammering the data source.
_MAX_RESEARCH_WORKERS = 8


class ResearchOrchestrator:
    """Runs every analyst module and aggregates their research signals.

    The output is a ``ComprehensiveAnalysis`` containing directional signals
    (bullish/bearish/neutral), a confidence, and an *illustrative* paper-trading
    weight. No buy/sell instruction is ever produced.
    """

    def __init__(self, provider: MarketDataProvider) -> None:
        self.provider = provider
        self.technical = TechnicalAnalyst()
        self.fundamental = FundamentalAnalyst()
        self.valuation = ValuationAnalyst()
        self.sentiment = SentimentAnalyst()
        # Live analysis results are cached briefly so a user clicking around
        # the UI (analysis page → simulation → vault) doesn't recompute the
        # same 18-analyst bundle several times a minute. Per-instance, because
        # two orchestrators may sit on different data providers. Backtests
        # (``as_of`` set) bypass this cache entirely.
        self._result_cache = TTLCache(ttl_seconds=120.0, max_entries=256)

    def analyze(
        self,
        symbol: str,
        *,
        as_of: date | None = None,
        risk_profile: RiskProfile | None = None,
        stock_info: dict[str, Any] | None = None,
    ) -> ComprehensiveAnalysis:
        profile = risk_profile or RiskProfile()

        # Short-lived result cache for *live* analysis only. Historical
        # (``as_of``) and caller-supplied-info runs always compute fresh.
        cache_key: str | None = None
        if as_of is None and stock_info is None:
            cache_key = f"{symbol.upper()}|{profile.tolerance.value}"
            cached = self._result_cache.get(cache_key)
            if cached is not None:
                return cached

        result = self._analyze_uncached(
            symbol, as_of=as_of, profile=profile, stock_info=stock_info
        )
        if cache_key is not None and result.current_price > 0:
            self._result_cache.set(cache_key, result)
        return result

    def analyze_many(
        self,
        symbols: list[str],
        *,
        as_of: date | None = None,
        risk_profile: RiskProfile | None = None,
        max_workers: int = _MAX_RESEARCH_WORKERS,
    ) -> dict[str, ComprehensiveAnalysis | Exception]:
        """Analyze several symbols concurrently.

        Research per symbol is I/O-bound (network fetches), so a small thread
        pool turns a 7-symbol watch-list from ~7 sequential round-trips into
        roughly one. Returns a mapping ``symbol -> analysis`` where a failed
        symbol maps to the raised exception instead (callers decide whether to
        surface or skip it) — one bad ticker never sinks the batch.
        """
        unique = list(dict.fromkeys(s.strip().upper() for s in symbols if s and s.strip()))
        results: dict[str, ComprehensiveAnalysis | Exception] = {}
        if not unique:
            return results
        workers = max(1, min(max_workers, len(unique)))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="research") as pool:
            futures = {
                pool.submit(
                    self.analyze, sym, as_of=as_of, risk_profile=risk_profile
                ): sym
                for sym in unique
            }
            for fut in as_completed(futures):
                sym = futures[fut]
                try:
                    results[sym] = fut.result()
                except Exception as exc:  # noqa: BLE001 — deliberately fail-soft
                    results[sym] = exc
        return results

    def _analyze_uncached(
        self,
        symbol: str,
        *,
        as_of: date | None,
        profile: RiskProfile,
        stock_info: dict[str, Any] | None,
    ) -> ComprehensiveAnalysis:
        end = as_of or date.today()
        ohlcv = self.provider.get_history(symbol, end=end)

        if ohlcv.empty:
            return ComprehensiveAnalysis(
                symbol=symbol,
                current_price=0.0,
                summary=f"{symbol}：未能获取到行情数据（可能是网络问题或代码不正确）。",
            )

        try:
            current_price = float(ohlcv["close"].astype(float).iloc[-1])
        except Exception:
            current_price = 0.0
        if not math.isfinite(current_price) or current_price <= 0:
            return ComprehensiveAnalysis(
                symbol=symbol,
                current_price=0.0,
                summary=f"{symbol}：收盘价数据无效，已跳过本轮分析。",
            )
        info = stock_info or {}

        if not info and hasattr(self.provider, "get_stock_info"):
            try:
                info = self.provider.get_stock_info(symbol)
            except Exception:
                info = {}

        # Sanitize every numeric info field so analysts never receive a string.
        # Non-numeric / unparseable values become ``None`` (treated as missing).
        for k in _NUMERIC_INFO_KEYS:
            if k in info:
                info[k] = _coerce_float(info.get(k))

        name = info.get("name", symbol)

        # ── core analysts ──
        tech_sig, tech_snap = self.technical.analyze(symbol, ohlcv)

        _INFO_TO_FUND = {
            "pe_ratio": "pe", "pb_ratio": "pb", "ps_ratio": "ps",
            "roe": "roe", "roa": "roa", "debt_to_equity": "debt_to_equity",
            "current_ratio": "current_ratio", "profit_margin": "profit_margin",
            "revenue_growth": "revenue_growth", "earnings_growth": "earnings_growth",
        }
        fund_kw: dict[str, Any] = {}
        for info_key, param_name in _INFO_TO_FUND.items():
            if info.get(info_key) is not None:
                fund_kw[param_name] = info[info_key]
        fund_kw["sector"] = info.get("sector", "default")
        fund_sig, fund_snap = self.fundamental.analyze(symbol, ohlcv, **fund_kw)

        val_kw: dict[str, Any] = {}
        if info.get("eps"):
            val_kw["eps"] = info["eps"]
        if info.get("earnings_growth"):
            val_kw["growth_rate"] = info["earnings_growth"]
        val_sig, val_snap = self.valuation.analyze(symbol, ohlcv, **val_kw)
        sent_sig = self.sentiment.analyze(symbol, ohlcv)

        signals: list[AnalystSignal] = [tech_sig, fund_sig, val_sig, sent_sig]

        # ── master investors ──
        for master in ALL_MASTERS:
            try:
                sig = master.analyze(symbol, ohlcv, info)
                signals.append(sig)
            except Exception:
                # Fail-soft: one misbehaving master must never block the
                # whole research pipeline. Record a NEUTRAL placeholder so
                # the UI still shows the row with an honest reason.
                try:
                    prof = master.profile
                    signals.append(
                        AnalystSignal(
                            analyst=prof.key,
                            analyst_display=f"{prof.icon} {prof.name_cn}",
                            signal=SignalDirection.NEUTRAL,
                            confidence=0.0,
                            reasoning="数据异常，暂无法评估",
                        )
                    )
                except Exception:
                    pass

        overall_signal, overall_conf = self._blend(signals)
        weight = self._illustrative_weight(overall_signal, overall_conf, profile)
        risk_score = self._risk_score(tech_snap, ohlcv)
        summary = self._narrative(
            symbol, name, current_price, overall_signal, overall_conf, signals, weight
        )

        return ComprehensiveAnalysis(
            symbol=symbol,
            name=name,
            current_price=current_price,
            currency=info.get("currency") or "USD",
            exchange=info.get("exchange") or "",
            signals=signals,
            technical=tech_snap,
            fundamental=fund_snap,
            valuation=val_snap,
            overall_signal=overall_signal,
            overall_confidence=round(overall_conf, 2),
            summary=summary,
            illustrative_weight_pct=round(weight * 100, 2),
            risk_score=round(risk_score, 2),
        )

    # ── internals ──

    @staticmethod
    def _blend(signals: list[AnalystSignal]) -> tuple[SignalDirection, float]:
        score, total_w = 0.0, 0.0
        for sig in signals:
            w = _BASE_WEIGHT.get(sig.analyst, _MASTER_WEIGHT_EACH)
            direction = {
                SignalDirection.BULLISH: 1.0,
                SignalDirection.BEARISH: -1.0,
                SignalDirection.NEUTRAL: 0.0,
            }[sig.signal]
            score += w * direction * sig.confidence
            total_w += w
        score /= total_w + 1e-10
        if score > 0.08:
            return SignalDirection.BULLISH, min(1.0, abs(score) * 2.5)
        elif score < -0.08:
            return SignalDirection.BEARISH, min(1.0, abs(score) * 2.5)
        return SignalDirection.NEUTRAL, 0.3

    @staticmethod
    def _illustrative_weight(signal, confidence, profile):
        cap = _RISK_CAPS.get(profile.tolerance, 0.20)
        if signal == SignalDirection.NEUTRAL:
            return 0.0
        if signal == SignalDirection.BEARISH:
            return 0.0  # paper simulator is long-only
        raw = confidence * cap
        return clip_position_suggestion(raw, RiskLimits(max_single_position_pct=cap))

    @staticmethod
    def _risk_score(tech, ohlcv):
        vol = (tech.volatility_pct or 20.0) / 100
        return min(1.0, vol / 0.5)

    @staticmethod
    def _narrative(symbol, name, price, signal, conf, signals, weight):
        header = (
            f"【{symbol} {name}】模型综合信号：{_DIRECTION_CN.get(signal, '中性')}"
            f"（置信度 {conf:.0%}）— 仅供研究与模拟盘学习，不构成任何交易指令。"
        )
        details = []
        for s in signals:
            d = _DIRECTION_CN.get(s.signal, "中性")
            details.append(
                f"  · {s.analyst_display}：{d}（{s.confidence:.0%}）— {s.reasoning}"
            )
        footer = (
            f"模拟组合示意权重约 {weight:.1%}（仅用于 paper-trading 演示）。"
            f"最新收盘价参考：{price:.2f}。"
        )
        return header + "\n" + "\n".join(details) + "\n" + footer


# --- Backwards-compat alias ------------------------------------------------
# Older callers (and a number of README/docs snippets) still reference
# ``InvestmentAdvisor``. We keep the name available but the class is semantically
# a *research* orchestrator — it has never emitted buy/sell instructions.
InvestmentAdvisor = ResearchOrchestrator
