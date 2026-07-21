"""Research-signal endpoints — rule-based, paper-trading oriented, never an
investment recommendation. See DISCLAIMER.md."""

import math
from datetime import date, timedelta

from fastapi import APIRouter, Query

from fintastech.agents.advisor import ResearchOrchestrator
from fintastech.agents.masters import get_master_profiles
from fintastech.data.yahoo_provider import YahooFinanceProvider, currency_from_symbol
from fintastech.models.portfolio import RiskProfile, RiskTolerance

router = APIRouter()

_provider = YahooFinanceProvider()
_orchestrator = ResearchOrchestrator(_provider)

_HISTORY_RANGES: dict[str, int] = {
    "1mo": 31,
    "3mo": 92,
    "6mo": 183,
    "1y": 366,
    "2y": 731,
}


@router.get("/search")
def search_symbols(q: str = Query(..., min_length=1), limit: int = Query(10, le=20)) -> list[dict]:
    """Search tickers across US / HK / A-share markets (public data)."""
    return _provider.search_tickers(q, limit=limit)


@router.get("/masters")
def list_masters() -> list[dict]:
    """Return the roster of rule-based master-investor analyst modules."""
    return get_master_profiles()


@router.get("/analyze/{symbol}")
def analyze_symbol(
    symbol: str,
    risk_tolerance: RiskTolerance = Query(RiskTolerance.MODERATE),
) -> dict:
    """Full multi-module research signal bundle for one ticker.

    Output is descriptive (bullish/bearish/neutral + confidence + illustrative
    weight). This endpoint NEVER returns a buy/sell instruction. Errors never
    500 — instead we return a shaped object with an ``error`` field so the UI
    can render a friendly message.
    """
    profile = RiskProfile(tolerance=risk_tolerance)
    sym = symbol.upper()
    try:
        result = _orchestrator.analyze(sym, risk_profile=profile)
        return result.model_dump(mode="json")
    except Exception as exc:
        return {
            "symbol": sym,
            "name": sym,
            "current_price": 0.0,
            "currency": "USD",
            "exchange": "",
            "signals": [],
            "overall_signal": "neutral",
            "overall_confidence": 0.0,
            "summary": f"{sym}：分析失败（{exc}）。请检查代码是否正确或稍后重试。",
            "illustrative_weight_pct": 0.0,
            "risk_score": 0.5,
            "error": str(exc),
        }


@router.get("/batch-analyze")
def batch_analyze(
    symbols: str = Query("AAPL,MSFT,GOOGL,TSLA", description="逗号分隔的股票代码"),
    risk_tolerance: RiskTolerance = Query(RiskTolerance.MODERATE),
) -> list[dict]:
    """Analyze up to 20 tickers in one call (researched concurrently)."""
    profile = RiskProfile(tolerance=risk_tolerance)
    tickers = list(
        dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip())
    )[:20]
    analyses = _orchestrator.analyze_many(tickers, risk_profile=profile)
    results: list[dict] = []
    for t in tickers:
        r = analyses.get(t)
        if r is None or isinstance(r, Exception):
            results.append({"symbol": t, "error": str(r) if r else "analysis missing"})
        else:
            results.append(r.model_dump(mode="json"))
    return results


@router.get("/history/{symbol}")
def price_history(
    symbol: str,
    period: str = Query("6mo", description="1mo / 3mo / 6mo / 1y / 2y"),
) -> dict:
    """Daily OHLCV bars plus MA20 / MA50 overlays for charting.

    Public historical data only — served so the UI can draw a price chart
    next to the research signals. Errors never 500; an empty ``bars`` list
    plus an ``error`` field tells the UI to render a friendly message.
    """
    sym = symbol.upper().strip()
    days = _HISTORY_RANGES.get(period, _HISTORY_RANGES["6mo"])
    end = date.today()
    # Fetch extra lead-in bars so MA50 is well-defined from the first
    # visible day instead of ramping up from a 1-bar average.
    df = _provider.get_history(sym, start=end - timedelta(days=days + 90), end=end)
    if df.empty:
        return {"symbol": sym, "period": period, "bars": [], "error": "no_data"}

    close = df["close"].astype(float)
    ma20 = close.rolling(20, min_periods=20).mean()
    ma50 = close.rolling(50, min_periods=50).mean()

    cutoff = end - timedelta(days=days)
    bars: list[dict] = []
    for idx, row in df.iterrows():
        d = idx.date() if hasattr(idx, "date") else idx
        if d < cutoff:
            continue
        m20 = ma20.loc[idx]
        m50 = ma50.loc[idx]
        bars.append(
            {
                "date": str(d),
                "open": round(float(row["open"]), 4) if math.isfinite(row["open"]) else None,
                "high": round(float(row["high"]), 4) if math.isfinite(row["high"]) else None,
                "low": round(float(row["low"]), 4) if math.isfinite(row["low"]) else None,
                "close": round(float(row["close"]), 4),
                "volume": float(row["volume"]) if math.isfinite(row["volume"]) else 0.0,
                "ma20": round(float(m20), 4) if math.isfinite(m20) else None,
                "ma50": round(float(m50), 4) if math.isfinite(m50) else None,
            }
        )

    return {
        "symbol": sym,
        "period": period,
        "currency": currency_from_symbol(sym),
        "bars": bars,
    }
