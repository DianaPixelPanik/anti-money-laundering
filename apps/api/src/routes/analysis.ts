// apps/api/src/routes/analysis.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { uploadIdParam, zodError } from "../lib/schemas";
import type { AnalysisStatus, GraphData, GraphNode, GraphEdge } from "@aml/types";

export async function analysisRoutes(app: FastifyInstance) {
  /**
   * GET /api/analysis/:uploadId
   * Poll analysis status + get alert summary
   */
  app.get<{ Params: { uploadId: string } }>(
    "/:uploadId",
    async (request, reply) => {
      const paramsParsed = uploadIdParam.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: zodError(paramsParsed.error.issues) });
      }
      const { uploadId } = paramsParsed.data;

      const upload = await prisma.upload.findUnique({
        where: { id: uploadId },
        include: {
          alerts: {
            orderBy: { riskScore: "desc" },
            take: 100,
            include: {
              transaction: {
                select: {
                  txId: true,
                  fromAccount: true,
                  toAccount: true,
                  amount: true,
                  currency: true,
                  txDate: true,
                },
              },
            },
          },
        },
      });

      if (!upload) return reply.status(404).send({ error: "Upload not found" });

      const highRiskCount = upload.alerts.filter((a) => a.riskScore >= 70).length;

      const response: AnalysisStatus = {
        uploadId: upload.id,
        status: upload.status,
        totalRows: upload.rowCount,
        alertCount: upload.alerts.length,
        highRiskCount,
        alerts: upload.alerts.map((a) => ({
          id: a.id,
          transactionId: a.transactionId,
          patternType: a.patternType,
          riskScore: a.riskScore,
          recommendation: a.recommendation,
          explanation: a.explanation,
          createdAt: a.createdAt.toISOString(),
          transaction: a.transaction
            ? {
                txId: a.transaction.txId,
                fromAccount: a.transaction.fromAccount,
                toAccount: a.transaction.toAccount,
                amount: a.transaction.amount,
                currency: a.transaction.currency,
                txDate: a.transaction.txDate.toISOString(),
              }
            : undefined,
        })),
      };

      return response;
    }
  );

  /**
   * GET /api/analysis/:uploadId/graph
   * Returns all transactions as graph nodes/edges for D3 visualization
   */
  app.get<{ Params: { uploadId: string } }>(
    "/:uploadId/graph",
    async (request, reply) => {
      const paramsParsed = uploadIdParam.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: zodError(paramsParsed.error.issues) });
      }
      const { uploadId } = paramsParsed.data;

      const upload = await prisma.upload.findUnique({
        where: { id: uploadId },
        select: { id: true },
      });
      if (!upload) return reply.status(404).send({ error: "Upload not found" });

      const [transactions, alerts] = await Promise.all([
        prisma.transaction.findMany({
          where: { uploadId },
          select: {
            id: true,
            txId: true,
            fromAccount: true,
            toAccount: true,
            amount: true,
            currency: true,
            txDate: true,
          },
          orderBy: { txDate: "asc" },
        }),
        prisma.alert.findMany({
          where: { uploadId },
          select: {
            transactionId: true,
            patternType: true,
            riskScore: true,
          },
        }),
      ]);

      // Index alerts by transactionId for fast lookup
      const alertByTx = new Map<string, { patternType: string; riskScore: number }>();
      for (const a of alerts) {
        if (!a.transactionId) continue;
        const existing = alertByTx.get(a.transactionId);
        if (!existing || a.riskScore > existing.riskScore) {
          alertByTx.set(a.transactionId, { patternType: a.patternType, riskScore: a.riskScore });
        }
      }

      // Build node map
      const nodeMap = new Map<string, GraphNode>();
      const ensureNode = (accountId: string, currency: string) => {
        if (!nodeMap.has(accountId)) {
          nodeMap.set(accountId, {
            id: accountId,
            riskScore: 0,
            alertCount: 0,
            totalSent: 0,
            totalReceived: 0,
            currency,
          });
        }
        return nodeMap.get(accountId)!;
      };

      const edges: GraphEdge[] = transactions.map((tx) => {
        const alert = alertByTx.get(tx.id);
        const isSuspicious = !!alert;

        const fromNode = ensureNode(tx.fromAccount, tx.currency);
        const toNode = ensureNode(tx.toAccount, tx.currency);

        fromNode.totalSent += tx.amount;
        toNode.totalReceived += tx.amount;

        if (isSuspicious && alert) {
          if (alert.riskScore > fromNode.riskScore) {
            fromNode.riskScore = alert.riskScore;
          }
          if (alert.riskScore > toNode.riskScore) {
            toNode.riskScore = alert.riskScore;
          }
          fromNode.alertCount += 1;
        }

        return {
          id: tx.id,
          txId: tx.txId,
          source: tx.fromAccount,
          target: tx.toAccount,
          amount: tx.amount,
          currency: tx.currency,
          txDate: tx.txDate.toISOString(),
          isSuspicious,
          patternType: alert?.patternType as GraphEdge["patternType"],
          riskScore: alert?.riskScore,
        };
      });

      const graph: GraphData = {
        nodes: Array.from(nodeMap.values()),
        edges,
      };

      return graph;
    }
  );
}
