"use client";

import { useState, useMemo } from "react";
import type { Alert, RiskSeverity, PatternType, AlertStatus } from "@/types/aml";

interface Props {
  alerts: Alert[];
  onSelectAlert: (alert: Alert) => void;
}

type SortBy = "risk" | "amount" | "date";
type SortDir = "asc" | "desc";

function riskBadgeStyle(score: number): string {
  if (score >= 75) return "text-red-400 bg-red-950/40 border-red-800";
  if (score >= 45) return "text-amber-400 bg-amber-950/40 border-amber-800";
  return "text-slate-400 bg-slate-800 border-slate-700";
}

function severityDotColor(severity: RiskSeverity): string {
  if (severity === "high") return "bg-red-400";
  if (severity === "medium") return "bg-amber-400";
  return "bg-slate-500";
}

function severityTextColor(severity: RiskSeverity): string {
  if (severity === "high") return "text-red-400";
  if (severity === "medium") return "text-amber-400";
  return "text-slate-400";
}

function statusBadgeStyle(status: AlertStatus): string {
  if (status === "SAR_FILED") return "text-red-400 bg-red-950/30 border-red-900";
  if (status === "FALSE_POSITIVE") return "text-slate-500 bg-slate-800 border-slate-700";
  if (status === "REVIEWED") return "text-emerald-400 bg-emerald-950/30 border-emerald-900";
  return "text-slate-400 bg-slate-800/50 border-slate-700";
}

function rowBgStyle(severity: RiskSeverity): string {
  if (severity === "high") return "bg-red-950/10";
  return "";
}

const ALL_PATTERNS: PatternType[] = [
  "UNUSUAL_VELOCITY",
  "LARGE_AMOUNT",
  "UNKNOWN_COUNTERPARTY",
  "ROUND_AMOUNT_STRUCTURING",
  "CROSS_BORDER_RISK",
  "SMURFING",
  "LAYERING",
  "ROUND_TRIPPING",
  "GEOGRAPHIC_ANOMALY",
  "STRUCTURING",
  "UNKNOWN",
];

