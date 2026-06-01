// apps/api/src/routes/analysis.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AnalysisStatus } from "@aml/types";

export async function analysisRoutes(app: FastifyInstance) {
  /**
   * GET /api/analysis/:uploadId
   * Poll analysis status + get alert summary
   */
  app.get<{ Params: { uploadId: string } }>(
    "/:uploadId",
    async (request, reply) => {
      const { uploadId } = request.params;

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
}
