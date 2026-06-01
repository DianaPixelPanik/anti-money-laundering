import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demoStore";

export async function GET(
  _request: Request,
  { params }: { params: { uploadId: string } }
) {
  const data = demoStore.get(params.uploadId);
  if (!data) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const highRiskCount = data.alerts.filter((a) => a.riskScore >= 70).length;

  return NextResponse.json({
    uploadId: data.uploadId,
    status: data.status,
    totalRows: data.rowCount,
    alertCount: data.alerts.length,
    highRiskCount,
    alerts: data.alerts.map((a) => ({
      id: a.id,
      transactionId: a.transactionId,
      patternType: a.patternType,
      riskScore: a.riskScore,
      recommendation: a.recommendation,
      explanation: a.explanation,
      createdAt: a.createdAt,
      transaction: a.transaction
        ? {
            txId: a.transaction.txId,
            fromAccount: a.transaction.fromAccount,
            toAccount: a.transaction.toAccount,
            amount: a.transaction.amount,
            currency: a.transaction.currency,
            txDate: a.transaction.txDate,
          }
        : undefined,
    })),
  });
}
