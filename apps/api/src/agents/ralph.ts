// apps/api/src/agents/ralph.ts
// Ralph — autonomous AML investigation agent.
// Calls tools in any order it deems necessary, then issues `halt` with a final decision.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db/client";
import type { RalphDecision, Recommendation } from "@aml/types";

const MAX_ITERATIONS = 7;
const MAX_TOKENS = 4000;

// Simulated sanctions list (in production: OFAC/UN/EU API)
const SANCTIONS_LIST = new Set([
  "SANCTION-001", "OFAC-999", "UN-BLK-01",
  "ACC-BANNED", "ACC-BLOCKED",
]);
const HIGH_RISK_COUNTRIES = new Set(["KP", "IR", "SY", "CU", "VE"]);

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_account_history",
    description:
      "Get recent transactions for an account. Use this first to understand the volume, velocity, and pattern of activity.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Account identifier" },
        days: { type: "number", description: "Lookback window in days (1–90)", minimum: 1, maximum: 90 },
      },
      required: ["account_id", "days"],
    },
  },
  {
    name: "get_related_accounts",
    description:
      "Find all accounts that have directly transacted with this account (one-hop neighbors). Use to detect smurfing rings or layering chains.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string" },
      },
      required: ["account_id"],
    },
  },
  {
    name: "check_sanctions",
    description:
      "Check whether an account appears on international sanctions lists (OFAC, UN, EU). Always run on the primary subject and any high-risk counterparties.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string", description: "Account to screen" },
      },
      required: ["account_id"],
    },
  },
  {
    name: "get_graph_depth",
    description:
      "Traverse the transaction graph N levels deep from an account. Use depth=2 for layering detection, depth=3 for complex round-trip schemes. Returns all nodes and edges found.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string" },
        depth: { type: "number", description: "Traversal depth (1–3)", minimum: 1, maximum: 3 },
      },
      required: ["account_id", "depth"],
    },
  },
  {
    name: "file_sar",
    description:
      "Flag this investigation for Suspicious Activity Report filing. Call this when you have sufficient evidence of money laundering. This does not halt the investigation — continue gathering evidence if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "Specific reason for SAR filing" },
      },
      required: ["reason"],
    },
  },
  {
    name: "halt",
    description:
      "Stop the investigation and record the final decision. Call this when you have sufficient evidence to make a determination. This MUST be called to conclude the loop.",
    input_schema: {
      type: "object" as const,
      properties: {
        decision: {
          type: "string",
          enum: ["MONITOR", "ESCALATE", "FILE_SAR"],
          description: "MONITOR: low risk, watch. ESCALATE: medium risk, refer to senior analyst. FILE_SAR: file report with regulator.",
        },
        risk_score: {
          type: "number",
          description: "Final risk score 0–100. <55=MONITOR, 55–79=ESCALATE, ≥80=FILE_SAR",
          minimum: 0,
          maximum: 100,
        },
        reasoning: {
          type: "string",
          description: "2–4 sentence summary of findings and rationale for this decision",
        },
      },
      required: ["decision", "risk_score", "reasoning"],
    },
  },
];

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolGetAccountHistory(accountId: string, days: number): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - Math.min(days, 90));

  const txs = await prisma.transaction.findMany({
    where: {
      OR: [{ fromAccount: accountId }, { toAccount: accountId }],
      txDate: { gte: since },
    },
    select: {
      txId: true, fromAccount: true, toAccount: true,
      amount: true, currency: true, txDate: true,
      country: true, txType: true, anomalyScore: true,
    },
    orderBy: { txDate: "desc" },
    take: 50,
  });

  if (txs.length === 0) return JSON.stringify({ account: accountId, result: "no_history" });

  const totalOut = txs.filter(t => t.fromAccount === accountId).reduce((s, t) => s + t.amount, 0);
  const totalIn  = txs.filter(t => t.toAccount   === accountId).reduce((s, t) => s + t.amount, 0);
  const nearThreshold = txs.filter(t => t.amount >= 8000 && t.amount < 10000).length;
  const flaggedCount  = txs.filter(t => (t.anomalyScore ?? 0) > 0.5).length;
  const countries = [...new Set(txs.map(t => t.country).filter(Boolean))];

  return JSON.stringify({
    account: accountId,
    window_days: days,
    tx_count: txs.length,
    total_out: Math.round(totalOut),
    total_in: Math.round(totalIn),
    near_threshold_count: nearThreshold,
    flagged_count: flaggedCount,
    countries,
    recent: txs.slice(0, 10).map(t => ({
      id: t.txId,
      dir: t.fromAccount === accountId ? "OUT" : "IN",
      peer: t.fromAccount === accountId ? t.toAccount : t.fromAccount,
      amount: t.amount,
      ccy: t.currency,
      date: t.txDate.toISOString().slice(0, 10),
      score: t.anomalyScore?.toFixed(3) ?? null,
    })),
  });
}