export function FlaggedTransactionsTable({ alerts, onSelectAlert }: Props) {
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<RiskSeverity | "all">("all");
  const [filterPattern, setFilterPattern] = useState<PatternType | "all">("all");
  const [filterStatus, setFilterStatus] = useState<AlertStatus | "all">("all");
  const [sortBy, setSortBy] = useState<SortBy>("risk");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filteredSorted = useMemo(() => {
    let result = [...alerts];

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((a) => {
        const txId = a.transactionId.toLowerCase();
        const from = (a.transaction?.from_account ?? "").toLowerCase();
        const to = (a.transaction?.to_account ?? "").toLowerCase();
        return txId.includes(q) || from.includes(q) || to.includes(q);
      });
    }

    // Severity filter
    if (filterSeverity !== "all") {
      result = result.filter((a) => a.severity === filterSeverity);
    }

    // Pattern filter
    if (filterPattern !== "all") {
      result = result.filter((a) => a.pattern === filterPattern);
    }

    // Status filter
    if (filterStatus !== "all") {
      result = result.filter((a) => a.status === filterStatus);
    }

    // Sort
    result.sort((a, b) => {
      let diff = 0;
      if (sortBy === "risk") {
        diff = a.riskScore - b.riskScore;
      } else if (sortBy === "amount") {
        diff = (a.transaction?.amount ?? 0) - (b.transaction?.amount ?? 0);
      } else if (sortBy === "date") {
        diff =
          new Date(a.transaction?.date ?? a.createdAt).getTime() -
          new Date(b.transaction?.date ?? b.createdAt).getTime();
      }
      return sortDir === "desc" ? -diff : diff;
    });

    return result;
  }, [alerts, search, filterSeverity, filterPattern, filterStatus, sortBy, sortDir]);

  const reviewRequired = alerts.filter(
    (a) => a.severity === "high" && a.status === "PENDING"
  ).length;

  const availablePatterns = useMemo(() => {
    const found = new Set(alerts.map((a) => a.pattern));
    return ALL_PATTERNS.filter((p) => found.has(p));
  }, [alerts]);

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortBy }) => {
    if (sortBy !== col) {
      return (
        <svg className="w-3 h-3 text-slate-600 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      );
    }
    return (
      <svg className="w-3 h-3 text-slate-400 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {sortDir === "desc" ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        )}
      </svg>
    );
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-md overflow-hidden">
      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <svg
            className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search account / TX ID..."
            className="pl-7 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500 w-48"
          />
        </div>

        {/* Severity filter */}
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as RiskSeverity | "all")}
          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-slate-500 cursor-pointer"
        >
          <option value="all">All Severity</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Pattern filter */}
        <select
          value={filterPattern}
          onChange={(e) => setFilterPattern(e.target.value as PatternType | "all")}
          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-slate-500 cursor-pointer"
        >
          <option value="all">All Patterns</option>
          {availablePatterns.map((p) => (
            <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as AlertStatus | "all")}
          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-slate-500 cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="FALSE_POSITIVE">False Positive</option>
          <option value="SAR_FILED">SAR Filed</option>
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Review count */}
        {reviewRequired > 0 && (
          <span className="text-xs text-red-400 bg-red-950/30 border border-red-900 px-2 py-1 rounded font-medium">
            {reviewRequired} {reviewRequired === 1 ? "alert requires" : "alerts require"} analyst review
          </span>
        )}

        {/* Result count */}
        <span className="text-xs text-slate-500">
          {filteredSorted.length} / {alerts.length}
        </span>
      </div>

      {/* Table */}
      {filteredSorted.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-400 text-sm">No alerts flagged</p>
          <p className="text-slate-600 text-xs mt-1">
            {search || filterSeverity !== "all" || filterPattern !== "all"
              ? "Try adjusting your filters"
              : "All transactions appear normal"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/60 border-b border-slate-800">
              <tr>
                <th
                  className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort("risk")}
                >
                  Risk <SortIcon col="risk" />
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  Severity
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  Pattern
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  TX ID
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  From
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  To
                </th>
                <th
                  className="px-3 py-2.5 text-right text-xs text-slate-500 font-medium cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort("amount")}
                >
                  Amount <SortIcon col="amount" />
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort("date")}
                >
                  Date <SortIcon col="date" />
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  Country
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left text-xs text-slate-500 font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredSorted.map((alert) => (
                <tr
                  key={alert.id}
                  onClick={() => onSelectAlert(alert)}
                  className={`hover:bg-slate-800/30 cursor-pointer transition-colors ${rowBgStyle(alert.severity)}`}
                >
                  {/* Risk score */}
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center justify-center w-9 h-5 rounded border text-xs font-mono font-semibold ${riskBadgeStyle(alert.riskScore)}`}
                    >
                      {alert.riskScore}
                    </span>
                  </td>

                  {/* Severity */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${severityDotColor(alert.severity)}`} />
                      <span className={`text-xs capitalize ${severityTextColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                    </div>
                  </td>

                  {/* Pattern */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 whitespace-nowrap">
                      {alert.pattern.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* TX ID */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-slate-400 block truncate max-w-24">
                      {alert.transactionId}
                    </span>
                  </td>

                  {/* From */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-slate-300 block truncate max-w-24">
                      {alert.transaction?.from_account ?? "—"}
                    </span>
                  </td>

                  {/* To */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-slate-300 block truncate max-w-24">
                      {alert.transaction?.to_account ?? "—"}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-xs font-mono text-slate-200 whitespace-nowrap">
                      {alert.transaction
                        ? alert.transaction.amount.toLocaleString()
                        : "—"}
                    </span>
                    {alert.transaction?.currency && (
                      <span className="text-xs text-slate-500 ml-1">
                        {alert.transaction.currency}
                      </span>
                    )}
                  </td>

                  {/* Date */}
                  <td className="px-3 py-2">
                    <span className="text-xs text-slate-500 font-mono whitespace-nowrap">
                      {alert.transaction?.date ?? "—"}
                    </span>
                  </td>

                  {/* Country */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-slate-400">
                      {alert.transaction?.country ?? "—"}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${statusBadgeStyle(alert.status)}`}
                    >
                      {alert.status.replace("_", " ")}
                    </span>
                  </td>

                  {/* Action */}
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAlert(alert);
                      }}
                      className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded transition-colors cursor-pointer"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
