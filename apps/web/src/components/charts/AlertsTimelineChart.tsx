"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from "recharts";
import type { Alert } from "@/types/aml";

interface Props {
  alerts: Alert[];
}

export function AlertsTimelineChart({ alerts }: Props) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const dateStr = alert.transaction?.date ?? alert.createdAt?.slice(0, 10) ?? "";
      if (!dateStr) continue;
      // Normalize to YYYY-MM-DD
      const normalized = dateStr.slice(0, 10);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date,
        count,
        label: new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        }),
      }));
  }, [alerts]);

  if (data.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4 flex items-center justify-center h-[180px]">
        <p className="text-slate-600 text-xs">No timeline data</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
      <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
        Alerts Timeline
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="alertsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#475569" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#475569" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#94a3b8",
            }}
            labelStyle={{ color: "#cbd5e1" }}
            cursor={{ stroke: "#334155", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#475569"
            strokeWidth={1.5}
            fill="url(#alertsGrad)"
            dot={<Dot r={3} fill="#64748b" stroke="#0f172a" strokeWidth={1} />}
            activeDot={{ r: 4, fill: "#94a3b8", stroke: "#0f172a" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
