"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import type { Alert, AnalysisSummary, UploadResult, ParsedExplanation, RiskSeverity, Recommendation } from "@/types/aml";
import { SummaryMetricCard } from "./SummaryMetricCard";
import { FlaggedTransactionsTable } from "./FlaggedTransactionsTable";
import { TransactionDrawer } from "./TransactionDrawer";
import { InvestigationSidebar } from "./InvestigationSidebar";
import { PatternsDetectedChart } from "@/components/charts/PatternsDetectedChart";
import { AlertsTimelineChart } from "@/components/charts/AlertsTimelineChart";
import { RiskDistributionChart } from "@/components/charts/RiskDistributionChart";
import { TransactionNetworkGraph } from "@/components/network/TransactionNetworkGraph";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  uploadResult: UploadResult;
  onNewUpload: () => void;
}

// Shapes returned by the API — kept here to avoid polluting shared types
interface ApiAlert {
  id: string;
  transactionId: string;
  transaction?: {
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: string;
    country?: string;
  };
  riskScore: number;
  patternType: string;
  explanation: string;
  recommendation: string;
}

interface ApiStatus {
  status: string;
  totalRows: number;
  alertCount: number;
  highRiskCount: number;
  alerts: ApiAlert[];
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

function scoreToSeverity(score: number): RiskSeverity {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function scoreToRecommendation(score: number): Recommendation {
  if (score >= 80) return "FILE_SAR";
  if (score >= 55) return "ESCALATE";
  return "MONITOR";
}

function mapApiAlert(apiAlert: ApiAlert): Alert {
  const parsed = parseExplanation(apiAlert.explanation);

  const tx = apiAlert.transaction
    ? {
        tx_id: apiAlert.transactionId,
        from_account: apiAlert.transaction.fromAccount,
        to_account: apiAlert.transaction.toAccount,
        amount: apiAlert.transaction.amount,
        currency: apiAlert.transaction.currency,
        date: apiAlert.transaction.txDate?.slice(0, 10) ?? "",
        country: apiAlert.transaction.country,
      }
    : undefined;

  return {
    id: apiAlert.id,
    transactionId: apiAlert.transactionId,
    transaction: tx,
    riskScore: apiAlert.riskScore,
    severity: scoreToSeverity(apiAlert.riskScore),
    pattern: (apiAlert.patternType as Alert["pattern"]) ?? "UNKNOWN",
    explanation: apiAlert.explanation,
    evidence: parsed?.red_flags ?? [],
    ruleId: `API-${apiAlert.patternType}`,
    recommendedAction:
      parsed?.recommendation_reason ??
      (apiAlert.recommendation === "FILE_SAR"
        ? "File a Suspicious Activity Report immediately."
        : apiAlert.recommendation === "ESCALATE"
        ? "Escalate to senior compliance officer for review."
        : "Monitor account activity closely."),
    recommendation: (apiAlert.recommendation as Recommendation) ?? scoreToRecommendation(apiAlert.riskScore),
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
}

export function InvestigationDashboard({ uploadResult, onNewUpload }: Props) {
  const { authHeaders } = useAuth();
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [activeTab, setActiveTab] = useState<"alerts" | "graph">("alerts");
  const [exportCopied, setExportCopied] = useState(false);

  const { uploadId, fileName, rowCount } = uploadResult;

  const poll = useCallback(async () => {
    try {
      let json: ApiStatus;
      const cached = sessionStorage.getItem(`aml_${uploadId}`);
      if (cached) {
        json = JSON.parse(cached) as ApiStatus;
      } else {
        const resp = await fetch(`${API_URL}/api/analysis/${uploadId}`, {
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        json = await resp.json() as ApiStatus;
      }

      const alerts = json.alerts.map(mapApiAlert);

      // Compute unique accounts
      const accountSet = new Set<string>();
      for (const alert of alerts) {
        if (alert.transaction?.from_account) accountSet.add(alert.transaction.from_account);
        if (alert.transaction?.to_account) accountSet.add(alert.transaction.to_account);
      }

      // Compute flagged volume
      const flaggedVolume = alerts.reduce(
        (sum, a) => sum + (a.transaction?.amount ?? 0),
        0
      );

      setSummary({
        totalTransactions: json.totalRows,
        alertCount: json.alertCount,
        highRiskCount: json.highRiskCount,
        flaggedVolume,
        uniqueAccounts: accountSet.size,
        status: json.status as AnalysisSummary["status"],
        uploadId,
        alerts,
      });

      if (json.status === "DONE" || json.status === "FAILED") {
        setIsPolling(false);
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [uploadId, authHeaders]);

  useEffect(() => {
    poll();
    if (!isPolling) return;
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [poll, isPolling]);

  const handleExport = useCallback(() => {
    if (!summary) return;
    const csv = [
      ["Alert ID", "TX ID", "Risk Score", "Severity", "Pattern", "From", "To", "Amount", "Currency", "Date", "Country", "Recommendation", "Status"].join(","),
      ...summary.alerts.map((a) =>
        [
          a.id,
          a.transactionId,
          a.riskScore,
          a.severity,
          a.pattern,
          a.transaction?.from_account ?? "",
          a.transaction?.to_account ?? "",
          a.transaction?.amount ?? "",
          a.transaction?.currency ?? "",
          a.transaction?.date ?? "",
          a.transaction?.country ?? "",
          a.recommendation,
          a.status,
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `alerts_${uploadId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 2000);
  }, [summary, uploadId]);

  // Loading / initial state
  if (!summary) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
        <div className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
        <span className="text-sm">Initializing analysis...</span>
      </div>
    );
  }

  const isProcessing = summary.status === "PENDING" || summary.status === "PROCESSING";
  const isFailed = summary.status === "FAILED";
  const isDone = summary.status === "DONE";

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-100">Transaction Monitoring</h2>
            <span className="text-xs font-mono text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
              {uploadId}
            </span>
            {/* Status badge */}
            {isProcessing && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-950/30 border border-amber-900 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Processing
              </span>
            )}
            {isDone && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Analysis Complete
              </span>
            )}
            {isFailed && (
              <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/30 border border-red-900 px-2 py-0.5 rounded">
                Failed
              </span>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-1">
            {fileName} &middot; {rowCount.toLocaleString()} transactions
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport}
            disabled={!isDone || summary.alerts.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {exportCopied ? "Exported" : "Export Alerts"}
          </button>
          <button
            onClick={onNewUpload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Upload
          </button>
        </div>
      </div>

      {/* Processing banner */}
      {isProcessing && (
        <div className="bg-amber-950/20 border border-amber-900/50 rounded-md px-4 py-3 flex items-center gap-3">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
          <p className="text-amber-400 text-xs">
            Risk model is analyzing transactions... Results will appear shortly.
          </p>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="bg-red-950/20 border border-red-800 rounded-md px-4 py-3">
          <p className="text-red-400 text-sm font-medium">Analysis failed</p>
          <p className="text-red-400/70 text-xs mt-1">
            The analysis job encountered an error. Please re-upload the file or contact support.
          </p>
        </div>
      )}

      {/* Metric cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryMetricCard
          label="Transactions"
          value={summary.totalTransactions.toLocaleString()}
        />
        <SummaryMetricCard
          label="Alerts"
          value={summary.alertCount}
          variant={summary.alertCount > 0 ? "warning" : "default"}
        />
        <SummaryMetricCard
          label="High Risk"
          value={summary.highRiskCount}
          variant={summary.highRiskCount > 0 ? "danger" : "default"}
        />
        <SummaryMetricCard
          label="Flagged Volume"
          value={`${(summary.flaggedVolume / 1000).toFixed(0)}K`}
          sub={summary.flaggedVolume > 0 ? summary.flaggedVolume.toLocaleString() : undefined}
          variant={summary.flaggedVolume > 100_000 ? "warning" : "default"}
        />
        <SummaryMetricCard
          label="Unique Accounts"
          value={summary.uniqueAccounts}
        />
        <SummaryMetricCard
          label="Status"
          value={summary.status}
          variant={
            isDone ? "success" : isFailed ? "danger" : isProcessing ? "warning" : "default"
          }
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left: tabs + table/graph */}
        <div className="col-span-8 space-y-3">
          {/* Tab bar */}
          <div className="flex items-center gap-1 bg-slate-900/40 border border-slate-800 rounded-md p-1">
            {(["alerts", "graph"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  activeTab === tab
                    ? "bg-slate-700 text-slate-100"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab === "alerts"
                  ? `Flagged Transactions (${summary.alerts.length})`
                  : "Network Graph"}
              </button>
            ))}
          </div>

          {/* Alerts table */}
          {activeTab === "alerts" && (
            <FlaggedTransactionsTable
              alerts={summary.alerts}
              onSelectAlert={setSelectedAlert}
            />
          )}

          {/* Network graph */}
          {activeTab === "graph" && isDone && (
            <TransactionNetworkGraph uploadId={uploadId} />
          )}
          {activeTab === "graph" && !isDone && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-md flex items-center justify-center" style={{ height: 400 }}>
              <p className="text-slate-500 text-sm">
                Network graph available after analysis completes
              </p>
            </div>
          )}
        </div>

        {/* Right: sidebar */}
        <div className="col-span-4">
          <InvestigationSidebar alerts={summary.alerts} />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        <PatternsDetectedChart alerts={summary.alerts} />
        <AlertsTimelineChart alerts={summary.alerts} />
        <RiskDistributionChart alerts={summary.alerts} />
      </div>

      {/* Alert drawer */}
      <TransactionDrawer
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />
    </div>
  );
}
