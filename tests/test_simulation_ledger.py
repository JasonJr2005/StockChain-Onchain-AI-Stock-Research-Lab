"""Offline tests for the paper-trading ledger (mock market data only)."""

import json

from fintastech.agents.advisor import ResearchOrchestrator
from fintastech.data.mock_provider import MockMarketProvider
from fintastech.simulation.portfolio import OrderError, SimulatedPortfolio


def make_portfolio(tmp_path):
    provider = MockMarketProvider()
    return SimulatedPortfolio(
        storage_path=tmp_path / "sim.json",
        provider=provider,
        orchestrator=ResearchOrchestrator(provider),
    )


def test_manual_buy_sell_roundtrip(tmp_path) -> None:
    pf = make_portfolio(tmp_path)
    snap = pf.snapshot()
    assert snap["cash"] == 100_000.0

    resp = pf.market_buy("TESTA", notional=10_000)
    assert resp["ok"] is True
    state = resp["state"]
    assert state["cash"] < 100_000.0
    assert state["holdings"][0]["symbol"] == "TESTA"

    resp = pf.market_sell("TESTA", notional=5_000)
    assert resp["ok"] is True

    resp = pf.close_position("TESTA")
    assert resp["ok"] is True
    state = pf.snapshot()
    assert state["holdings"] == []
    # No fees / slippage in the simulator, so cash returns to the start value.
    assert abs(state["cash"] - 100_000.0) < 1.0


def test_orders_validate(tmp_path) -> None:
    pf = make_portfolio(tmp_path)
    try:
        pf.market_buy("TESTA", notional=10_000_000)
        raise AssertionError("expected OrderError for oversized order")
    except OrderError:
        pass
    try:
        pf.market_sell("TESTA", shares=1)
        raise AssertionError("expected OrderError for selling with no position")
    except OrderError:
        pass


def test_rebalance_produces_research_log(tmp_path) -> None:
    pf = make_portfolio(tmp_path)
    snap = pf.rebalance(["TESTA", "TESTB"])
    log = snap["research_signals"]
    assert {r["symbol"] for r in log} == {"TESTA", "TESTB"}
    for r in log:
        assert r["direction"] in {"bullish", "bearish", "neutral"}
        assert 0.0 <= r["confidence"] <= 1.0


def test_state_persists_atomically(tmp_path) -> None:
    pf = make_portfolio(tmp_path)
    pf.market_buy("TESTA", notional=1_000)

    raw = json.loads((tmp_path / "sim.json").read_text(encoding="utf-8"))
    assert raw["holdings"]["TESTA"]["shares"] > 0
    # No leftover temp files from the atomic-write path.
    assert list(tmp_path.glob("*.tmp")) == []

    reloaded = make_portfolio(tmp_path)
    assert reloaded.snapshot()["holdings"][0]["symbol"] == "TESTA"
