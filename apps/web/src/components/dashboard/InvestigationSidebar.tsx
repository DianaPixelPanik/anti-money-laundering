"use client";

import { useMemo } from "react";
import type { Alert, PatternType } from "@/types/aml";

interface Props {
  alerts: Alert[];
}

export function InvestigationSidebar({ alerts }: Props) {
  const { highCount, mediumCount, lowCount, total } = useMemo(() => {
    const high = alerts.filter((a) => a.severity === "high").length;
    const medium = alerts.filter((a) => a.severity === "medium").length;
    const low = alerts.filter((a) => a.severity === "low").length;
    return { highCount: high, mediumCount: medium, lowCount: low, total: alerts.length };
  }, [alerts]);

  // Top accounts by alert count
  const topAccounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const acc = alert.transaction?.from_account ?? "unknown";
      counts.set(acc, (counts.get(acc) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [alerts]);

  // Pattern summary
  const patternSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const p = alert.pattern as string;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [alerts]);

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <div className="space-y-3">
      {/* Risk Breakdown */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
        <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
          Risk Breakdown
        </p>
        <div className="space-y-2.5">
          {/* High */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-red-400">High</span>
              <span className="text-xs font-mono text-slate-400">{highCount}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-700 rounded-full"
                style={{ width: `${pct(highCount)}%` }}
              />
            </div>
          </div>

          {/* Medium */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-amber-400">Medium</span>
              <span className="text-xs font-mono text-slate-400">{mediumCount}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 rounded-full"
                style={{ width: `${pct(mediumCount)}%` }}
              />
            </div>
          </div>

          {/* Low */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Low</span>
              <span className="text-xs font-mono text-slate-400">{lowCount}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-600 rounded-full"
                style={{ width: `${pct(lowCount)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Top Accounts */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
        <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
          Top Flagged Accounts
        </p>
        {topAccounts.length === 0 ? (
          <p className="text-slate-600 text-xs">No data</p>
        ) : (
          <ul className="space-y-2">
            {topAccounts.map(([account, count]) => (
              <li key={account} className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-slate-300 truncate min-w-0">
                  {account}
                </span>
                <span className="text-xs font-mono text-slate-500 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded shrink-0">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pattern Summary */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-md p-4">
        <p className="text-slate-500 text-xs uppercase tracking-wider font-medium mb-3">
          Pattern Summary
        </p>
        {patternSummary.length === 0 ? (
          <p className="text-slate-600 text-xs">No patterns detected</p>
        ) : (
          <ul className="space-y-1.5">
            {patternSummary.map(([pattern, count]) => (
              <li key={pattern} className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 truncate min-w-0">
                  {pattern.replace(/_/g, " ")}
                </span>
                <span className="text-xs font-mono text-slate-500 shrink-0">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
