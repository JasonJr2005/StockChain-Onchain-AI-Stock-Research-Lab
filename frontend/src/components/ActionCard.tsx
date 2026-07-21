"use client";

import { useT } from "@/lib/i18n/context";

interface Props {
  signal: "bullish" | "bearish" | "neutral";
  weightPct: number;
}

const CFG: Record<
  Props["signal"],
  { key: string; glyph: string; tint: string; border: string }
> = {
  bullish: {
    key: "action.bullish",
    glyph: "↗",
    tint: "bg-[rgba(52,211,153,0.08)] text-gain",
    border: "border-[rgba(52,211,153,0.25)]",
  },
  bearish: {
    key: "action.bearish",
    glyph: "↘",
    tint: "bg-[rgba(248,113,113,0.08)] text-loss",
    border: "border-[rgba(248,113,113,0.25)]",
  },
  neutral: {
    key: "action.neutral",
    glyph: "→",
    tint: "bg-white/[0.03] text-muted",
    border: "border-[var(--border-strong)]",
  },
};

export default function ActionCard({ signal, weightPct }: Props) {
  const { t } = useT();
  const c = CFG[signal] ?? CFG.neutral;
  return (
    <div
      className={`min-w-[260px] rounded-2xl border p-6 ${c.tint} ${c.border}`}
    >
      <div className="mb-2 text-3xl leading-none">{c.glyph}</div>
      <h3 className="text-base font-semibold">{t(c.key)}</h3>
      {signal !== "neutral" && (
        <p className="mt-1 text-[13px] text-muted">
          {t("action.weightPre")}{" "}
          <span className="font-mono text-white">
            {weightPct.toFixed(1)}%
          </span>{" "}
          {t("action.weightPost")}
        </p>
      )}
      <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-dim">
        Research Signal · Not Investment Advice
      </p>
    </div>
  );
}
