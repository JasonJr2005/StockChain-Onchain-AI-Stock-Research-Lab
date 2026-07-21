"use client";

import { useT } from "@/lib/i18n/context";

interface Props {
  score: number; // 0-1
}

export default function RiskGauge({ score }: Props) {
  const { t } = useT();
  const pct = Math.round(score * 100);
  const labelKey =
    score < 0.3 ? "riskgauge.low" : score < 0.6 ? "riskgauge.mid" : "riskgauge.high";
  const tint =
    score < 0.3
      ? { bar: "#34d399", text: "text-gain" }
      : score < 0.6
        ? { bar: "#fbbf24", text: "text-warn" }
        : { bar: "#f87171", text: "text-loss" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-dim">
          {t("riskgauge.title")}
        </span>
        <span className={`text-[13px] font-semibold ${tint.text}`}>
          {t(labelKey)} · {pct}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: tint.bar }}
        />
      </div>
    </div>
  );
}
