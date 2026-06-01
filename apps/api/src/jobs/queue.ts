// apps/api/src/jobs/queue.ts
import { Queue, Worker, Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../db/client";
import { runTriageAgent } from "./triageAgent";
import type { AnalysisJobPayload } from "@aml/types";

const REDIS_URL    = process.env.REDIS_URL    ?? "redis://localhost:6379";
const DETECTOR_URL = process.env.DETECTOR_URL ?? "http://localhost:8001";

// Cast required: pnpm resolves two ioredis versions (bullmq internal vs direct dep)
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;

// ─── Queue ────────────────────────────────────────────────────────────────────

export const analysisQueue = new Queue<AnalysisJobPayload>("analysis", {
  connection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
});

// ─── Worker ───────────────────────────────────────────────────────────────────

export const analysisWorker = new Worker<AnalysisJobPayload>(
  "analysis",
  async (job: Job<AnalysisJobPayload>) => {
    const { uploadId, tenantId } = job.data;
    const log = (msg: string, extra?: object) =>
      console.log(JSON.stringify({ level: "info", worker: "analysis", uploadId, msg, ...extra }));

    log("job_start");

    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING" },
    });

    // ── 1. Fetch all transactions (single query) ───────────────────────────
    const transactions = await prisma.transaction.findMany({ where: { uploadId } });
    if (transactions.length === 0) throw new Error(`No transactions for upload ${uploadId}`);

    // ── 2. Call Python detector ────────────────────────────────────────────
    const t0 = Date.now();
    const detectorResp = await fetch(`${DETECTOR_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    if (!detectorResp.ok) {
      throw new Error(`Detector service error: ${detectorResp.status}`);
    }

    const detectorData = await detectorResp.json();
    const allResults: any[]  = detectorData.results ?? [];
    const anomalies:  any[]  = allResults.filter((r: any) => r.is_anomaly);

    log("detector_done", { tx_count: allResults.length, anomaly_count: anomalies.length, ms: Date.now() - t0 });

    // ── 3. Triage agents — parallel batches ───────────────────────────────
    // Fast path: anomaly_score < 0.35 → basic alert without Claude call.
    // Triage path: score ≥ 0.35 → full agent. Run in batches of 3 to
    // stay within Claude rate limits while still parallelising.

    const TRIAGE_CONCURRENCY = 3;
    const TRIAGE_THRESHOLD   = 0.35;

    type TriageEntry = { anomaly: any; txId: string; triage: Awaited<ReturnType<typeof runTriageAgent>> };

    const fastPath: TriageEntry[] = anomalies
      .filter((a: any) => a.anomaly_score < TRIAGE_THRESHOLD)
      .flatMap((anomaly: any): TriageEntry[] => {
        const tx = transactions.find((t) => t.txId === anomaly.tx_id);
        if (!tx) return [];
        const riskScore = Math.round(anomaly.anomaly_score * 100);
        const entry: TriageEntry = {
          anomaly,
          txId: tx.id,
          triage: {
            summary: `Borderline anomaly detected (score ${anomaly.anomaly_score.toFixed(3)}).`,
            red_flags: [`Anomaly score: ${anomaly.anomaly_score.toFixed(3)}`, `Pattern: ${anomaly.pattern_type}`],
            pattern_explanation: `Transaction flagged by IsolationForest with pattern ${anomaly.pattern_type}.`,
            recommendation_reason: "Score below escalation threshold — monitoring recommended.",
            recommendation: "MONITOR",
            riskScore,
          },
        };
        return [entry];
      });

    const needsTriage = anomalies.filter((a: any) => a.anomaly_score >= TRIAGE_THRESHOLD);
    const triageResults: TriageEntry[] = [...fastPath];

    // Process in batches of TRIAGE_CONCURRENCY
    for (let i = 0; i < needsTriage.length; i += TRIAGE_CONCURRENCY) {
      const batch = needsTriage.slice(i, i + TRIAGE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (anomaly: any) => {
          const tx = transactions.find((t) => t.txId === anomaly.tx_id);
          if (!tx) return null;
          const triage = await runTriageAgent(anomaly, tx, uploadId);
          return { anomaly, txId: tx.id, triage } as TriageEntry;
        })
      );
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          triageResults.push(result.value);
        } else if (result.status === "rejected") {
          log("triage_error", { error: String(result.reason) });
        }
      }
    }

    // ── 4. Single transaction: score updates + alert creates ──────────────
    // Callback form avoids array type-inference issues with mixed models.
    // Ensures atomicity: crash between score writes and alert writes = clean retry.
    await prisma.$transaction(async (tx) => {
      // 4a. Score updates
      for (const result of allResults) {
        const dbTx = transactions.find((t) => t.txId === result.tx_id);
        if (!dbTx) continue;
        await tx.transaction.update({
          where: { id: dbTx.id },
          data: {
            anomalyScore:   result.anomaly_score,
            isoForestScore: result.iso_forest_score,
            velocityScore:  result.velocity_score,
          },
        });
      }

      // 4b. Alert creates (append-only — never UPDATE)
      for (const { anomaly, txId, triage } of triageResults) {
        await tx.alert.create({
          data: {
            tenantId,
            uploadId,
            transactionId: txId,
            patternType:    anomaly.pattern_type as any,
            riskScore:      triage.riskScore,
            recommendation: triage.recommendation as any,
            explanation: JSON.stringify({
              summary:               triage.summary,
              red_flags:             triage.red_flags,
              pattern_explanation:   triage.pattern_explanation,
              recommendation_reason: triage.recommendation_reason,
            }),
          },
        });
      }
    });

    // ── 5. Mark DONE ───────────────────────────────────────────────────────
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "DONE", processedAt: new Date() },
    });

    log("job_done", { alerts_created: triageResults.length });
  },
  { connection, concurrency: 3 }
);

analysisWorker.on("failed", (job, err) => {
  console.error(JSON.stringify({
    level: "error", worker: "analysis",
    uploadId: job?.data.uploadId,
    msg: "job_failed",
    error: err instanceof Error ? err.message : String(err),
  }));
  if (job?.data.uploadId) {
    prisma.upload
      .update({ where: { id: job.data.uploadId }, data: { status: "FAILED" } })
      .catch(console.error);
  }
});
