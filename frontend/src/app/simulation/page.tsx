"use client";

import { useCallback, useEffect, useState } from "react";
import LineAreaChart from "@/components/LineAreaChart";
import PageHeader from "@/components/PageHeader";
import SignalBadge from "@/components/SignalBadge";
import StockSearch from "@/components/StockSearch";
import {
  buySimulation,
  closeSimulationPosition,
  getPresets,
  getSimulationState,
  rebalanceSimulation,
  refreshSimulationPrices,
  resetSimulation,
  sellSimulation,
  type ResearchSignal,
  type SimulationState,
  type WatchlistPreset,
} from "@/lib/api";
import {
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtShares,
  inferCurrency,
} from "@/lib/format";
import { useT } from "@/lib/i18n/context";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA"];
const WATCHLIST_KEY = "fintastech.watchlist.v1";
const RISK_KEY = "fintastech.risk.v1";

type OrderMode = "shares" | "dollars";

export default function SimulationPage() {
  const { t } = useT();
  const [state, setState] = useState<SimulationState | null>(null);
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [risk, setRisk] = useState("moderate");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [presets, setPresets] = useState<WatchlistPreset[]>([]);
  const [lastResearch, setLastResearch] = useState<ResearchSignal[]>([]);

  // Manual-order form state
  const [orderSymbol, setOrderSymbol] = useState("");
  const [orderMode, setOrderMode] = useState<OrderMode>("dollars");
  const [orderAmount, setOrderAmount] = useState("");

  // Initial load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setSymbols(parsed);
      }
      const r = localStorage.getItem(RISK_KEY);
      if (r) setRisk(r);
    } catch {
      /* ignore */
    }
    getPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  // Persist watch-list + risk
  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
    } catch {
      /* ignore */
    }
  }, [symbols]);
  useEffect(() => {
    try {
      localStorage.setItem(RISK_KEY, risk);
    } catch {
      /* ignore */
    }
  }, [risk]);

  const refresh = useCallback(async () => {
    try {
      const s = await getSimulationState();
      setState(s);
    } catch (e) {
      setErr(
        t("sim.err.noState", { msg: e instanceof Error ? e.message : String(e) }),
      );
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function clearMsgs() {
    setErr("");
    setInfo("");
  }

  async function doRebalance() {
    if (symbols.length === 0) {
      setErr(t("sim.err.needSymbol"));
      return;
    }
    setBusy("rebalance");
    clearMsgs();
    try {
      const s = await rebalanceSimulation(symbols, risk);
      setState(s);
      if (s.research_signals && s.research_signals.length > 0) {
        setLastResearch(s.research_signals);
        const tradedThisCycle = s.research_signals.filter((r) => r.weight_pct > 0).length;
        setInfo(
          tradedThisCycle === 0
            ? t("sim.info.noTrades")
            : t("sim.info.cycleDone", { n: s.research_signals.length }),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function doReset() {
    if (!confirm(t("sim.reset.confirm"))) return;
    setBusy("reset");
    clearMsgs();
    try {
      const s = await resetSimulation(100000);
      setState(s);
      setLastResearch([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function doRefreshPrices() {
    setBusy("refresh");
    clearMsgs();
    try {
      const s = await refreshSimulationPrices();
      setState(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function doManualOrder(side: "buy" | "sell") {
    clearMsgs();
    const sym = orderSymbol.trim().toUpperCase();
    if (!sym) {
      setErr(t("sim.err.orderSymbol"));
      return;
    }
    const amt = parseFloat(orderAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr(t("sim.err.orderAmount"));
      return;
    }
    const opts =
      orderMode === "dollars" ? { notional: amt } : { shares: amt };

    setBusy(`${side}:${sym}`);
    try {
      const resp =
        side === "buy"
          ? await buySimulation(sym, opts)
          : await sellSimulation(sym, opts);
      setState(resp.state);
      setOrderAmount("");
      setInfo(
        t(side === "buy" ? "sim.info.bought" : "sim.info.sold", {
          sym,
          shares: fmtShares(resp.trade.shares),
          price: fmtPrice(resp.trade.price, resp.trade.currency),
          total: fmtMoney(resp.trade.notional, resp.trade.currency),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function doClose(sym: string) {
    clearMsgs();
    setBusy(`close:${sym}`);
    try {
      const resp = await closeSimulationPosition(sym);
      setState(resp.state);
      setInfo(
        t("sim.info.closed", {
          sym,
          shares: fmtShares(resp.trade.shares),
          price: fmtPrice(resp.trade.price, resp.trade.currency),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function addSym(sym: string) {
    const s = sym.toUpperCase().trim();
    if (!s) return;
    if (!symbols.includes(s)) setSymbols([...symbols, s]);
  }
  function removeSym(sym: string) {
    setSymbols(symbols.filter((x) => x !== sym));
  }
  function loadPreset(p: WatchlistPreset) {
    setSymbols(p.symbols);
    setInfo(t("sim.info.presetLoaded", { name: p.label, n: p.symbols.length }));
  }

  // Equity curve
  const curve = state?.equity_curve ?? [];
  const equityTone = state && state.total_return_pct >= 0 ? "gain" : "loss";

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <PageHeader tag={t("sim.tag")} title={t("sim.title")} subtitle={t("sim.subtitle")}>
        <select
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="input-base !w-auto min-w-[10rem] !py-2 font-medium"
          aria-label={t("bt.riskPref")}
        >
          <option value="conservative">{t("sim.risk.conservative")}</option>
          <option value="moderate">{t("sim.risk.moderate")}</option>
          <option value="aggressive">{t("sim.risk.aggressive")}</option>
        </select>
        <button
          onClick={doRefreshPrices}
          disabled={busy !== ""}
          className="btn-ghost"
          title={t("sim.refresh.tip")}
        >
          {busy === "refresh" ? t("sim.refreshing") : t("sim.refresh")}
        </button>
        <button
          onClick={doRebalance}
          disabled={busy !== "" || symbols.length === 0}
          className="btn-primary"
        >
          {busy === "rebalance" ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              {t("sim.running")}
            </>
          ) : (
            <>{t("sim.runCycle", { n: symbols.length })}</>
          )}
        </button>
        <button onClick={doReset} disabled={busy !== ""} className="btn-danger">
          {t("sim.reset")}
        </button>
      </PageHeader>

      {/* Status messages */}
      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.06)] px-4 py-3 text-sm text-[#fca5a5]">
          <span className="mt-0.5 font-mono text-xs">!</span>
          <span>{err}</span>
        </div>
      )}
      {info && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.05)] px-4 py-3 text-sm text-accent">
          <span className="mt-0.5 font-mono text-xs">i</span>
          <span>{info}</span>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid gap-4 md:grid-cols-5">
        <Kpi
          label={t("sim.kpi.equity")}
          value={state ? fmtMoney(state.equity, "USD") : "—"}
        />
        <Kpi
          label={t("sim.kpi.return")}
          value={state ? fmtPct(state.total_return_pct) : "—"}
          tone={equityTone}
          large
        />
        <Kpi
          label={t("sim.kpi.cash")}
          value={state ? fmtMoney(state.cash, "USD") : "—"}
          sub={
            state
              ? t("sim.kpi.cashPct", { pct: state.cash_pct.toFixed(1) })
              : undefined
          }
        />
        <Kpi
          label={t("sim.kpi.invested")}
          value={state ? fmtMoney(state.invested_value, "USD") : "—"}
          sub={
            state
              ? t("sim.kpi.investedPct", { pct: state.invested_pct.toFixed(1) })
              : undefined
          }
        />
        <Kpi
          label={t("sim.kpi.counts")}
          value={
            state
              ? `${state.holdings.length} · ${state.trade_count}`
              : "—"
          }
          sub={t("sim.kpi.initial")}
        />
      </div>

      {/* Equity curve */}
      <div className="surface mt-6 overflow-hidden p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">{t("sim.curve.title")}</h4>
            <p className="text-[11px] text-dim">{t("sim.curve.subtitle")}</p>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" /> {t("sim.curve.equity")}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-[2px] w-3 bg-[var(--border-strong)]" />{" "}
              {t("sim.curve.start")}
            </span>
            {state && curve.length > 0 && (
              <span className="font-mono text-muted">
                {t("sim.curve.latest", {
                  v: fmtMoney(curve[curve.length - 1].value, "USD"),
                })}
              </span>
            )}
          </div>
        </div>

        {curve.length > 1 ? (
          <LineAreaChart
            data={curve.map((p) => ({
              x: new Date(p.ts).toLocaleString(),
              y: p.value,
            }))}
            primaryLabel={t("sim.curve.equity")}
            baseline={state?.initial_capital}
            baselineLabel={t("sim.curve.start")}
            formatY={(v) => fmtMoney(v, "USD")}
            className="h-56"
          />
        ) : (
          <div className="flex h-56 items-center justify-center text-xs text-dim">
            {t("sim.curve.empty")}
          </div>
        )}
      </div>

      {/* Main grid: left = watchlist + presets + manual order; right = holdings, research, trades */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Watch-list + quick presets — the primary research entry point */}
          <div className="surface p-5">
            <h3 className="mb-3 text-sm font-semibold">{t("sim.watch.title")}</h3>
            <StockSearch
              onSelect={addSym}
              placeholder={t("sim.watch.searchPlaceholder")}
              fullWidth
            />

            {symbols.length === 0 ? (
              <p className="mt-4 text-xs text-dim">{t("sim.watch.empty")}</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {symbols.map((s) => (
                  <span
                    key={s}
                    className="group inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] py-1 pl-2 pr-1 font-mono text-[12px] text-white"
                  >
                    {s}
                    <button
                      onClick={() => removeSym(s)}
                      className="flex h-4 w-4 items-center justify-center rounded text-dim hover:bg-[rgba(248,113,113,0.12)] hover:text-[#fca5a5]"
                      aria-label={t("sim.watch.remove", { sym: s })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-dim">
                {t("sim.presets.quick")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => loadPreset(p)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-white"
                    title={p.description}
                  >
                    {p.label}
                    <span className="ml-1.5 font-mono text-[10px] text-dim">
                      {p.symbols.length}
                    </span>
                  </button>
                ))}
                {presets.length === 0 && (
                  <p className="text-[11px] text-dim">{t("sim.presets.fail")}</p>
                )}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-dim">
                {t("sim.presets.note")}
              </p>
            </div>
          </div>

          {/* Manual order panel — the professional paper-trading entry point */}
          <div className="surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("sim.order.title")}</h3>
              <span className="chip chip-neutral">{t("sim.order.badge")}</span>
            </div>

            <div className="space-y-3">
              <StockSearch
                onSelect={(s) => setOrderSymbol(s)}
                placeholder={t("sim.order.searchPlaceholder")}
                fullWidth
                clearOnSelect={false}
              />
              {orderSymbol && (
                <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-[13px]">
                  <span className="font-mono text-white">{orderSymbol}</span>
                  <span className="font-mono text-[11px] text-dim">
                    {inferCurrency(orderSymbol)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-xs transition ${
                    orderMode === "dollars"
                      ? "border-accent bg-[rgba(139,92,246,0.08)] text-accent"
                      : "border-[var(--border)] bg-[var(--bg-elev)] text-dim hover:text-white"
                  }`}
                  onClick={() => setOrderMode("dollars")}
                >
                  {t("sim.order.byDollars")}
                </button>
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-xs transition ${
                    orderMode === "shares"
                      ? "border-accent bg-[rgba(139,92,246,0.08)] text-accent"
                      : "border-[var(--border)] bg-[var(--bg-elev)] text-dim hover:text-white"
                  }`}
                  onClick={() => setOrderMode("shares")}
                >
                  {t("sim.order.byShares")}
                </button>
              </div>

              <input
                type="number"
                min="0"
                step={orderMode === "dollars" ? "100" : "1"}
                placeholder={
                  orderMode === "dollars"
                    ? t("sim.order.amount.dollars")
                    : t("sim.order.amount.shares")
                }
                value={orderAmount}
                onChange={(e) => setOrderAmount(e.target.value)}
                className="input-base"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => doManualOrder("buy")}
                  disabled={busy.startsWith("buy") || busy.startsWith("sell")}
                  className="rounded-lg bg-[#10b981] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#0ea770] disabled:opacity-50"
                >
                  {busy.startsWith("buy") ? t("sim.order.buying") : t("sim.order.buy")}
                </button>
                <button
                  type="button"
                  onClick={() => doManualOrder("sell")}
                  disabled={busy.startsWith("buy") || busy.startsWith("sell")}
                  className="rounded-lg bg-[#f43f5e] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#e11d48] disabled:opacity-50"
                >
                  {busy.startsWith("sell") ? t("sim.order.selling") : t("sim.order.sell")}
                </button>
              </div>

              <p className="text-[11px] leading-relaxed text-dim">
                {t("sim.order.note")}
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6 min-w-0">
          {/* Holdings */}
          <div className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h3 className="text-sm font-semibold">{t("sim.holdings.title")}</h3>
              {state?.last_rebalance_at && (
                <span className="text-[11px] text-dim">
                  {t("sim.holdings.lastCycle", {
                    ts: new Date(state.last_rebalance_at).toLocaleString(),
                  })}
                </span>
              )}
            </div>
            {!state || state.holdings.length === 0 ? (
              <div className="px-6 py-12">
                <p className="text-center text-sm font-medium text-white">
                  {t("sim.start.title")}
                </p>
                <ol className="mx-auto mt-5 flex max-w-xl flex-col gap-3">
                  {(["step1", "step2", "step3"] as const).map((k, i) => (
                    <li key={k} className="flex items-start gap-3 text-[13px] text-muted">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-gradient font-mono text-[10px] font-semibold text-white">
                        {i + 1}
                      </span>
                      {t(`sim.start.${k}`)}
                    </li>
                  ))}
                </ol>
                <div className="mt-6 text-center">
                  <button
                    onClick={doRebalance}
                    disabled={busy !== "" || symbols.length === 0}
                    className="btn-primary"
                  >
                    {busy === "rebalance" ? t("sim.running") : t("sim.start.cta")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-dim">
                    <tr>
                      <Th>{t("sim.col.symbol")}</Th>
                      <Th center>{t("sim.col.signal")}</Th>
                      <Th right>{t("sim.col.shares")}</Th>
                      <Th right>{t("sim.col.cost")}</Th>
                      <Th right>{t("sim.col.price")}</Th>
                      <Th right>{t("sim.col.value")}</Th>
                      <Th right>{t("sim.col.weight")}</Th>
                      <Th right>{t("sim.col.pnl")}</Th>
                      <Th center>{t("sim.col.action")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {state.holdings.map((h) => (
                      <tr
                        key={h.symbol}
                        className="transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <Td mono>
                          <div className="flex items-center gap-2">
                            <span>{h.symbol}</span>
                            <span className="text-[10px] text-dim">
                              {h.currency}
                            </span>
                          </div>
                        </Td>
                        <Td center>
                          {h.last_signal ? (
                            <SignalBadge signal={h.last_signal} size="sm" />
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </Td>
                        <Td right mono>
                          {fmtShares(h.shares)}
                        </Td>
                        <Td right mono>
                          {fmtPrice(h.avg_cost, h.currency)}
                        </Td>
                        <Td right mono>
                          {fmtPrice(h.last_price, h.currency)}
                        </Td>
                        <Td right mono>
                          {fmtMoney(h.market_value, h.currency)}
                        </Td>
                        <Td right mono>
                          {h.weight_pct.toFixed(1)}%
                        </Td>
                        <Td right mono>
                          <span
                            className={
                              h.unrealized_pnl_pct >= 0
                                ? "text-gain"
                                : "text-loss"
                            }
                          >
                            {fmtPct(h.unrealized_pnl_pct)}
                          </span>
                        </Td>
                        <Td center>
                          <button
                            onClick={() => doClose(h.symbol)}
                            disabled={busy !== ""}
                            className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1 text-[11px] text-dim transition hover:border-[rgba(248,113,113,0.3)] hover:text-[#fca5a5] disabled:opacity-40"
                          >
                            {busy === `close:${h.symbol}` ? "…" : t("sim.close")}
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Research signals */}
          {lastResearch.length > 0 && (
            <div className="surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                <h3 className="text-sm font-semibold">{t("sim.research.title")}</h3>
                <span className="text-[11px] text-dim">
                  {t("sim.research.subtitle", { n: lastResearch.length })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-dim">
                    <tr>
                      <Th>{t("sim.col.symbol")}</Th>
                      <Th center>{t("sim.col.direction")}</Th>
                      <Th right>{t("sim.col.confidence")}</Th>
                      <Th right>{t("sim.col.illWeight")}</Th>
                      <Th right>{t("sim.col.curPrice")}</Th>
                      <Th>{t("sim.col.summary")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {lastResearch.map((r) => (
                      <tr
                        key={r.symbol}
                        className="transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <Td mono>
                          <div className="flex items-center gap-2">
                            <span>{r.symbol}</span>
                            <span className="text-[10px] text-dim">
                              {r.currency || inferCurrency(r.symbol)}
                            </span>
                          </div>
                        </Td>
                        <Td center>
                          <SignalBadge signal={r.direction} size="sm" />
                        </Td>
                        <Td right mono>
                          {(r.confidence * 100).toFixed(0)}%
                        </Td>
                        <Td right mono>
                          {r.weight_pct > 0
                            ? `${r.weight_pct.toFixed(1)}%`
                            : "—"}
                        </Td>
                        <Td right mono>
                          {r.price > 0
                            ? fmtPrice(r.price, r.currency)
                            : "—"}
                        </Td>
                        <Td muted>{r.summary || "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-[var(--border)] px-5 py-2.5 text-[10px] text-dim">
                {t("sim.research.note")}
              </p>
            </div>
          )}

          {/* Trade history */}
          {state && state.recent_trades.length > 0 && (
            <div className="surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                <h3 className="text-sm font-semibold">
                  {t("sim.trades.title", {
                    n: Math.min(state.recent_trades.length, 50),
                  })}
                </h3>
                <span className="text-[11px] text-dim">
                  {t("sim.trades.total", { n: state.trade_count })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-dim">
                    <tr>
                      <Th>{t("sim.col.time")}</Th>
                      <Th>{t("sim.col.symbol")}</Th>
                      <Th center>{t("sim.col.direction")}</Th>
                      <Th right>{t("sim.col.shares")}</Th>
                      <Th right>{t("sim.col.price")}</Th>
                      <Th right>{t("sim.col.notional")}</Th>
                      <Th>{t("sim.col.reason")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {state.recent_trades.slice(0, 50).map((tr, i) => (
                      <tr
                        key={tr.id ?? `${tr.timestamp}-${i}`}
                        className="transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <Td muted>
                          {new Date(tr.timestamp).toLocaleString()}
                        </Td>
                        <Td mono>{tr.symbol}</Td>
                        <Td center>
                          <span
                            className={`chip ${
                              tr.side === "buy"
                                ? "chip-bullish"
                                : "chip-bearish"
                            }`}
                          >
                            {t(tr.side === "buy" ? "common.buy" : "common.sell")}
                          </span>
                        </Td>
                        <Td right mono>
                          {fmtShares(tr.shares)}
                        </Td>
                        <Td right mono>
                          {fmtPrice(tr.price, tr.currency)}
                        </Td>
                        <Td right mono>
                          {fmtMoney(tr.notional, tr.currency)}
                        </Td>
                        <Td muted>{tr.reason}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-10 text-center text-[11px] text-dim">
        {state?.disclaimer ?? t("sim.footer.fallback")}
      </p>
    </div>
  );
}

/* ----------------------- helpers ----------------------- */

function Kpi({
  label,
  value,
  tone,
  large,
  sub,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
  large?: boolean;
  sub?: string;
}) {
  const color =
    tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-white";
  return (
    <div className="surface p-5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-dim">{label}</p>
      <p
        className={`mt-1.5 font-mono tabular font-semibold ${color} ${
          large ? "text-3xl" : "text-xl"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-[11px] text-dim">{sub}</p>}
    </div>
  );
}

function Th({
  children,
  right,
  center,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
}) {
  const align = right ? "text-right" : center ? "text-center" : "text-left";
  return <th className={`px-4 py-2.5 font-medium ${align}`}>{children}</th>;
}

function Td({
  children,
  right,
  center,
  mono,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  const align = right ? "text-right" : center ? "text-center" : "text-left";
  const font = mono ? "font-mono tabular" : "";
  const color = muted ? "text-dim text-xs" : "";
  return (
    <td className={`px-4 py-2.5 ${align} ${font} ${color}`}>{children}</td>
  );
}
