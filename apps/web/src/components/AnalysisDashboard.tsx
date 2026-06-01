"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from "recharts";
import type { AnalysisStatus, AlertSummary } from "@aml/types";
import { TransactionGraph } from "./TransactionGraph";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const PATTERN_COLORS: Record<string, string> = {
  SMURFING: "#f97316",
  LAYERING: "#ef4444",
  STRUCTURING: "#eab308",
  UNUSUAL_VELOCITY: "#8b5cf6",
  ROUND_TRIPPING: "#06b6d4",
  GEOGRAPHIC_ANOMALY: "#84cc16",
  UNKNOWN: "#6b7280",
};

const RISK_COLOR = (score: number) =>
  score >= 80 ? "#ef4444" : score >= 55 ? "#f97316" : "#eab308";

interface Props {
  uploadId: string;
  onReset: () => void;
}

export function AnalysisDashboard({ uploadId, onReset }: Props) {
  const [data, setData] = useState<AnalysisStatus | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertSummary | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [activeTab, setActiveTab] = useState<"alerts" | "graph">("alerts");

  // Poll for status
  useEffect(() => {
    const poll = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/analysis/${uploadId}`);
        if (resp.ok) {
          const json: AnalysisStatus = await resp.json();
          setData(json);
          if (json.status === "DONE" || json.status === "FAILED") {
            setIsPolling(false);
          }
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    };

    poll();
    if (!isPolling) return;
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [uploadId, isPolling]);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-12 h-12 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        <p className="text-gray-400">Initializing analysis...</p>
      </div>
    );
  }

  // Chart data
  const patternCounts = data.alerts.reduce((acc, a) => {
    acc[a.patternType] = (acc[a.patternType] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const patternChartData = Object.entries(patternCounts).map(([name, count]) => ({
    name: name.replace("_", " "),
    count,
    fill: PATTERN_COLORS[name] ?? "#6b7280",
  }));

  const riskDistribution = [
    { name: "High (80–100)", value: data.alerts.filter(a => a.riskScore >= 80).length, fill: "#ef4444" },
    { name: "Medium (55–79)", value: data.alerts.filter(a => a.riskScore >= 55 && a.riskScore < 80).length, fill: "#f97316" },
    { name: "Low (<55)", value: data.alerts.filter(a => a.riskScore < 55).length, fill: "#eab308" },
  ].filter(d => d.value > 0);

  const isProcessing = data.status === "PENDING" || data.status === "PROCESSING";

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Analysis Results</h2>
          <p className="text-gray-400 text-sm mt-1">Upload ID: {uploadId}</p>
        </div>
        <div className="flex items-center gap-3">
          {isProcessing && (
            <span className="flex items-center gap-2 text-blue-400 text-sm">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Analyzing...
            </span>
          )}
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            ← New Upload
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Transactions" value={data.totalRows} color="blue" />
        <KpiCard label="Alerts Generated" value={data.alertCount} color="yellow" />
        <KpiCard label="High Risk" value={data.highRiskCount} color="red" />
        <KpiCard
          label="Status"
          value={data.status}
          color={data.status === "DONE" ? "green" : "yellow"}
          isText
        />
      </div>

      {/* Charts row */}
      {data.alerts.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Pattern distribution bar chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-300 mb-4">Patterns Detected</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={patternChartData}>
                <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                  labelStyle={{ color: "#f9fafb" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {patternChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk level pie chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-300 mb-4">Risk Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={riskDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {riskDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#9ca3af" }}
                />
                <Tooltip
                  contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {(["alerts", "graph"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "alerts" ? `Flagged Transactions (${data.alerts.length})` : "Network Graph"}
          </button>
        ))}
      </div>

      {/* Network graph */}
      {activeTab === "graph" && data.status === "DONE" && (
        <TransactionGraph uploadId={uploadId} />
      )}
      {activeTab === "graph" && data.status !== "DONE" && (
        <div className="flex items-center justify-center h-64 text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-xl">
          Graph available after analysis completes
        </div>
      )}

      {/* Alerts table + detail panel */}
      {activeTab === "alerts" && (
      <>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            Flagged Transactions ({data.alerts.length})
          </h3>
          {data.alerts.length > 0 && (
            <span className="text-xs text-gray-500">Click row for AI explanation</span>
          )}
        </div>

        {data.alerts.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            {isProcessing ? "Analysis in progress..." : "No suspicious patterns detected"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50">
                <tr>
                  {["Risk", "Pattern", "From", "To", "Amount", "Date", "Action"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-gray-400 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {data.alerts.map((alert) => (
                  <tr
                    key={alert.id}
                    onClick={() => setSelectedAlert(selectedAlert?.id === alert.id ? null : alert)}
                    className="hover:bg-gray-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center justify-center w-10 h-6 rounded text-xs font-bold"
                        style={{
                          background: `${RISK_COLOR(alert.riskScore)}20`,
                          color: RISK_COLOR(alert.riskScore),
                          border: `1px solid ${RISK_COLOR(alert.riskScore)}40`,
                        }}
                      >
                        {alert.riskScore}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: `${PATTERN_COLORS[alert.patternType] ?? "#6b7280"}20`,
                          color: PATTERN_COLORS[alert.patternType] ?? "#9ca3af",
                        }}
                      >
                        {alert.patternType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">
                      {alert.transaction?.fromAccount ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">
                      {alert.transaction?.toAccount ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      {alert.transaction
                        ? `${alert.transaction.amount.toLocaleString()} ${alert.transaction.currency}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {alert.transaction
                        ? new Date(alert.transaction.txDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <RecommendationBadge rec={alert.recommendation} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert detail panel */}
      {selectedAlert && (
        <AlertExplanationPanel
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
        />
      )}
      </>
      )}
    </div>
  );
}

