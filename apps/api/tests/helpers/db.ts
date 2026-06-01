// tests/helpers/db.ts — test DB cleanup utilities
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../.env.test") });

import { PrismaClient } from "@prisma/client";

// Separate client for test cleanup (not the singleton from src/db/client)
export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: [],
});

export async function cleanTenant(tenantId: string): Promise<void> {
  await testPrisma.alert.deleteMany({ where: { tenantId } });
  const uploads = await testPrisma.upload.findMany({
    where: { tenantId },
    select: { id: true },
  });
  await testPrisma.transaction.deleteMany({
    where: { uploadId: { in: uploads.map((u) => u.id) } },
  });
  await testPrisma.upload.deleteMany({ where: { tenantId } });
  await testPrisma.tenant.deleteMany({ where: { id: tenantId } });
}
