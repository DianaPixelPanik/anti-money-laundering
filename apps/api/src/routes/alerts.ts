// apps/api/src/routes/alerts.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";

export async function alertRoutes(app: FastifyInstance) {
  /**
   * GET /api/alerts?tenantId=xxx&limit=50&minRisk=70
   */
  app.get<{
    Querystring: { limit?: string; minRisk?: string };
    Headers: { "x-tenant-id"?: string };
  }>("/", async (request, reply) => {
    const tenantId = request.headers["x-tenant-id"] ?? "default";
    const limit = Math.min(Number(request.query.limit ?? 50), 200);
    const minRisk = Number(request.query.minRisk ?? 0);

    const alerts = await prisma.alert.findMany({
      where: { tenantId, riskScore: { gte: minRisk } },
      orderBy: { createdAt: "desc" },
      take: limit,
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
    });

    return alerts;
  });
}
