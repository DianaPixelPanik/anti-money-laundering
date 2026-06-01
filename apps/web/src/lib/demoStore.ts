import fs from "fs";
import path from "path";

export interface StoredAnalysis {
  uploadId: string;
  fileName: string;
  rowCount: number;
  status: "DONE" | "FAILED";
  alerts: StoredAlert[];
  transactions: StoredTransaction[];
  createdAt: string;
}

export interface StoredTransaction {
  id: string;
  txId: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  currency: string;
  txDate: string;
  country?: string;
  description?: string;
  anomalyScore?: number;
}

export interface StoredAlert {
  id: string;
  transactionId: string | null;
  patternType: string;
  riskScore: number;
  recommendation: string;
  explanation: string; // JSON string
  createdAt: string;
  transaction?: {
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: string;
    country?: string;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __amlStore: Map<string, StoredAnalysis> | undefined;
}

const memStore: Map<string, StoredAnalysis> =
  global.__amlStore ?? (global.__amlStore = new Map());

const TMP_DIR = "/tmp/aml-demo";

function filePath(uploadId: string): string {
  return path.join(TMP_DIR, `${uploadId}.json`);
}

export const demoStore = {
  set(uploadId: string, data: StoredAnalysis): void {
    memStore.set(uploadId, data);
    try {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      fs.writeFileSync(filePath(uploadId), JSON.stringify(data));
    } catch {
      // /tmp write failure is non-fatal — mem cache still works this instance
    }
  },

  get(uploadId: string): StoredAnalysis | undefined {
    const cached = memStore.get(uploadId);
    if (cached) return cached;
    try {
      const raw = fs.readFileSync(filePath(uploadId), "utf8");
      const data = JSON.parse(raw) as StoredAnalysis;
      memStore.set(uploadId, data);
      return data;
    } catch {
      return undefined;
    }
  },
};
