// apps/api/src/routes/ralph.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { runRalphLoop } from "../agents/ralph";
import { alertIdParam, zodError } from "../lib/schemas";

export async function ralphRoutes(app: FastifyInstance) {
  app.post<{ Params: { alertId: string } }>("/:alertId", async (request, reply) => {
    const { tenantId } = request.user;

    const parsed = alertIdParam.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: zodError(parsed.error.issues) });

    const decision = await runRalphLoop(parsed.data.alertId, tenantId);
    return reply.status(200).send(decision);
  });

  app.get<{ Params: { alertId: string } }>("/:alertId", async (request, reply) => {
    const { tenantId } = request.user;

    const parsed = alertIdParam.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: zodError(parsed.error.issues) });

    const decisions = await prisma.ralphDecision.findMany({
      where: { alertId: parsed.data.alertId, tenantId },
      orderBy: { createdAt: "desc" },
    });
    return decisions;
  });
}
