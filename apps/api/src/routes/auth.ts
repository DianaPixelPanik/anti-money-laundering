// apps/api/src/routes/auth.ts
// Dev/test token issuer.
// In production: disable AUTH_DEV_ENABLED and use an identity provider
// (Clerk, Auth0, etc.) to issue JWTs with the same { sub, tenantId, role } shape.
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodError } from "../lib/schemas";

const tokenBody = z.object({
  tenantId: z.string().min(1).regex(/^[\w-]+$/),
  role:     z.enum(["admin", "analyst", "viewer"]).default("analyst"),
});

export async function authRoutes(app: FastifyInstance) {
  const enabled =
    process.env.AUTH_DEV_ENABLED === "true" ||
    process.env.NODE_ENV !== "production";

  app.post("/token", async (request, reply) => {
    if (!enabled) {
      return reply.status(403).send({ error: "Dev token endpoint is disabled in production" });
    }

    const parsed = tokenBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: zodError(parsed.error.issues) });
    }

    const { tenantId, role } = parsed.data;
    const token = await reply.jwtSign(
      { sub: `dev-${tenantId}`, tenantId, role },
    );

    return { token, tenantId, role, note: "Dev token — replace with identity provider in production" };
  });
}