interface ParsedExplanation {
  summary: string;
  red_flags: string[];
  pattern_explanation: string;
  recommendation_reason: string;
}

function parseExplanation(raw: string): ParsedExplanation | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.summary && parsed.red_flags) return parsed as ParsedExplanation;
    return null;
  } catch {
    return null;
  }
}

function AlertExplanationPanel({
  alert,
  onClose,
}: {
  alert: AlertSummary;
  onClose: () => void;
}) {
  const parsed = parseExplanation(alert.explanation);
  const riskColor = RISK_COLOR(alert.riskScore);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-white text-sm">AI Analysis</h3>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: `${PATTERN_COLORS[alert.patternType] ?? "#6b7280"}20`,
              color: PATTERN_COLORS[alert.patternType] ?? "#9ca3af",
            }}
          >
            {alert.patternType.replace(/_/g, " ")}
          </span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: `${riskColor}20`, color: riskColor }}
          >
            Risk {alert.riskScore}/100
          </span>
        </div>
        <div className="flex items-center gap-3">
          <RecommendationBadge rec={alert.recommendation} />
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-1"
          >
            ×
          </button>
        </div>
      </div>

      {parsed ? (
        <div className="divide-y divide-gray-800">
          {/* Brief Summary */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Brief Summary
            </p>
            <p className="text-sm text-white leading-relaxed">{parsed.summary}</p>
          </div>

          {/* Red Flags */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Red Flags
            </p>
            <ul className="space-y-2">
              {parsed.red_flags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                  <svg
                    className="w-4 h-4 mt-0.5 shrink-0 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  {flag}
                </li>
              ))}
            </ul>
          </div>

          {/* Detailed Explanation */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Detailed Explanation
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">{parsed.pattern_explanation}</p>
          </div>

          {/* Recommendation Rationale */}
          <div className="px-5 py-4 bg-gray-800/30">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Recommendation Rationale
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">{parsed.recommendation_reason}</p>
          </div>
        </div>
      ) : (
        /* Fallback for plain-text explanations (legacy data) */
        <div className="px-5 py-4">
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{alert.explanation}</p>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label, value, color, isText,
}: {
  label: string; value: string | number; color: string; isText?: boolean;
}) {
  const colors: Record<string, string> = {
    blue: "text-blue-400", yellow: "text-yellow-400",
    red: "text-red-400", green: "text-green-400",
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color] ?? "text-white"} ${isText ? "text-base" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function RecommendationBadge({ rec }: { rec: string }) {
  const styles: Record<string, string> = {
    MONITOR: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    ESCALATE: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    FILE_SAR: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${styles[rec] ?? ""}`}>
      {rec}
    </span>
  );
}
