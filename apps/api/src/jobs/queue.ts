// apps/api/src/jobs/queue.ts
import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db/client";
import type { AnalysisJobPayload, AnomalyResult } from "@aml/types";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DETECTOR_URL = process.env.DETECTOR_URL ?? "http://localhost:8001";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Queue ────────────────────────────────────────────────────────────────────

export const analysisQueue = new Queue<AnalysisJobPayload>("analysis", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

// ─── Worker ───────────────────────────────────────────────────────────────────

export const analysisWorker = new Worker<AnalysisJobPayload>(
  "analysis",
  async (job: Job<AnalysisJobPayload>) => {
    const { uploadId, tenantId } = job.data;
    console.log(`[Worker] Processing upload ${uploadId}`);

    // 1. Mark as PROCESSING
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING" },
    });

    // 2. Fetch all transactions for this upload
    const transactions = await prisma.transaction.findMany({
      where: { uploadId },
    });

    if (transactions.length === 0) {
      throw new Error(`No transactions found for upload ${uploadId}`);
    }

    // 3. Call Python detector service
    const detectorPayload = {
      upload_id: uploadId,
      transactions: transactions.map((tx) => ({
        tx_id: tx.txId,
        from_account: tx.fromAccount,
        to_account: tx.toAccount,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.txDate.toISOString(),
        type: tx.txType ?? undefined,
        country: tx.country ?? undefined,
        description: tx.description ?? undefined,
      })),
    };

    const detectorResp = await fetch(`${DETECTOR_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detectorPayload),
    });

    if (!detectorResp.ok) {
      throw new Error(`Detector service error: ${detectorResp.status}`);
    }

    const detectorData = await detectorResp.json();
    const anomalies: AnomalyResult[] = detectorData.results.filter(
      (r: AnomalyResult) => r.is_anomaly
    );

    console.log(`[Worker] Found ${anomalies.length} anomalies`);

    // 4. Update anomaly scores on transactions
    for (const result of detectorData.results) {
      const tx = transactions.find((t) => t.txId === result.tx_id);
      if (!tx) continue;
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          anomalyScore: result.anomaly_score,
          isoForestScore: result.iso_forest_score,
          velocityScore: result.velocity_score,
        },
      });
    }

    // 5. For each anomaly, call Claude for explanation
    for (const anomaly of anomalies) {
      const tx = transactions.find((t) => t.txId === anomaly.tx_id);
      if (!tx) continue;

      const explanation = await explainWithClaude(anomaly, tx);
      const riskScore = Math.round(anomaly.anomaly_score * 100);

      const recommendation =
        riskScore >= 80 ? "FILE_SAR" : riskScore >= 55 ? "ESCALATE" : "MONITOR";

      // 6. Create immutable alert record
      await prisma.alert.create({
        data: {
          tenantId,
          uploadId,
          transactionId: tx.id,
          patternType: anomaly.pattern_type as any,
          riskScore,
          explanation,
          recommendation: recommendation as any,
        },
      });
    }

    // 7. Mark upload as DONE
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "DONE", processedAt: new Date() },
    });

    console.log(`[Worker] Upload ${uploadId} analysis complete`);
  },
  { connection, concurrency: 3 }
);

// ─── Claude explanation ───────────────────────────────────────────────────────

async function explainWithClaude(
  anomaly: AnomalyResult,
  tx: {
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: Date;
    country: string | null;
    description: string | null;
  }
): Promise<string> {
  const prompt = `You are an AML compliance expert. Analyze this flagged transaction and explain why it is suspicious.

Transaction details:
- ID: ${tx.txId}
- From: ${tx.fromAccount}
- To: ${tx.toAccount}
- Amount: ${tx.amount} ${tx.currency}
- Date: ${tx.txDate.toISOString()}
- Country: ${tx.country ?? "unknown"}
- Description: ${tx.description ?? "none"}

Detection scores:
- Anomaly score: ${anomaly.anomaly_score} (0–1, higher = more suspicious)
- Isolation Forest score: ${anomaly.iso_forest_score}
- Velocity score: ${anomaly.velocity_score}
- Pattern detected: ${anomaly.pattern_type}
- Features: ${JSON.stringify(anomaly.features, null, 2)}

Respond ONLY with a JSON object (no markdown, no extra text):
{
  "summary": "One sentence explaining why this transaction is suspicious",
  "red_flags": ["flag 1", "flag 2", "flag 3"],
  "pattern_explanation": "2-3 sentences explaining the ${anomaly.pattern_type} pattern",
  "recommendation_reason": "Why this should be MONITOR / ESCALATE / FILE_SAR"
}`;

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    // Try to parse as JSON for structured explanation
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return `${parsed.summary}\n\nRed flags: ${parsed.red_flags.join("; ")}\n\n${parsed.pattern_explanation}`;
  } catch (err) {
    console.error("[Claude] Failed to get explanation:", err);
    return `Anomalous transaction detected. Pattern: ${anomaly.pattern_type}. Score: ${Math.round(anomaly.anomaly_score * 100)}/100.`;
  }
}

// Handle worker errors
analysisWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err);
  if (job?.data.uploadId) {
    prisma.upload
      .update({ where: { id: job.data.uploadId }, data: { status: "FAILED" } })
      .catch(console.error);
  }
});