async function toolGetRelatedAccounts(accountId: string): Promise<string> {
  const [sent, received] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["toAccount"],
      where: { fromAccount: accountId },
      _count: { toAccount: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 20,
    }),
    prisma.transaction.groupBy({
      by: ["fromAccount"],
      where: { toAccount: accountId },
      _count: { fromAccount: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 20,
    }),
  ]);

  return JSON.stringify({
    account: accountId,
    sends_to: sent.map(r => ({
      account: r.toAccount,
      tx_count: r._count.toAccount,
      total_sent: Math.round(r._sum.amount ?? 0),
    })),
    receives_from: received.map(r => ({
      account: r.fromAccount,
      tx_count: r._count.fromAccount,
      total_received: Math.round(r._sum.amount ?? 0),
    })),
    total_connections: sent.length + received.length,
  });
}

function toolCheckSanctions(accountId: string): string {
  const hit = SANCTIONS_LIST.has(accountId);

  // Check if account ID contains patterns suggesting high-risk jurisdiction
  const upperAcc = accountId.toUpperCase();
  const jurisdictionHit = [...HIGH_RISK_COUNTRIES].some(c => upperAcc.includes(c));

  return JSON.stringify({
    account: accountId,
    sanctions_hit: hit,
    jurisdiction_flag: jurisdictionHit,
    lists_checked: ["OFAC-SDN", "UN-Consolidated", "EU-Financial-Sanctions"],
    match_type: hit ? "exact" : jurisdictionHit ? "jurisdiction_pattern" : "none",
    note: hit
      ? "MATCH FOUND — account appears on sanctions list"
      : "No direct sanctions match. Standard due-diligence applies.",
  });
}

