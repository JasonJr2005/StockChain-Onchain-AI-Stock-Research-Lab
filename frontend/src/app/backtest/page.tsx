"use client";

import { useState } from "react";
import { runBacktest, type BacktestResponse } from "@/lib/api";
import StockSearch from "@/components/StockSearch";
import LineAreaChart from "@/components/LineAreaChart";
import PageHeader from "@/components/PageHeader";
import { fmtPct } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

export default function BacktestPage() {
  const { t } = useT();
  const [symbols, setSymbols] = useState<string[]>(["AAPL", "MSFT"]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capital, setCapital] = useState("100000");
  const [risk, setRisk] = useState("moderate");
  const [rebalDays, setRebalDays] = useState("20");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState("");

  function addSymbol(sym: string) {
    const s = sym.toUpperCase();
    if (!symbols.includes(s)) setSymbols([...symbols, s]);
  }

  async function submit() {
    if (symbols.length === 0) {
      setError(t("bt.err.needSymbol"));
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const resp = await runBacktest({
        symbols,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        initial_capital: Number(capital) || 100000,
        risk_tolerance: risk,
        rebalance_days: Number(rebalDays) || 20,
      });
      setResult(resp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("bt.err.failed"));
    } finally {
      setLoading(false);
    }
  }

  const benchmark = result?.benchmark_curve ?? [];
  const excessPct =
    result && result.benchmark_return_pct != null
      ? result.total_return_pct - result.benchmark_return_pct
      : null;

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-10">
      <PageHeader
        tag={t("backtest.tag")}
        title={t("backtest.title")}
        subtitle={t("backtest.subtitle")}
      />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="surface p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-dim">
              {t("bt.pool")}
            </label>
            <StockSearch onSelect={addSymbol} placeholder={t("bt.addPlaceholder")} fullWidth />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {symbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] py-1 pl-2 pr-1 font-mono text-[12px] text-white"
                >
                  {s}
                  <button
                    onClick={() => setSymbols(symbols.filter((x) => x !== s))}
                    className="flex h-4 w-4 items-center justify-center rounded text-dim hover:bg-[rgba(248,113,113,0.12)] hover:text-[#fca5a5]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("bt.startDate")}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-base"
              />
            </Field>
            <Field label={t("bt.endDate")}>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-base"
              />
            </Field>
          </div>
          <Field label={t("bt.capital")}>
            <input
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              type="number"
              className="input-base"
            />
          </Field>
          <Field label={t("bt.rebalDays")}>
            <input
              value={rebalDays}
              onChange={(e) => setRebalDays(e.target.value)}
              type="number"
              className="input-base"
            />
          </Field>
          <Field label={t("bt.riskPref")}>
            <select
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="input-base"
            >
              <option value="conservative">{t("risk.conservative")}</option>
              <option value="moderate">{t("risk.moderate")}</option>
              <option value="aggressive">{t("risk.aggressive")}</option>
            </select>
          </Field>
          <button onClick={submit} disabled={loading} className="btn-primary w-full">
            {loading ? t("bt.running") : t("bt.run")}
          </button>
          {error && <p className="text-xs text-loss">{error}</p>}
        </div>

        <div>
          {loading && (
            <div className="surface flex h-64 flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="text-sm text-muted">{t("bt.loadingMsg")}</p>
            </div>
          )}

          {!loading && !result && (
            <div className="surface flex h-64 items-center justify-center p-10 text-center text-sm text-dim">
              {t("bt.emptyHint")}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              {(result.notes || (result.dropped_symbols && result.dropped_symbols.length > 0)) && (
                <div className="surface border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.05)] p-4 text-sm text-warn">
                  {result.notes && <p className="leading-relaxed">{result.notes}</p>}
                  {result.dropped_symbols && result.dropped_symbols.length > 0 && (
                    <p className="mt-1 text-[11px] text-dim">
                      {t("bt.skipped")}
                      <span className="font-mono">
                        {result.dropped_symbols.join(", ")}
                      </span>
                    </p>
                  )}
                  {result.loaded_symbols && result.loaded_symbols.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-dim">
                      {t("bt.loaded")}
                      <span className="font-mono">
                        {result.loaded_symbols.join(", ")}
                      </span>
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KPI
                  label={t("bt.kpi.final")}
                  value={`$${result.final_value.toLocaleString()}`}
                />
                <KPI
                  label={t("bt.kpi.total")}
                  value={fmtPct(result.total_return_pct)}
                  tone={result.total_return_pct >= 0 ? "gain" : "loss"}
                />
                <KPI
                  label={t("bt.kpi.annual")}
                  value={fmtPct(result.annualized_return_pct)}
                  tone={result.annualized_return_pct >= 0 ? "gain" : "loss"}
                />
                <KPI
                  label={t("bt.kpi.mdd")}
                  value={`${result.max_drawdown_pct.toFixed(2)}%`}
                  tone="loss"
                />
                <KPI
                  label={t("bt.kpi.benchmark")}
                  value={
                    result.benchmark_return_pct != null
                      ? fmtPct(result.benchmark_return_pct)
                      : "—"
                  }
                  tone={
                    result.benchmark_return_pct != null
                      ? result.benchmark_return_pct >= 0
                        ? "gain"
                        : "loss"
                      : undefined
                  }
                />
                <KPI
                  label={t("bt.kpi.excess")}
                  value={excessPct != null ? fmtPct(excessPct) : "—"}
                  tone={
                    excessPct != null ? (excessPct >= 0 ? "gain" : "loss") : undefined
                  }
                />
                <KPI
                  label={t("bt.kpi.sharpe")}
                  value={result.sharpe_ratio != null ? result.sharpe_ratio.toFixed(2) : "—"}
                />
                <KPI
                  label={t("bt.kpi.vol")}
                  value={
                    result.volatility_pct != null
                      ? `${result.volatility_pct.toFixed(2)}%`
                      : "—"
                  }
                />
                <KPI label={t("bt.kpi.trades")} value={String(result.trades)} />
                <KPI
                  label={t("bt.capital")}
                  value={`$${result.initial_capital.toLocaleString()}`}
                />
                <KPI label={t("bt.kpi.days")} value={String(result.equity_curve.length)} />
              </div>

              {result.equity_curve.length > 1 && (
                <div className="surface p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-xs font-medium uppercase tracking-wider text-dim">
                      {t("bt.curve.title")}
                    </h4>
                    <div className="flex items-center gap-4 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        {t("bt.curve.strategy")}
                      </span>
                      {benchmark.length > 1 && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-[2px] w-3 bg-[#fbbf24]" />
                          {t("bt.curve.benchmark")}
                        </span>
                      )}
                    </div>
                  </div>
                  <LineAreaChart
                    data={result.equity_curve.map((p) => ({ x: p.date, y: p.value }))}
                    primaryLabel={t("bt.curve.strategy")}
                    overlays={
                      benchmark.length > 1
                        ? [
                            {
                              label: t("bt.curve.benchmark"),
                              color: "#fbbf24",
                              values: result.equity_curve.map(
                                (_, i) => benchmark[i]?.value ?? null,
                              ),
                              dashed: true,
                            },
                          ]
                        : []
                    }
                    baseline={result.initial_capital}
                    formatY={(v) => `$${Math.round(v).toLocaleString()}`}
                    className="h-64"
                  />
                  <div className="mt-2 flex w-full justify-between text-[10px] text-dim">
                    <span>{result.equity_curve[0]?.date}</span>
                    <span>
                      {result.equity_curve[result.equity_curve.length - 1]?.date}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-dim">
        {label}
      </label>
      {children}
    </div>
  );
}
function KPI({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  const color =
    tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-white";
  return (
    <div className="surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-dim">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular ${color}`}>{value}</p>
    </div>
  );
}
