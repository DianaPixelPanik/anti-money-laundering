"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { Alert } from "@/types/aml";

interface Props {
  alerts: Alert[];
}

const HIGH_RISK_PATTERNS = new Set([
  "CROSS_BORDER_RISK",
  "SMURFING",
  "LAYERING",
  "ROUND_TRIPPING",
  "STRUCTURING",
]);

export function PatternsDetectedChart({ alerts }: Props) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const p = alert.pattern;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name: name.replace(/_/g, " "),
        count,
        isHighRisk: HIGH_RISK_PATTERNS.has(name),
      }));
  }, [alerts]);

  if (data.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4 flex items-center justify-center h-[200px]">
        <p className="text-slate-600 text-xs">No pattern data</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
      <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
        Patterns Detected
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <XAxis
            type="number"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#94a3b8",
            }}
            cursor={{ fill: "#1e293b" }}
            labelStyle={{ color: "#cbd5e1" }}
          />
          <Bar dataKey="count" radius={[0, 2, 2, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.isHighRisk ? "#b91c1c" : "#475569"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
