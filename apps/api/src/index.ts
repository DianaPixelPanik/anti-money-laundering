// apps/api/src/index.ts
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { uploadRoutes } from "./routes/upload";
import { analysisRoutes } from "./routes/analysis";
import { alertRoutes } from "./routes/alerts";
import { prisma } from "./db/client";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  },
});

async function bootstrap() {
  // Plugins
  await app.register(cors, {
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    service: "aml-api",
    timestamp: new Date().toISOString(),
  }));

  // Routes
  await app.register(uploadRoutes, { prefix: "/api/uploads" });
  await app.register(analysisRoutes, { prefix: "/api/analysis" });
  await app.register(alertRoutes, { prefix: "/api/alerts" });

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down...");
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
