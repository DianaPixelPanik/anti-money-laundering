"use client";

import { useEffect } from "react";
import type { Alert, ParsedExplanation } from "@/types/aml";

interface Props {
  alert: Alert | null;
  onClose: () => void;
}

function parseExplanation(raw: string): ParsedExplanation | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.summary) return parsed as ParsedExplanation;
    return null;
  } catch {
    return null;
  }
}

function riskColor(score: number): { text: string; bg: string; border: string } {
  if (score >= 75) return { text: "text-red-400", bg: "bg-red-950/40", border: "border-red-800" };
  if (score >= 45) return { text: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-800" };
  return { text: "text-slate-400", bg: "bg-slate-800", border: "border-slate-700" };
}

function severityLabel(severity: string): { text: string; dot: string } {
  if (severity === "high") return { text: "text-red-400", dot: "bg-red-400" };
  if (severity === "medium") return { text: "text-amber-400", dot: "bg-amber-400" };
  return { text: "text-slate-400", dot: "bg-slate-500" };
}

function recommendationStyle(rec: string): string {
  if (rec === "FILE_SAR") return "text-red-400 bg-red-950/40 border-red-800";
  if (rec === "ESCALATE") return "text-amber-400 bg-amber-950/40 border-amber-800";
  return "text-slate-400 bg-slate-800 border-slate-700";
}

export function TransactionDrawer({ alert, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!alert) return null;

  const parsed = parseExplanation(alert.explanation);
  const risk = riskColor(alert.riskScore);
  const sev = severityLabel(alert.severity);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-full w-[420px] bg-slate-900 border-l border-slate-800 z-50 flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Alert Detail"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <span className="text-slate-100 text-sm font-semibold">Alert Detail</span>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Risk score + badges */}
          <div className="px-5 py-4 border-b border-slate-800 space-y-3">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-2 rounded-md border ${risk.bg} ${risk.border}`}>
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-0.5">Risk Score</p>
                <p className={`text-3xl font-mono font-bold leading-none ${risk.text}`}>
                  {alert.riskScore}
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                  <span className={`text-xs font-medium capitalize ${sev.text}`}>
                    {alert.severity} severity
                  </span>
                </div>
                <span className={`inline-block text-xs px-2 py-0.5 rounded border font-medium ${recommendationStyle(alert.recommendation)}`}>
                  {alert.recommendation.replace("_", " ")}
                </span>
              </div>
            </div>

            {/* Pattern badge */}
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Pattern</p>
              <span className="inline-block text-xs font-mono px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-300">
                {alert.pattern.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Transaction details */}
          <div className="px-5 py-4 border-b border-slate-800">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">Transaction Details</p>
            <dl className="space-y-2">
              <div className="flex justify-between items-start gap-4">
                <dt className="text-slate-500 text-xs">TX ID</dt>
                <dd className="text-slate-300 text-xs font-mono text-right truncate max-w-[200px]">
                  {alert.transactionId}
                </dd>
              </div>
              {alert.transaction && (
                <>
                  <div className="flex justify-between items-start gap-4">
                    <dt className="text-slate-500 text-xs">From</dt>
                    <dd className="text-slate-300 text-xs font-mono text-right truncate max-w-[200px]">
                      {alert.transaction.from_account}
                    </dd>
                  </div>
                  <div className="flex justify-between items-start gap-4">
                    <dt className="text-slate-500 text-xs">To</dt>
                    <dd className="text-slate-300 text-xs font-mono text-right truncate max-w-[200px]">
                      {alert.transaction.to_account}
                    </dd>
                  </div>
                  <div className="flex justify-between items-start gap-4">
                    <dt className="text-slate-500 text-xs">Amount</dt>
                    <dd className="text-slate-100 text-sm font-mono text-right font-semibold">
                      {alert.transaction.amount.toLocaleString()}{" "}
                      <span className="text-slate-400 text-xs font-normal">
                        {alert.transaction.currency ?? ""}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-start gap-4">
                    <dt className="text-slate-500 text-xs">Date</dt>
                    <dd className="text-slate-400 text-xs font-mono">{alert.transaction.date}</dd>
                  </div>
                  {alert.transaction.country && (
                    <div className="flex justify-between items-start gap-4">
                      <dt className="text-slate-500 text-xs">Country</dt>
                      <dd className="text-slate-400 text-xs font-mono">{alert.transaction.country}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          </div>

          {/* Why flagged */}
          {parsed && (
            <>
              <div className="px-5 py-4 border-b border-slate-800">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Why Flagged</p>
                <p className="text-slate-300 text-xs leading-relaxed">{parsed.summary}</p>
              </div>

              {/* Evidence */}
              {parsed.red_flags.length > 0 && (
                <div className="px-5 py-4 border-b border-slate-800">
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Evidence</p>
                  <ul className="space-y-1.5">
                    {parsed.red_flags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-red-500 shrink-0 mt-1.5" />
                        <span className="text-slate-400 text-xs leading-relaxed">{flag}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pattern explanation */}
              {parsed.pattern_explanation && (
                <div className="px-5 py-4 border-b border-slate-800">
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">
                    Pattern Explanation
                  </p>
                  <p className="text-slate-400 text-xs leading-relaxed">{parsed.pattern_explanation}</p>
                </div>
              )}
            </>
          )}

          {/* Evidence array (fallback if no parsed explanation) */}
          {!parsed && alert.evidence.length > 0 && (
            <div className="px-5 py-4 border-b border-slate-800">
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Evidence</p>
              <ul className="space-y-1.5">
                {alert.evidence.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-red-500 shrink-0 mt-1.5" />
                    <span className="text-slate-400 text-xs">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rule ID + recommended action */}
          <div className="px-5 py-4 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-500 text-xs uppercase tracking-wider">Rule ID</p>
              <span className="text-xs font-mono text-slate-400">{alert.ruleId}</span>
            </div>
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Recommended Action</p>
            <p className="text-slate-300 text-xs leading-relaxed">{alert.recommendedAction}</p>
          </div>

          {/* Action buttons */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">Actions</p>
            <button className="w-full py-2 text-xs font-medium bg-red-950/40 hover:bg-red-950/60 border border-red-800 text-red-400 rounded-md transition-colors cursor-pointer">
              Create SAR
            </button>
            <button className="w-full py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-colors cursor-pointer">
              Mark as False Positive
            </button>
            <button className="w-full py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-colors cursor-pointer">
              Add Note
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
