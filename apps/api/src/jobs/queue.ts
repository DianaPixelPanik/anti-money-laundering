// apps/api/src/jobs/queue.ts
import { Queue, Worker, Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { runTriageAgent } from "./triageAgent";
import type { AnalysisJobPayload } from "@aml/types";

const REDIS_URL    = process.env.REDIS_URL    ?? "redis://localhost:6379";
const DETECTOR_URL = process.env.DETECTOR_URL ?? "http://localhost:8001";

// Cast required: pnpm resolves two ioredis versions (bullmq internal vs direct dep)
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;

// How many rows to fold into one UPDATE … FROM (VALUES …) statement.
// PostgreSQL handles thousands of rows per statement fine; cap at 1000 to
// keep parameter counts manageable (each row = 4 params → 4000 params max).
const SCORE_BATCH_SIZE = 1000;

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
          tx_id:         tx.txId,
          from_account:  tx.fromAccount,
          to_account:    tx.toAccount,
          amount:        tx.amount,
          currency:      tx.currency,
          date:          tx.txDate.toISOString(),
          type:          tx.txType    ?? undefined,
          country:       tx.country   ?? undefined,
          description:   tx.description ?? undefined,
        })),
      }),
    });

    if (!detectorResp.ok) throw new Error(`Detector service error: ${detectorResp.status}`);

    const detectorData = await detectorResp.json();
    const allResults: any[] = detectorData.results ?? [];
    const anomalies:  any[] = allResults.filter((r: any) => r.is_anomaly);

    log("detector_done", { tx_count: allResults.length, anomaly_count: anomalies.length, ms: Date.now() - t0 });

    // ── 3. Triage agents — parallel batches ───────────────────────────────
    const TRIAGE_CONCURRENCY = 3;
    const TRIAGE_THRESHOLD   = 0.35;

    type TriageEntry = { anomaly: any; txId: string; triage: Awaited<ReturnType<typeof runTriageAgent>> };

    // Fast path: borderline anomalies skip Claude entirely
    const triageResults: TriageEntry[] = anomalies
      .filter((a: any) => a.anomaly_score < TRIAGE_THRESHOLD)
      .flatMap((anomaly: any): TriageEntry[] => {
        const tx = transactions.find((t) => t.txId === anomaly.tx_id);
        if (!tx) return [];
        const riskScore = Math.round(anomaly.anomaly_score * 100);
        return [{
          anomaly, txId: tx.id,
          triage: {
            summary:               `Borderline anomaly detected (score ${anomaly.anomaly_score.toFixed(3)}).`,
            red_flags:             [`Anomaly score: ${anomaly.anomaly_score.toFixed(3)}`, `Pattern: ${anomaly.pattern_type}`],
            pattern_explanation:   `Transaction flagged by IsolationForest with pattern ${anomaly.pattern_type}.`,
            recommendation_reason: "Score below escalation threshold — monitoring recommended.",
            recommendation:        "MONITOR" as const,
            riskScore,
          },
        }];
      });

    // Triage path: parallel batches for high-risk anomalies
    const needsTriage = anomalies.filter((a: any) => a.anomaly_score >= TRIAGE_THRESHOLD);
    for (let i = 0; i < needsTriage.length; i += TRIAGE_CONCURRENCY) {
      const settled = await Promise.allSettled(
        needsTriage.slice(i, i + TRIAGE_CONCURRENCY).map(async (anomaly: any) => {
          const tx = transactions.find((t) => t.txId === anomaly.tx_id);
          if (!tx) return null;
          return { anomaly, txId: tx.id, triage: await runTriageAgent(anomaly, tx, uploadId) } as TriageEntry;
        })
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) triageResults.push(r.value);
        else if (r.status === "rejected") log("triage_error", { error: String(r.reason) });
      }
    }

    // ── 4. Atomic DB writes ────────────────────────────────────────────────
    // Uses two strategies to eliminate N+1:
    //   4a. UPDATE scores: single UPDATE … FROM (VALUES …) per 1000 rows.
    //       Prisma.sql tagged templates are fully parameterised — no injection risk.
    //   4b. CREATE alerts: createMany → single INSERT with all rows.
    await prisma.$transaction(async (tx) => {

      // 4a. Batch score updates via UPDATE … FROM (VALUES …)
      // Build a lookup map for O(1) access instead of repeated .find()
      const txById = new Map(transactions.map((t) => [t.txId, t.id]));
      type ScoreRow = { id: string; a: number; b: number; c: number };
      const scoreRows: ScoreRow[] = allResults
        .flatMap((r: any): ScoreRow[] => {
          const id = txById.get(r.tx_id);
          if (!id) return [];
          return [{ id, a: r.anomaly_score ?? 0, b: r.iso_forest_score ?? 0, c: r.velocity_score ?? 0 }];
        });

      for (let i = 0; i < scoreRows.length; i += SCORE_BATCH_SIZE) {
        const chunk = scoreRows.slice(i, i + SCORE_BATCH_SIZE);
        const values = Prisma.join(
          chunk.map((r) =>
            Prisma.sql`(${r.id}::text, ${r.a}::float8, ${r.b}::float8, ${r.c}::float8)`
          )
        );
        await tx.$executeRaw`
          UPDATE "Transaction" AS t
          SET "anomalyScore"   = v.a,
              "isoForestScore" = v.b,
              "velocityScore"  = v.c
          FROM (VALUES ${values}) AS v(id, a, b, c)
          WHERE t.id = v.id
        `;
      }

      // 4b. Bulk insert all alerts in one statement (append-only — never UPDATE)
      if (triageResults.length > 0) {
        await tx.alert.createMany({
          data: triageResults.map(({ anomaly, txId, triage }) => ({
            tenantId,
            uploadId,
            transactionId:  txId,
            patternType:    anomaly.pattern_type as any,
            riskScore:      triage.riskScore,
            recommendation: triage.recommendation as any,
            explanation:    JSON.stringify({
              summary:               triage.summary,
              red_flags:             triage.red_flags,
              pattern_explanation:   triage.pattern_explanation,
              recommendation_reason: triage.recommendation_reason,
            }),
          })),
        });
      }
    }, { timeout: 30_000 });

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
