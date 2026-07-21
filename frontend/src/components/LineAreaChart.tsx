"use client";

// Shared SVG area/line chart used by the simulation equity curve, the
// backtest result (strategy vs. benchmark) and the analysis price chart.
// Pure SVG — no chart library — with a hover crosshair + tooltip.

import { useId, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  x: string;
  y: number;
}

export interface ChartOverlay {
  label: string;
  color: string;
  /** Aligned by index with `data`. `null` gaps are skipped. */
  values: (number | null)[];
  dashed?: boolean;
}

const VB_W = 1000;
const VB_H = 300;
const PAD_Y = 16; // viewBox units above/below the series

export default function LineAreaChart({
  data,
  primaryLabel,
  overlays = [],
  baseline,
  baselineLabel,
  formatY = (v) => v.toFixed(2),
  className = "h-56",
}: {
  data: ChartPoint[];
  primaryLabel: string;
  overlays?: ChartOverlay[];
  /** Dashed horizontal reference (e.g. initial capital). */
  baseline?: number;
  baselineLabel?: string;
  formatY?: (v: number) => string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const domain = useMemo(() => {
    const ys: number[] = data.map((p) => p.y);
    for (const o of overlays) {
      for (const v of o.values) if (v != null && Number.isFinite(v)) ys.push(v);
    }
    if (baseline != null) ys.push(baseline);
    if (ys.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.002, 1e-9);
    min -= pad;
    max += pad;
    return { min, max };
  }, [data, overlays, baseline]);

  const n = data.length;
  if (n < 2) return null;

  const xAt = (i: number) => (i / (n - 1)) * VB_W;
  const yAt = (v: number) =>
    VB_H - PAD_Y - ((v - domain.min) / (domain.max - domain.min)) * (VB_H - 2 * PAD_Y);

  const primaryPts = data.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ");
  const areaPts = `0,${VB_H} ${primaryPts} ${VB_W},${VB_H}`;

  function overlayPath(values: (number | null)[]): string {
    let d = "";
    let pen = false;
    for (let i = 0; i < Math.min(values.length, n); i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${xAt(i)},${yAt(v)}`;
      pen = true;
    }
    return d;
  }

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(frac * (n - 1)));
  }

  const hover = hoverIdx != null ? data[hoverIdx] : null;
  const hoverLeftPct = hoverIdx != null ? (hoverIdx / (n - 1)) * 100 : 0;
  const tooltipOnLeft = hoverLeftPct > 55;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none ${className}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-full w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`line-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
        </defs>

        {baseline != null && (
          <line
            x1="0"
            x2={VB_W}
            y1={yAt(baseline)}
            y2={yAt(baseline)}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <polygon fill={`url(#area-${uid})`} points={areaPts} />

        {overlays.map((o) => (
          <path
            key={o.label}
            d={overlayPath(o.values)}
            fill="none"
            stroke={o.color}
            strokeWidth="1.4"
            strokeDasharray={o.dashed ? "5 4" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.9"
          />
        ))}

        <polyline
          fill="none"
          stroke={`url(#line-${uid})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={primaryPts}
        />

        {hover && (
          <>
            <line
              x1={xAt(hoverIdx!)}
              x2={xAt(hoverIdx!)}
              y1="0"
              y2={VB_H}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={xAt(hoverIdx!)}
              cy={yAt(hover.y)}
              r="4"
              fill="#a78bfa"
              stroke="#07070c"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {/* Y-axis min/max labels */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2 font-mono text-[10px] text-dim">
        <span>{formatY(domain.max)}</span>
        <span>{formatY(domain.min)}</span>
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)]/95 px-3 py-2 shadow-xl backdrop-blur"
          style={
            tooltipOnLeft
              ? { right: `${100 - hoverLeftPct + 2}%` }
              : { left: `${hoverLeftPct + 2}%` }
          }
        >
          <p className="mb-1 font-mono text-[10px] text-dim">{hover.x}</p>
          <p className="flex items-center justify-between gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {primaryLabel}
            </span>
            <span className="font-mono tabular text-white">{formatY(hover.y)}</span>
          </p>
          {overlays.map((o) => {
            const v = o.values[hoverIdx!];
            if (v == null || !Number.isFinite(v)) return null;
            return (
              <p
                key={o.label}
                className="flex items-center justify-between gap-3 text-[11px]"
              >
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: o.color }}
                  />
                  {o.label}
                </span>
                <span className="font-mono tabular text-white">{formatY(v)}</span>
              </p>
            );
          })}
          {baseline != null && baselineLabel && (
            <p className="mt-1 border-t border-[var(--border)] pt-1 text-[10px] text-dim">
              {baselineLabel} {formatY(baseline)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
