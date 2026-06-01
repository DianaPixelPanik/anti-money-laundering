// apps/api/src/jobs/queue.ts
import { Queue, Worker, Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../db/client";
import { runTriageAgent } from "./triageAgent";
import type { AnalysisJobPayload } from "@aml/types";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DETECTOR_URL = process.env.DETECTOR_URL ?? "http://localhost:8001";

// Cast required: pnpm resolves two ioredis versions (bullmq internal vs direct dep)
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;

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
    // Python service returns snake_case; cast to any[] since runtime shape differs from AnomalyResult
    const anomalies: any[] = detectorData.results.filter(
      (r: any) => r.is_anomaly
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

    // 5. For each anomaly, run the triage agent (tool_use loop) then create alert
    for (const anomaly of anomalies) {
      const tx = transactions.find((t) => t.txId === anomaly.tx_id);
      if (!tx) continue;

      const triage = await runTriageAgent(anomaly, tx, uploadId);

      const explanation = JSON.stringify({
        summary: triage.summary,
        red_flags: triage.red_flags,
        pattern_explanation: triage.pattern_explanation,
        recommendation_reason: triage.recommendation_reason,
      });

      // 6. Create immutable alert record (append-only — never UPDATE)
      await prisma.alert.create({
        data: {
          tenantId,
          uploadId,
          transactionId: tx.id,
          patternType: anomaly.pattern_type as any,
          riskScore: triage.riskScore,
          explanation,
          recommendation: triage.recommendation as any,
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

// Handle worker errors
analysisWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err);
  if (job?.data.uploadId) {
    prisma.upload
      .update({ where: { id: job.data.uploadId }, data: { status: "FAILED" } })
      .catch(console.error);
  }
});
