// tests/helpers/app.ts — shared test app lifecycle
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../.env.test") });

import { buildApp } from "../../src/app";
import type { FastifyInstance } from "fastify";

export async function startTestApp(): Promise<{
  app: FastifyInstance;
  baseUrl: string;
  getAuthHeaders: (tenantId: string) => Promise<Record<string, string>>;
}> {
  const app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 3099;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Cache tokens per tenantId to avoid repeated requests
  const tokenCache = new Map<string, string>();

  const getAuthHeaders = async (tenantId: string): Promise<Record<string, string>> => {
    if (!tokenCache.has(tenantId)) {
      const res = await fetch(`${baseUrl}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const { token } = await res.json() as { token: string };
      tokenCache.set(tenantId, token);
    }
    return { Authorization: `Bearer ${tokenCache.get(tenantId)}` };
  };

  return { app, baseUrl, getAuthHeaders };
}

export async function makeFormData(
  csvContent: string,
  filename = "test.csv"
): Promise<{ body: FormData }> {
  const blob = new Blob([csvContent], { type: "text/csv" });
  const form = new FormData();
  form.append("file", blob, filename);
  return { body: form };
}
