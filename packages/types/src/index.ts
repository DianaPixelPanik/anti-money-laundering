// packages/types/src/index.ts

export type PatternType =
  | "SMURFING"
  | "LAYERING"
  | "STRUCTURING"
  | "UNUSUAL_VELOCITY"
  | "ROUND_TRIPPING"
  | "GEOGRAPHIC_ANOMALY"
  | "UNKNOWN";

export type Recommendation = "MONITOR" | "ESCALATE" | "FILE_SAR";

export type UploadStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

// ─── CSV Row (raw input) ──────────────────────────────────────────────────────

export interface CsvTransactionRow {
  tx_id: string;
  from_account: string;
  to_account: string;
  amount: string | number;
  currency?: string;
  date: string;
  type?: string;
  country?: string;
  description?: string;
}

// ─── Anomaly Detection Result (from Python service) ──────────────────────────

export interface AnomalyResult {
  txId: string;
  anomalyScore: number;       // 0–1
  isoForestScore: number;
  velocityScore: number;
  patternType: PatternType;
  isAnomaly: boolean;
}

// ─── Alert ────────────────────────────────────────────────────────────────────

export interface AlertPayload {
  transactionId: string;
  patternType: PatternType;
  riskScore: number;
  explanation: string;
  recommendation: Recommendation;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface UploadResponse {
  uploadId: string;
  status: UploadStatus;
  rowCount: number;
}

export interface AnalysisStatus {
  uploadId: string;
  status: UploadStatus;
  totalRows: number;
  alertCount: number;
  highRiskCount: number;
  alerts: AlertSummary[];
}

export interface AlertSummary {
  id: string;
  transactionId: string | null;
  patternType: PatternType;
  riskScore: number;
  recommendation: Recommendation;
  explanation: string;
  createdAt: string;
  transaction?: {
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: string;
  };
}

// ─── BullMQ Job Payloads ─────────────────────────────────────────────────────

export interface AnalysisJobPayload {
  uploadId: string;
  tenantId: string;
}

export interface ClaudeExplainJobPayload {
  alertId: string;
  uploadId: string;
  tenantId: string;
  anomalyResult: AnomalyResult;
  transactionContext: {
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: string;
    country?: string;
    description?: string;
  };
}
