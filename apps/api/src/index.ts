// apps/api/src/index.ts
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../../.env") });

import { buildApp } from "./app";
import { prisma } from "./db/client";

async function bootstrap() {
  const app = await buildApp();

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
