"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AnalysisResult, HistoryPeriod, PriceHistory } from "@/lib/api";
import { analyzeSymbol, getHistory, rebalanceSimulation } from "@/lib/api";
import SignalBadge from "@/components/SignalBadge";
import RiskGauge from "@/components/RiskGauge";
import AnalystPanel from "@/components/AnalystPanel";
import ActionCard from "@/components/ActionCard";
import StockSearch from "@/components/StockSearch";
import LineAreaChart from "@/components/LineAreaChart";
import PageHeader from "@/components/PageHeader";
import { currencySymbol, fmtPct, fmtPrice, inferCurrency } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

const RISK_KEY = "fintastech.risk.v1";

const CORE_ANALYSTS = [
  "technical_analyst",
  "fundamental_analyst",
  "valuation_analyst",
  "sentiment_analyst",
];

const PERIODS: HistoryPeriod[] = ["1mo", "3mo", "6mo", "1y", "2y"];
const PERIOD_LABEL: Record<HistoryPeriod, string> = {
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y": "1Y",
  "2y": "2Y",
};

export default function AnalysisView() {
  const { t } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("symbol") ?? "AAPL";

  const [symbol, setSymbol] = useState(initial);
  const [risk, setRisk] = useState("moderate");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingToSim, setAddingToSim] = useState(false);
  const [fetchErr, setFetchErr] = useState<string>("");

  // Price-history chart state
  const [period, setPeriod] = useState<HistoryPeriod>("6mo");
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Pick up the user's persisted risk choice from /settings (if any).
  useEffect(() => {
    try {
      const r = localStorage.getItem(RISK_KEY);
      if (r) setRisk(r);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setFetchErr("");
    analyzeSymbol(symbol, risk)
      .then((r) => {
        setResult(r);
      })
      .catch((e) => {
        setResult(null);
        setFetchErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [symbol, risk]);

  useEffect(() => {
    setHistoryLoading(true);
    getHistory(symbol, period)
      .then(setHistory)
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [symbol, period]);

  const currency = result?.currency || inferCurrency(symbol);
  const sym = currencySymbol(currency);

  const coreSignals =
    result?.signals?.filter((s) => CORE_ANALYSTS.includes(s.analyst)) ?? [];
  const masterSignals =
    result?.signals?.filter((s) => !CORE_ANALYSTS.includes(s.analyst)) ?? [];

  const bars = history?.bars ?? [];
  const periodChangePct =
    bars.length > 1 ? (bars[bars.length - 1].close / bars[0].close - 1) * 100 : null;

  async function addToSimulation() {
    setAddingToSim(true);
    try {
      await rebalanceSimulation([symbol], risk);
      router.push("/simulation");
    } catch {
      setAddingToSim(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-10">
      <PageHeader
        tag={t("analysis.tag")}
        title={t("analysis.title")}
        subtitle={t("analysis.subtitle")}
      >
        <StockSearch
          onSelect={(sym) => setSymbol(sym)}
          placeholder="AAPL · 0700.HK · 600519.SS …"
        />
        <select
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="input-base !w-auto min-w-[9rem] !py-2 font-medium"
        >
          <option value="conservative">{t("risk.conservative")}</option>
          <option value="moderate">{t("risk.moderate")}</option>
          <option value="aggressive">{t("risk.aggressive")}</option>
        </select>
      </PageHeader>

      {loading && (
        <div className="surface flex h-72 flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">
            {t("analysis.loading", { sym: symbol })}
          </p>
        </div>
      )}

      {!loading && fetchErr && (
        <div className="surface p-10 text-center">
          <p className="text-loss">{t("analysis.fetchFail", { msg: fetchErr })}</p>
          <p className="mt-2 text-sm text-muted">{t("analysis.fetchFail.hint")}</p>
        </div>
      )}

      {!loading && !fetchErr && result?.error && (
        <div className="surface p-10 text-center">
          <p className="text-loss">
            {t("analysis.symbolFail", { sym: symbol, msg: result.error })}
          </p>
          <p className="mt-2 text-sm text-muted">{t("analysis.symbolFail.hint")}</p>
        </div>
      )}

      {!loading && !fetchErr && result && !result.error && (
        <div className="space-y-8">
          {/* Hero */}
          <div className="surface flex flex-wrap items-start gap-8 p-7">
            <div className="flex-1">
              <div className="mb-1.5 flex items-center gap-3">
                <h2 className="font-mono text-3xl font-semibold tracking-tight">
                  {result.symbol}
                </h2>
                <SignalBadge signal={result.overall_signal} size="lg" />
                <span className="chip chip-neutral">
                  {currency}
                  {result.exchange ? ` · ${result.exchange}` : ""}
                </span>
              </div>
              <p className="text-sm text-muted">{result.name}</p>
              <p className="mt-5 font-mono text-4xl font-semibold tabular">
                {result.current_price > 0 ? (
                  fmtPrice(result.current_price, currency)
                ) : (
                  <span className="text-dim">—</span>
                )}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  onClick={addToSimulation}
                  disabled={addingToSim || result.current_price === 0}
                  className="btn-primary"
                >
                  {addingToSim ? t("analysis.addingToSim") : t("analysis.addToSim")}
                </button>
                <a href="/simulation" className="btn-ghost">
                  {t("analysis.viewSim")}
                </a>
              </div>
            </div>
            <ActionCard
              signal={result.overall_signal}
              weightPct={result.illustrative_weight_pct}
            />
          </div>

          {/* Price chart */}
          <div className="surface overflow-hidden p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h4 className="text-xs font-medium uppercase tracking-wider text-dim">
                  {t("analysis.chart.title")}
                </h4>
                {periodChangePct != null && (
                  <span
                    className={`font-mono text-[11px] tabular ${
                      periodChangePct >= 0 ? "text-gain" : "text-loss"
                    }`}
                  >
                    {t("analysis.chart.range", { pct: fmtPct(periodChangePct) })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-3 text-[11px] text-muted sm:inline-flex">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-accent" /> {t("analysis.chart.close")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-[2px] w-3 bg-[#fbbf24]" /> MA20
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-[2px] w-3 bg-[#38bdf8]" /> MA50
                  </span>
                </span>
                <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-2.5 py-1 font-mono text-[11px] transition ${
                        period === p
                          ? "bg-[rgba(139,92,246,0.14)] text-accent"
                          : "text-dim hover:text-white"
                      }`}
                    >
                      {PERIOD_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {historyLoading && bars.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-xs text-dim">
                {t("analysis.chart.loading")}
              </div>
            ) : bars.length > 1 ? (
              <LineAreaChart
                data={bars.map((b) => ({ x: b.date, y: b.close }))}
                primaryLabel={t("analysis.chart.close")}
                overlays={[
                  {
                    label: "MA20",
                    color: "#fbbf24",
                    values: bars.map((b) => b.ma20),
                  },
                  {
                    label: "MA50",
                    color: "#38bdf8",
                    values: bars.map((b) => b.ma50),
                  },
                ]}
                formatY={(v) => fmtPrice(v, currency)}
                className="h-64"
              />
            ) : (
              <div className="flex h-56 items-center justify-center text-xs text-dim">
                {t("analysis.chart.empty")}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="surface flex flex-col items-center justify-center p-6">
              <div className="relative flex items-center justify-center">
                <svg width={128} height={128} className="-rotate-90">
                  <circle
                    cx={64}
                    cy={64}
                    r={54}
                    fill="none"
                    strokeWidth={6}
                    className="stroke-white/5"
                  />
                  <circle
                    cx={64}
                    cy={64}
                    r={54}
                    fill="none"
                    strokeWidth={6}
                    strokeDasharray={2 * Math.PI * 54}
                    strokeDashoffset={2 * Math.PI * 54 * (1 - result.overall_confidence)}
                    strokeLinecap="round"
                    className={`transition-all duration-700 ${
                      result.overall_confidence > 0.6
                        ? "stroke-[#34d399]"
                        : result.overall_confidence > 0.3
                          ? "stroke-accent"
                          : "stroke-[var(--fg-dim)]"
                    }`}
                  />
                </svg>
                <span className="absolute font-mono text-2xl font-semibold tabular">
                  {Math.round(result.overall_confidence * 100)}%
                </span>
              </div>
              <span className="mt-3 text-[11px] uppercase tracking-wider text-dim">
                {t("analysis.confidenceLabel")}
              </span>
            </div>

            <div className="surface p-6">
              <h4 className="mb-4 text-xs font-medium uppercase tracking-wider text-dim">
                {t("analysis.riskTitle")}
              </h4>
              <RiskGauge score={result.risk_score} />
              <div className="mt-4 space-y-1.5 text-[12px] text-muted">
                {result.technical.volatility_pct != null && (
                  <Row
                    label={t("analysis.vol")}
                    value={`${Number(result.technical.volatility_pct).toFixed(1)}%`}
                  />
                )}
                <Row label={t("analysis.trendDir")} value={String(result.technical.trend || "—")} />
                <Row label={t("analysis.momentum")} value={String(result.technical.momentum || "—")} />
              </div>
            </div>

            <div className="surface p-6">
              <h4 className="mb-4 text-xs font-medium uppercase tracking-wider text-dim">
                {t("analysis.indicators")}
              </h4>
              <div className="space-y-1.5 text-[12px]">
                <Ind label="RSI (14)" value={result.technical.rsi} />
                <Ind label="MA10" value={result.technical.ma_short} prefix={sym} />
                <Ind label="MA50" value={result.technical.ma_long} prefix={sym} />
                <Ind label="MACD" value={result.technical.macd} precision={4} />
                <Ind
                  label={t("analysis.bollUpper")}
                  value={result.technical.bollinger_upper}
                  prefix={sym}
                />
                <Ind
                  label={t("analysis.bollLower")}
                  value={result.technical.bollinger_lower}
                  prefix={sym}
                />
              </div>
            </div>
          </div>

          {/* Core analysts */}
          <div>
            <h3 className="mb-4 text-base font-semibold tracking-tight">
              {t("analysis.coreAnalysts")}
            </h3>
            <AnalystPanel signals={coreSignals} />
          </div>

          {masterSignals.length > 0 && (
            <div>
              <h3 className="mb-4 text-base font-semibold tracking-tight">
                {t("analysis.masters")} ·{" "}
                <span className="text-muted">
                  {t("analysis.mastersCount", { n: masterSignals.length })}
                </span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {masterSignals.map((s) => (
                  <div key={s.analyst} className="surface p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium">{s.analyst_display}</span>
                      <SignalBadge signal={s.signal} size="sm" />
                      <span className="ml-auto text-[11px] text-dim">
                        {t("analysis.confidencePct", {
                          pct: Math.round(s.confidence * 100),
                        })}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-muted">
                      {s.reasoning}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="surface p-6">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-dim">
              {t("analysis.summaryTitle")}
            </h3>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-muted">
              {result.summary}
            </pre>
          </div>

          <p className="text-center text-[11px] text-dim">
            {result.disclaimer} · EDUCATIONAL USE ONLY · NOT INVESTMENT ADVICE
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{label}</span>
      <span className="font-mono tabular text-white">{value}</span>
    </div>
  );
}
function Ind({
  label,
  value,
  prefix = "",
  precision = 2,
}: {
  label: string;
  value: unknown;
  prefix?: string;
  precision?: number;
}) {
  const display =
    value != null ? `${prefix}${Number(value).toFixed(precision)}` : "—";
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{label}</span>
      <span className="font-mono tabular text-white">{display}</span>
    </div>
  );
}
