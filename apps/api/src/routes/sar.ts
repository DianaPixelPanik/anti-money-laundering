// apps/api/src/routes/sar.ts
import { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db/client";
import { randomUUID } from "crypto";
import { alertIdParam, zodError } from "../lib/schemas";
import type { SARReport, SARSubject, Recommendation, PatternType } from "@aml/types";

let _anthropic: Anthropic | null = null;
const getClient = () => {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
};

export async function sarRoutes(app: FastifyInstance) {
  /**
   * POST /api/sar/:alertId
   * Generate a Suspicious Activity Report for a given alert.
   * Queries all transactions in the same upload for full context.
   * Uses Claude to write the formal SAR narrative.
   */
  app.post<{
    Params: { alertId: string };
  }>("/:alertId", async (request, reply) => {
    const { tenantId } = request.user;

    const paramsParsed = alertIdParam.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: zodError(paramsParsed.error.issues) });
    }
    const { alertId } = paramsParsed.data;

    // 1. Load alert with transaction and upload context — always filter by tenantId
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        transaction: true,
        upload: { select: { id: true, filename: true, rowCount: true } },
      },
    });

    if (!alert) return reply.status(404).send({ error: "Alert not found" });
    if (alert.tenantId !== tenantId) return reply.status(403).send({ error: "Forbidden" });
    if (!alert.transaction) return reply.status(422).send({ error: "Alert has no linked transaction" });

    const { transaction: tx, upload } = alert;

    // 2. Load all transactions in the same upload involving either account (for context)
    const relatedTxs = await prisma.transaction.findMany({
      where: {
        uploadId: upload.id,
        OR: [
          { fromAccount: tx.fromAccount },
          { toAccount: tx.fromAccount },
          { fromAccount: tx.toAccount },
          { toAccount: tx.toAccount },
        ],
      },
      select: {
        txId: true,
        fromAccount: true,
        toAccount: true,
        amount: true,
        currency: true,
        txDate: true,
        country: true,
        description: true,
        alerts: { select: { id: true } },
      },
      orderBy: { txDate: "asc" },
      take: 100,
    });

    // 3. Build subject profile for the originating account
    const flaggedAlertIds = new Set(relatedTxs.flatMap((t) => t.alerts.map((a) => a.id)));

    const connectedAccounts = [
      ...new Set(
        relatedTxs.flatMap((t) => [t.fromAccount, t.toAccount])
      ),
    ].filter((a) => a !== tx.fromAccount);

    const subject: SARSubject = {
      accountId: tx.fromAccount,
      totalVolume: relatedTxs
        .filter((t) => t.fromAccount === tx.fromAccount)
        .reduce((s, t) => s + t.amount, 0),
      currency: tx.currency,
      transactionCount: relatedTxs.length,
      alertCount: relatedTxs.filter((t) => t.alerts.length > 0).length,
      connectedAccounts: connectedAccounts.slice(0, 20),
    };

    // 4. Generate SAR narrative with Claude
    const narrative = await generateSARNarrative(alert, tx, subject, relatedTxs);

    // 5. Assemble the report (no DB write — alerts are append-only)
    const report: SARReport = {
      reportId: `SAR-${randomUUID().slice(0, 8).toUpperCase()}`,
      generatedAt: new Date().toISOString(),
      tenantId,
      alert: {
        id: alert.id,
        patternType: alert.patternType as PatternType,
        riskScore: alert.riskScore,
        recommendation: alert.recommendation as Recommendation,
        createdAt: alert.createdAt.toISOString(),
      },
      subject,
      transactions: relatedTxs.map((t) => ({
        txId: t.txId,
        fromAccount: t.fromAccount,
        toAccount: t.toAccount,
        amount: t.amount,
        currency: t.currency,
        txDate: t.txDate.toISOString(),
        country: t.country ?? undefined,
        description: t.description ?? undefined,
        isFlagged: t.alerts.length > 0,
      })),
      narrative: narrative.narrative,
      redFlags: narrative.redFlags,
      evidenceSummary: narrative.evidenceSummary,
      filingRecommendation: alert.recommendation as Recommendation,
    };

    return reply.status(200).send(report);
  });
}

// ─── Claude SAR narrative generation ─────────────────────────────────────────

interface NarrativeResult {
  narrative: string;
  redFlags: string[];
  evidenceSummary: string;
}

async function generateSARNarrative(
  alert: {
    patternType: string;
    riskScore: number;
    recommendation: string;
    explanation: string;
  },
  tx: {
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: Date;
    country: string | null;
    description: string | null;
  },
  subject: SARSubject,
  relatedTxs: Array<{
    txId: string;
    fromAccount: string;
    toAccount: string;
    amount: number;
    currency: string;
    txDate: Date;
    country: string | null;
  }>
): Promise<NarrativeResult> {
  const txSample = relatedTxs.slice(0, 20).map((t) =>
    `  ${t.txDate.toISOString().slice(0, 10)} | ${t.fromAccount} → ${t.toAccount} | ${t.amount} ${t.currency} | ${t.country ?? "?"}`
  ).join("\n");

  const prompt = `You are a compliance officer writing a Suspicious Activity Report (SAR) for submission to financial regulators.

ALERT DETAILS
Pattern type:     ${alert.patternType}
Risk score:       ${alert.riskScore}/100
Recommendation:   ${alert.recommendation}
AI explanation:   ${alert.explanation}

PRIMARY TRANSACTION
  ID:       ${tx.txId}
  From:     ${tx.fromAccount}
  To:       ${tx.toAccount}
  Amount:   ${tx.amount} ${tx.currency}
  Date:     ${tx.txDate.toISOString()}
  Country:  ${tx.country ?? "unknown"}
  Desc:     ${tx.description ?? "none"}

SUBJECT ACCOUNT PROFILE (${subject.accountId})
  Total volume:        ${Math.round(subject.totalVolume)} ${subject.currency}
  Transactions:        ${subject.transactionCount}
  Flagged:             ${subject.alertCount}
  Connected accounts:  ${subject.connectedAccounts.length}

RELATED TRANSACTIONS (sample of ${relatedTxs.length})
${txSample}

Write a formal SAR narrative. Respond ONLY with a valid JSON object — no markdown, no extra text:
{
  "narrative": "3–5 paragraph formal SAR narrative suitable for regulator submission. Cover: who, what, when, where, why suspicious, and what action is recommended. Use professional regulatory language.",
  "red_flags": ["flag 1", "flag 2", "..."],
  "evidence_summary": "2–3 sentences summarising the quantitative evidence (amounts, counts, scores, patterns)"
}`;

  try {
    const response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    return {
      narrative: parsed.narrative ?? "Narrative generation failed.",
      redFlags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
      evidenceSummary: parsed.evidence_summary ?? "",
    };
  } catch (err) {
    console.error("[SAR] Claude generation failed:", err);
    return {
      narrative: `Suspicious activity detected for account ${tx.fromAccount}. Pattern: ${alert.patternType}. Risk score: ${alert.riskScore}/100. Manual review required.`,
      redFlags: [`Pattern: ${alert.patternType}`, `Risk score: ${alert.riskScore}/100`],
      evidenceSummary: `Account ${tx.fromAccount} flagged with risk score ${alert.riskScore}.`,
    };
  }
}
