import { NextResponse } from "next/server";
import Papa from "papaparse";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { demoStore, type StoredAlert, type StoredTransaction } from "@/lib/demoStore";
import { runDetectionRules } from "@/lib/detectionRules";
import type { Transaction } from "@/types/aml";

const REQUIRED_COLS = ["tx_id", "from_account", "to_account", "amount", "date"];

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const csvText = await file.text();

    // Parse CSV
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const cols = parsed.meta.fields ?? [];
    const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const rows = parsed.data;
    if (rows.length === 0) return NextResponse.json({ error: "CSV file is empty" }, { status: 400 });

    // Map to Transaction type
    const transactions: Transaction[] = rows
      .map((r) => ({
        tx_id: String(r.tx_id ?? ""),
        from_account: String(r.from_account ?? ""),
        to_account: String(r.to_account ?? ""),
        amount: parseFloat(String(r.amount ?? "0")),
        currency: r.currency ?? "EUR",
        date: String(r.date ?? ""),
        type: r.type,
        country: r.country,
        description: r.description,
      }))
      .filter((t) => t.tx_id && !isNaN(t.amount));

    // Run detection rules (client-side equivalent)
    const localAlerts = runDetectionRules(transactions);

    // Optionally enrich with Claude explanations
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const enrichedAlerts = anthropicKey
      ? await enrichWithClaude(localAlerts, anthropicKey)
      : localAlerts;

    const uploadId = `demo-${randomUUID().slice(0, 12)}`;

    const storedTransactions: StoredTransaction[] = transactions.map((t, i) => ({
      id: `tx-${i}`,
      txId: t.tx_id,
      fromAccount: t.from_account,
      toAccount: t.to_account,
      amount: t.amount,
      currency: t.currency ?? "EUR",
      txDate: t.date,
      country: t.country,
      description: t.description,
      anomalyScore: enrichedAlerts.find((a) => a.transactionId === t.tx_id)
        ? (enrichedAlerts.find((a) => a.transactionId === t.tx_id)!.riskScore / 100)
        : 0,
    }));

    const storedAlerts: StoredAlert[] = enrichedAlerts.map((a, i) => {
      const tx = transactions.find((t) => t.tx_id === a.transactionId);
      return {
        id: `alert-${i}`,
        transactionId: a.transactionId,
        patternType: a.pattern,
        riskScore: a.riskScore,
        recommendation: a.recommendation,
        explanation: a.explanation,
        createdAt: new Date().toISOString(),
        transaction: tx
          ? {
              txId: tx.tx_id,
              fromAccount: tx.from_account,
              toAccount: tx.to_account,
              amount: tx.amount,
              currency: tx.currency ?? "EUR",
              txDate: tx.date,
              country: tx.country,
            }
          : undefined,
      };
    });

    demoStore.set(uploadId, {
      uploadId,
      fileName: file.name,
      rowCount: transactions.length,
      status: "DONE",
      alerts: storedAlerts,
      transactions: storedTransactions,
      createdAt: new Date().toISOString(),
    });

    const highRiskCount = storedAlerts.filter((a) => a.riskScore >= 70).length;

    return NextResponse.json(
      {
        uploadId,
        status: "DONE",
        totalRows: transactions.length,
        alertCount: storedAlerts.length,
        highRiskCount,
        alerts: storedAlerts,
        transactions: storedTransactions,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[demo/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function enrichWithClaude(
  alerts: ReturnType<typeof runDetectionRules>,
  apiKey: string
): Promise<ReturnType<typeof runDetectionRules>> {
  if (alerts.length === 0) return alerts;

  const client = new Anthropic({ apiKey });
  const enriched = await Promise.allSettled(
    alerts.slice(0, 5).map(async (alert) => {
      const tx = alert.transaction;
      if (!tx) return alert;
      try {
        const resp = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: `AML alert. TX ${tx.tx_id}: ${tx.from_account}→${tx.to_account}, ${tx.amount} ${tx.currency}, ${tx.date}, country: ${tx.country ?? "unknown"}. Pattern: ${alert.pattern}. Evidence: ${alert.evidence.join("; ")}. In one sentence, explain why this is suspicious for a compliance analyst. Be concise and factual.`,
            },
          ],
        });
        const text = resp.content[0].type === "text" ? resp.content[0].text : alert.explanation;
        return { ...alert, explanation: text };
      } catch {
        return alert;
      }
    })
  );

  return [
    ...enriched.map((r, i) => (r.status === "fulfilled" ? r.value : alerts[i])),
    ...alerts.slice(5),
  ];
}
