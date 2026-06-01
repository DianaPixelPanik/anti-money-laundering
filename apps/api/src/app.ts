// apps/api/src/app.ts
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { uploadRoutes } from "./routes/upload";
import { analysisRoutes } from "./routes/analysis";
import { alertRoutes } from "./routes/alerts";
import { sarRoutes } from "./routes/sar";
import { ralphRoutes } from "./routes/ralph";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            transport: { target: "pino-pretty", options: { colorize: true } },
          },
  });

  await app.register(cors, {
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "aml-api",
    timestamp: new Date().toISOString(),
  }));

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
    return reply.status(statusCode).send({ error: error.message });
  });

  await app.register(uploadRoutes, { prefix: "/api/uploads" });
  await app.register(analysisRoutes, { prefix: "/api/analysis" });
  await app.register(alertRoutes, { prefix: "/api/alerts" });
  await app.register(sarRoutes, { prefix: "/api/sar" });
  await app.register(ralphRoutes, { prefix: "/api/ralph" });

  return app;
}