async function toolGetGraphDepth(accountId: string, depth: number): Promise<string> {
  const safeDepth = Math.min(depth, 3);
  const visited = new Set<string>([accountId]);
  const edges: Array<{ from: string; to: string; amount: number; ccy: string }> = [];
  let frontier = [accountId];

  for (let level = 0; level < safeDepth; level++) {
    if (frontier.length === 0) break;

    const txs = await prisma.transaction.findMany({
      where: {
        OR: [
          { fromAccount: { in: frontier } },
          { toAccount:   { in: frontier } },
        ],
      },
      select: { fromAccount: true, toAccount: true, amount: true, currency: true },
      take: 200,
    });

    const nextFrontier = new Set<string>();
    for (const tx of txs) {
      edges.push({ from: tx.fromAccount, to: tx.toAccount, amount: tx.amount, ccy: tx.currency });
      if (!visited.has(tx.toAccount))   { visited.add(tx.toAccount);   nextFrontier.add(tx.toAccount); }
      if (!visited.has(tx.fromAccount)) { visited.add(tx.fromAccount); nextFrontier.add(tx.fromAccount); }
    }
    frontier = [...nextFrontier];
  }

  // Detect cycles (money returning to origin)
  const cycles = edges.filter(e => e.to === accountId).map(e => e.from);

  return JSON.stringify({
    root: accountId,
    depth: safeDepth,
    total_nodes: visited.size,
    total_edges: edges.length,
    cycles_detected: cycles.length > 0,
    cycle_sources: cycles,
    nodes: [...visited],
    sample_edges: edges.slice(0, 30),
  });
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

interface HaltInput {
  decision: Recommendation;
  risk_score: number;
  reasoning: string;
}

export async function runRalphLoop(
  alertId: string,
  tenantId: string
): Promise<RalphDecision> {
  // Load alert + transaction context
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      transaction: true,
      upload: { select: { filename: true } },
    },
  });

  if (!alert || alert.tenantId !== tenantId) {
    throw new Error("Alert not found or access denied");
  }

  const tx = alert.transaction;
  const initialMessage = `You are Ralph, an autonomous AML (Anti-Money Laundering) investigation agent.

Your task: investigate the following flagged transaction and issue a final risk determination.

ALERT
  ID:           ${alertId}
  Pattern:      ${alert.patternType}
  Risk score:   ${alert.riskScore}/100
  Recommendation: ${alert.recommendation}
  Explanation:  ${alert.explanation}

${tx ? `TRANSACTION
  ID:           ${tx.txId}
  From:         ${tx.fromAccount}
  To:           ${tx.toAccount}
  Amount:       ${tx.amount} ${tx.currency}
  Date:         ${tx.txDate.toISOString()}
  Country:      ${tx.country ?? "unknown"}
  Description:  ${tx.description ?? "none"}
  Anomaly score: ${tx.anomalyScore?.toFixed(4) ?? "n/a"}` : "No linked transaction"}

INVESTIGATION PROTOCOL
1. get_account_history — check sender & receiver transaction history
2. get_related_accounts — map the network around both accounts
3. check_sanctions — screen all high-risk accounts found
4. get_graph_depth — if you suspect layering/round-tripping, traverse deeper
5. file_sar — call if you find strong evidence during investigation
6. halt — conclude with your final decision

Use tools in the order that makes sense for this case. Call halt when you have sufficient evidence.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialMessage },
  ];

  let client: Anthropic | null = null;
  const getClient = () => {
    if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return client;
  };

  let haltInput: HaltInput | null = null;
  let sarFiled = false;
  let iterations = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;

    const response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: MAX_TOKENS,
      system:
        "You are Ralph, a meticulous AML investigation agent. Be systematic: gather evidence before deciding. Always call halt to conclude.",
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
    );

    // No tool calls — agent gave text response without halting
    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const inp = tu.input as Record<string, unknown>;
      let result: string;

      try {
        switch (tu.name) {
          case "get_account_history":
            result = await toolGetAccountHistory(String(inp.account_id), Number(inp.days));
            break;

          case "get_related_accounts":
            result = await toolGetRelatedAccounts(String(inp.account_id));
            break;

          case "check_sanctions":
            result = toolCheckSanctions(String(inp.account_id));
            break;

          case "get_graph_depth":
            result = await toolGetGraphDepth(String(inp.account_id), Number(inp.depth));
            break;

          case "file_sar":
            sarFiled = true;
            result = JSON.stringify({ status: "flagged", message: "SAR filing noted for this investigation." });
            break;

          case "halt":
            haltInput = inp as unknown as HaltInput;
            result = JSON.stringify({ status: "halted" });
            break;

          default:
            result = JSON.stringify({ error: `Unknown tool: ${tu.name}` });
        }
      } catch (err) {
        result = JSON.stringify({ error: String(err) });
      }

      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    if (haltInput) break;

    messages.push({ role: "user", content: toolResults });
  }

  // Fallback if agent didn't call halt
  if (!haltInput) {
    haltInput = {
      decision: alert.recommendation as Recommendation,
      risk_score: alert.riskScore,
      reasoning: "Investigation concluded without explicit halt. Defaulting to original alert recommendation.",
    };
  }

  // Persist decision (append-only — never update existing records)
  const saved = await prisma.ralphDecision.create({
    data: {
      alertId,
      tenantId,
      decision: haltInput.decision,
      riskScore: Math.round(haltInput.risk_score),
      reasoning: haltInput.reasoning,
      iterations,
      sarFiled,
    },
  });

  return {
    id: saved.id,
    alertId: saved.alertId,
    tenantId: saved.tenantId,
    decision: saved.decision as Recommendation,
    riskScore: saved.riskScore,
    reasoning: saved.reasoning,
    iterations: saved.iterations,
    sarFiled: saved.sarFiled,
    createdAt: saved.createdAt.toISOString(),
  };
}
