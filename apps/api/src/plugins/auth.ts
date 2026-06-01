// apps/api/src/plugins/auth.ts
import type { FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";

// Augment @fastify/jwt types so request.user is typed everywhere
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; tenantId: string; role: string };
    user:    { sub: string; tenantId: string; role: string };
  }
}

// Paths that do not require a valid JWT
const PUBLIC_PATHS = new Set(["/health", "/api/auth/token"]);

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    const msg = "JWT_SECRET must be set and at least 32 characters";
    if (process.env.NODE_ENV === "production") throw new Error(msg);
    app.log.warn(`[auth] ${msg} — using insecure dev default`);
  }

  await app.register(fastifyJwt, {
    secret: secret ?? "dev-only-secret-change-before-deploying-to-production",
    sign:   { expiresIn: process.env.NODE_ENV === "production" ? "8h" : "7d" },
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (PUBLIC_PATHS.has(path)) return;

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}
