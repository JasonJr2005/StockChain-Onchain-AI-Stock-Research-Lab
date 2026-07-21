"""Offline walk-forward backtest tests (mock market data only)."""

from datetime import date, timedelta

from fintastech.backtesting.engine import BacktestEngine
from fintastech.data.mock_provider import MockMarketProvider


def test_backtest_runs_offline() -> None:
    engine = BacktestEngine(
        MockMarketProvider(), initial_capital=50_000, rebalance_freq_days=20
    )
    end = date.today()
    result = engine.run(["TESTA", "TESTB"], start=end - timedelta(days=180), end=end)

    assert result.initial_capital == 50_000
    assert result.loaded_symbols == ["TESTA", "TESTB"]
    assert result.dropped_symbols == []
    assert len(result.equity_curve) > 60
    # Benchmark (equal-weight buy & hold) is aligned with the equity curve.
    assert len(result.benchmark_curve) == len(result.equity_curve)
    assert result.benchmark_return_pct is not None
    assert result.max_drawdown_pct <= 0
    assert result.equity_curve[0]["value"] > 0


def test_backtest_rejects_empty_window() -> None:
    engine = BacktestEngine(MockMarketProvider())
    day = date(2024, 1, 6)  # Saturday — no business days in the window
    result = engine.run(["TESTA"], start=day, end=day)
    assert result.trades == 0
    assert result.equity_curve == []
