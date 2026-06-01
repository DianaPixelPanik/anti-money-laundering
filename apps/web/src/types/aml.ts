export type RiskSeverity = 'low' | 'medium' | 'high';

export type PatternType =
  | 'UNUSUAL_VELOCITY'
  | 'LARGE_AMOUNT'
  | 'UNKNOWN_COUNTERPARTY'
  | 'ROUND_AMOUNT_STRUCTURING'
  | 'CROSS_BORDER_RISK'
  | 'SMURFING'
  | 'LAYERING'
  | 'ROUND_TRIPPING'
  | 'GEOGRAPHIC_ANOMALY'
  | 'STRUCTURING'
  | 'UNKNOWN';

export type AlertStatus = 'PENDING' | 'REVIEWED' | 'FALSE_POSITIVE' | 'SAR_FILED';

export type Recommendation = 'MONITOR' | 'ESCALATE' | 'FILE_SAR';

export type UploadStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface Transaction {
  tx_id: string;
  from_account: string;
  to_account: string;
  amount: number;
  currency?: string;
  date: string;
  type?: string;
  country?: string;
  description?: string;
}

export interface Alert {
  id: string;
  transactionId: string;
  transaction?: Transaction;
  riskScore: number;
  severity: RiskSeverity;
  pattern: PatternType;
  explanation: string;
  evidence: string[];
  ruleId: string;
  recommendedAction: string;
  recommendation: Recommendation;
  status: AlertStatus;
  createdAt: string;
}

export interface ParsedExplanation {
  summary: string;
  red_flags: string[];
  pattern_explanation: string;
  recommendation_reason: string;
}

export interface UploadResult {
  uploadId: string;
  fileName: string;
  rowCount: number;
  detectedColumns: string[];
  validationErrors: string[];
  status: UploadStatus;
}

export interface AnalysisSummary {
  totalTransactions: number;
  alertCount: number;
  highRiskCount: number;
  flaggedVolume: number;
  uniqueAccounts: number;
  status: UploadStatus;
  uploadId: string;
  alerts: Alert[];
}

export interface AccountNode {
  id: string;
  totalSent: number;
  totalReceived: number;
  flaggedCount: number;
  riskScore: number;
  currency: string;
}

export interface TransactionEdge {
  id: string;
  txId: string;
  source: string;
  target: string;
  amount: number;
  currency: string;
  date: string;
  isSuspicious: boolean;
  patternType?: PatternType;
  riskScore?: number;
}
