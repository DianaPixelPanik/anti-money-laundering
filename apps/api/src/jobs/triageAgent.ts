// apps/api/src/jobs/triageAgent.ts
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db/client";
import type { TriageResult, Recommendation } from "@aml/types";

// Python detector returns snake_case — this mirrors the actual runtime shape
interface PythonAnomalyResult {
  tx_id: string;
  anomaly_score: number;
  iso_forest_score: number;
  velocity_score: number;
  pattern_type: string;
  is_anomaly: boolean;
  features?: Record<string, unknown>;
}

const MAX_ITERATIONS = 3;

// Lazy init — client is created at call time so process.env is populated by then
let _anthropic: Anthropic | null = null;
const getClient = () => {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_account_history",
    description:
      "Retrieve recent transactions for an account within this upload to identify velocity patterns, repeated counterparties, or structuring behavior.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Account ID to look up" },
        days_back: {
          type: "integer",
          description: "Days of history to retrieve (1–30)",
          minimum: 1,
          maximum: 30,
        },
      },
      required: ["account_id", "days_back"],
    },
  },
  {
    name: "find_related_accounts",
    description:
      "Find all accounts that have directly transacted with the given account (one-hop network neighbors). Useful for detecting layering chains or smurfing rings.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Account ID to find connections for" },
      },
      required: ["account_id"],
    },
  },
  {
    name: "score_risk",
    description:
      "Submit the final structured risk assessment. Call this once you have gathered enough evidence to make a decision. This terminates the investigation.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "One sentence: what is suspicious and why",
        },
        red_flags: {
          type: "array",
          items: { type: "string" },
          description: "Concrete red flags observed (3–6 items)",
        },
        pattern_explanation: {
          type: "string",
          description: "2–3 sentences explaining the specific AML pattern detected",
        },
        recommendation_reason: {
          type: "string",
          description: "Why this merits MONITOR / ESCALATE / FILE_SAR",
        },
        risk_score: {
          type: "integer",
          description: "Final risk score 0–100. ≥80 → FILE_SAR, 55–79 → ESCALATE, <55 → MONITOR",
          minimum: 0,
          maximum: 100,
        },
        recommendation: {
          type: "string",
          enum: ["MONITOR", "ESCALATE", "FILE_SAR"],
          description: "Required compliance action consistent with risk_score",
        },
      },
      required: [
        "summary",
        "red_flags",
        "pattern_explanation",
        "recommendation_reason",
        "risk_score",
        "recommendation",
      ],
    },
  },
];

// ─── Tool implementations (Prisma queries) ────────────────────────────────────

async function getAccountHistory(
  accountId: string,
  daysBack: number,
  uploadId: string
): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - Math.min(daysBack, 30));

  const txs = await prisma.transaction.findMany({
    where: {
      uploadId,
      OR: [{ fromAccount: accountId }, { toAccount: accountId }],
      txDate: { gte: since },
    },
    select: {
      txId: true,
      fromAccount: true,
      toAccount: true,
      amount: true,
      currency: true,
      txDate: true,
      txType: true,
      country: true,
      anomalyScore: true,
    },
    orderBy: { txDate: "desc" },
    take: 50,
  });

  if (txs.length === 0) {
    return JSON.stringify({ account: accountId, message: "No transactions in this window" });
  }

  const totalSent = txs
    .filter((t) => t.fromAccount === accountId)
    .reduce((s, t) => s + t.amount, 0);
  const totalReceived = txs
    .filter((t) => t.toAccount === accountId)
    .reduce((s, t) => s + t.amount, 0);
  const flaggedCount = txs.filter((t) => (t.anomalyScore ?? 0) > 0.5).length;

  // Detect sub-threshold structuring (amounts near €9000)
  const structuringHits = txs.filter(
    (t) => t.amount >= 8000 && t.amount < 10000
  ).length;

  return JSON.stringify({
    account: accountId,
    window_days: daysBack,
    tx_count: txs.length,
    total_sent: Math.round(totalSent),
    total_received: Math.round(totalReceived),
    flagged_count: flaggedCount,
    structuring_hits: structuringHits,
    recent: txs.slice(0, 15).map((t) => ({
      id: t.txId,
      dir: t.fromAccount === accountId ? "OUT" : "IN",
      counterparty: t.fromAccount === accountId ? t.toAccount : t.fromAccount,
      amount: t.amount,
      ccy: t.currency,
      date: t.txDate.toISOString().slice(0, 10),
      country: t.country,
      score: t.anomalyScore?.toFixed(3),
    })),
  });
}

