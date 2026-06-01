// apps/api/src/routes/alerts.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { parseTenant, alertsQuery, zodError } from "../lib/schemas";

export async function alertRoutes(app: FastifyInstance) {
  /**
   * GET /api/alerts?limit=50&minRisk=70
   */
  app.get<{
    Querystring: { limit?: string; minRisk?: string };
    Headers: { "x-tenant-id"?: string };
  }>("/", async (request, reply) => {
    const tenantId = parseTenant(request.headers["x-tenant-id"]);

    const parsed = alertsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: zodError(parsed.error.issues) });
    }
    const { limit, minRisk } = parsed.data;

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
