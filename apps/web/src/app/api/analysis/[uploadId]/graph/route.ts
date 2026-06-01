import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demoStore";

export async function GET(
  _request: Request,
  { params }: { params: { uploadId: string } }
) {
  const data = demoStore.get(params.uploadId);
  if (!data) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const alertByTxId = new Map(
    data.alerts.map((a) => [a.transactionId, { patternType: a.patternType, riskScore: a.riskScore }])
  );
  // Also index by internal tx-N id for lookups via tx.id
  const alertByInternalId = new Map(
    data.transactions
      .filter((tx) => alertByTxId.has(tx.txId))
      .map((tx) => [tx.id, alertByTxId.get(tx.txId)!])
  );

  interface NodeInfo {
    id: string;
    riskScore: number;
    flaggedCount: number;
    totalSent: number;
    totalReceived: number;
    currency: string;
  }

  const nodeMap = new Map<string, NodeInfo>();
  const ensureNode = (id: string, currency: string): NodeInfo => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, riskScore: 0, flaggedCount: 0, totalSent: 0, totalReceived: 0, currency });
    }
    return nodeMap.get(id)!;
  };

  const edges = data.transactions.map((tx) => {
    const alert = alertByTxId.get(tx.txId) ?? alertByInternalId.get(tx.id);
    const fromNode = ensureNode(tx.fromAccount, tx.currency);
    const toNode = ensureNode(tx.toAccount, tx.currency);

    fromNode.totalSent += tx.amount;
    toNode.totalReceived += tx.amount;

    if (alert) {
      if (alert.riskScore > fromNode.riskScore) fromNode.riskScore = alert.riskScore;
      if (alert.riskScore > toNode.riskScore) toNode.riskScore = alert.riskScore;
      fromNode.flaggedCount += 1;
    }

    return {
      id: tx.id,
      txId: tx.txId,
      source: tx.fromAccount,
      target: tx.toAccount,
      amount: tx.amount,
      currency: tx.currency,
      txDate: tx.txDate,
      isSuspicious: !!alert,
      patternType: alert?.patternType,
      riskScore: alert?.riskScore,
    };
  });

  return NextResponse.json({ nodes: Array.from(nodeMap.values()), edges });
}