async function findRelatedAccounts(accountId: string, uploadId: string): Promise<string> {
  const [sent, received] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["toAccount"],
      where: { uploadId, fromAccount: accountId },
      _count: { toAccount: true },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["fromAccount"],
      where: { uploadId, toAccount: accountId },
      _count: { fromAccount: true },
      _sum: { amount: true },
    }),
  ]);

  return JSON.stringify({
    account: accountId,
    sends_to: sent.map((r) => ({
      account: r.toAccount,
      tx_count: r._count.toAccount,
      total: Math.round(r._sum.amount ?? 0),
    })),
    receives_from: received.map((r) => ({
      account: r.fromAccount,
      tx_count: r._count.fromAccount,
      total: Math.round(r._sum.amount ?? 0),
    })),
    hop_count: sent.length + received.length,
  });
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runTriageAgent(
  anomaly: PythonAnomalyResult,
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
  uploadId: string
): Promise<TriageResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Triage this flagged transaction. Use the tools to gather evidence, then call score_risk.

Transaction:
  ID:          ${tx.txId}
  From:        ${tx.fromAccount}
  To:          ${tx.toAccount}
  Amount:      ${tx.amount} ${tx.currency}
  Date:        ${tx.txDate.toISOString()}
  Country:     ${tx.country ?? "unknown"}
  Description: ${tx.description ?? "none"}

ML scores:
  anomaly_score:      ${anomaly.anomaly_score.toFixed(4)}  (0–1)
  iso_forest_score:   ${anomaly.iso_forest_score.toFixed(4)}
  velocity_score:     ${anomaly.velocity_score.toFixed(4)}
  pattern:            ${anomaly.pattern_type}

Steps: (1) check sender history, (2) check receiver history, (3) map related accounts, (4) call score_risk.`,
    },
  ];

  let triageResult: TriageResult | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 900,
      system:
        "You are a senior AML compliance analyst. Investigate each flagged transaction thoroughly using the provided tools before issuing a risk assessment. Be precise and evidence-based.",
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
    );

    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const inp = tu.input as Record<string, unknown>;
      let result: string;

      try {
        switch (tu.name) {
          case "get_account_history":
            result = await getAccountHistory(
              inp.account_id as string,
              Number(inp.days_back),
              uploadId
            );
            break;

          case "find_related_accounts":
            result = await findRelatedAccounts(inp.account_id as string, uploadId);
            break;

          case "score_risk": {
            const riskScore = Number(inp.risk_score);
            const rec = (inp.recommendation as string) || (
              riskScore >= 80 ? "FILE_SAR" : riskScore >= 55 ? "ESCALATE" : "MONITOR"
            );
            triageResult = {
              summary:               (inp.summary as string)               || "Anomaly detected.",
              red_flags:             (inp.red_flags as string[])            || [],
              pattern_explanation:   (inp.pattern_explanation as string)    || "",
              recommendation_reason: (inp.recommendation_reason as string)  || "",
              recommendation:        rec as Recommendation,
              riskScore:             isNaN(riskScore) ? anomaly.anomaly_score * 100 : riskScore,
            };
            result = "Assessment recorded.";
            break;
          }

          default:
            result = `Unknown tool: ${tu.name}`;
        }
      } catch (err) {
        result = `Error: ${String(err)}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    if (triageResult) break;
    messages.push({ role: "user", content: toolResults });
  }

  // Fallback when agent didn't call score_risk within iteration budget
  if (!triageResult) {
    const riskScore = Math.round(anomaly.anomaly_score * 100);
    triageResult = {
      summary: `Anomalous transaction flagged by ML detector (score ${anomaly.anomaly_score.toFixed(3)}).`,
      red_flags: [
        `Anomaly score: ${anomaly.anomaly_score.toFixed(3)}`,
        `Pattern: ${anomaly.pattern_type}`,
        `Velocity score: ${anomaly.velocity_score.toFixed(3)}`,
      ],
      pattern_explanation: `Transaction matched ${anomaly.pattern_type} pattern via IsolationForest detection.`,
      recommendation_reason: "Based on ML anomaly score threshold.",
      recommendation: riskScore >= 80 ? "FILE_SAR" : riskScore >= 55 ? "ESCALATE" : "MONITOR",
      riskScore,
    };
  }

  return triageResult;
}
