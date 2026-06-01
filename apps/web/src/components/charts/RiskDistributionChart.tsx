"use client";

import { useMemo } from "react";
import type { Alert } from "@/types/aml";

interface Props {
  alerts: Alert[];
}

export function RiskDistributionChart({ alerts }: Props) {
  const { high, medium, low, total } = useMemo(() => {
    const h = alerts.filter((a) => a.severity === "high").length;
    const m = alerts.filter((a) => a.severity === "medium").length;
    const l = alerts.filter((a) => a.severity === "low").length;
    return { high: h, medium: m, low: l, total: h + m + l };
  }, [alerts]);

  if (total === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4 flex items-center justify-center" style={{ height: 80 }}>
        <p className="text-slate-600 text-xs">No alert data</p>
      </div>
    );
  }

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const segments = [
    { label: "High", count: high, pct: pct(high), bg: "bg-red-700", text: "text-red-400" },
    { label: "Med", count: medium, pct: pct(medium), bg: "bg-amber-600", text: "text-amber-400" },
    { label: "Low", count: low, pct: pct(low), bg: "bg-slate-600", text: "text-slate-400" },
  ].filter((s) => s.count > 0);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4" style={{ height: 80 }}>
      <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-2">
        Risk Distribution
      </p>
      <div className="flex h-5 rounded overflow-hidden gap-px">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`${s.bg} relative group cursor-default`}
            style={{ width: `${s.pct}%` }}
            title={`${s.label}: ${s.count} (${Math.round(s.pct)}%)`}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1">
            <span className={`text-xs font-mono font-semibold ${s.text}`}>{s.count}</span>
            <span className="text-xs text-slate-600">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
