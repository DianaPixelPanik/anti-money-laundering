// apps/api/src/routes/ralph.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { runRalphLoop } from "../agents/ralph";
import { parseTenant, alertIdParam, zodError } from "../lib/schemas";

export async function ralphRoutes(app: FastifyInstance) {
  /**
   * POST /api/ralph/:alertId
   * Trigger Ralph autonomous investigation loop for a given alert.
   * Returns the final decision (synchronous — waits for loop to complete).
   */
  app.post<{
    Params: { alertId: string };
    Headers: { "x-tenant-id"?: string };
  }>("/:alertId", async (request, reply) => {
    const tenantId = parseTenant(request.headers["x-tenant-id"]);

    const parsed = alertIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: zodError(parsed.error.issues) });
    }
    const { alertId } = parsed.data;

    const decision = await runRalphLoop(alertId, tenantId);
    return reply.status(200).send(decision);
  });

  /**
   * GET /api/ralph/:alertId
   * Retrieve all Ralph decisions for a given alert (there may be more than one run).
   */
  app.get<{
    Params: { alertId: string };
    Headers: { "x-tenant-id"?: string };
  }>("/:alertId", async (request, reply) => {
    const tenantId = parseTenant(request.headers["x-tenant-id"]);

    const parsed = alertIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: zodError(parsed.error.issues) });
    }
    const { alertId } = parsed.data;

    const decisions = await prisma.ralphDecision.findMany({
      where: { alertId, tenantId },
      orderBy: { createdAt: "desc" },
    });

    return decisions;
  });
}
