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

// ─── Ralph Loop ──────────────────────────────────────────────────────────────

export interface RalphDecision {
  id: string;
  alertId: string;
  tenantId: string;
  decision: Recommendation;
  riskScore: number;
  reasoning: string;
  iterations: number;
  sarFiled: boolean;
  createdAt: string;
}

// ─── Triage Agent ────────────────────────────────────────────────────────────

export interface TriageResult {
  summary: string;
  red_flags: string[];
  pattern_explanation: string;
  recommendation_reason: string;
  recommendation: Recommendation;
  riskScore: number;
}

// ─── SAR Report ───────────────────────────────────────────────────────────────

export interface SARSubject {
  accountId: string;
  totalVolume: number;
  currency: string;
  transactionCount: number;
  alertCount: number;
  connectedAccounts: string[];
}

export interface SARReport {
  reportId: string;
  generatedAt: string;
  tenantId: string;
  alert: {
    id: string;
    patternType: PatternType;
    riskScore: number;
    recommendation: Recommendation;
    createdAt: string;
  };
  subject: SARSubject;
  transactions: Array<{
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: string;
    country?: string;
    description?: string;
    isFlagged: boolean;
  }>;
  narrative: string;
  redFlags: string[];
  evidenceSummary: string;
  filingRecommendation: Recommendation;
}

// ─── Transaction Graph ────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;          // account id
  riskScore: number;   // max risk score from alerts touching this account
  alertCount: number;
  totalSent: number;
  totalReceived: number;
  currency: string;
}

export interface GraphEdge {
  id: string;          // transaction db id
  txId: string;        // original CSV tx_id
  source: string;      // fromAccount
  target: string;      // toAccount
  amount: number;
  currency: string;
  txDate: string;
  isSuspicious: boolean;
  patternType?: PatternType;
  riskScore?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
