import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { startTestApp, makeFormData } from "./helpers/app";
import { cleanTenant, testPrisma } from "./helpers/db";

const SAMPLE_CSV = [
  "tx_id,from_account,to_account,amount,currency,date,type,country,description",
  "TX-G1,ACC-X,ACC-Y,8950.00,EUR,2024-02-01T09:00:00Z,TRANSFER,EE,Payment A",
  "TX-G2,ACC-X,ACC-Z,8900.00,EUR,2024-02-01T09:10:00Z,TRANSFER,EE,Payment B",
  "TX-G3,ACC-X,ACC-W,8850.00,EUR,2024-02-01T09:20:00Z,TRANSFER,EE,Payment C",
].join("\n");

describe("GET /api/analysis/:uploadId", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let getAuthHeaders: (tenantId: string) => Promise<Record<string, string>>;
  const tenantIds: string[] = [];
  let tenantId: string;
  let uploadId: string;
  let authH: Record<string, string>;

  beforeAll(async () => {
    ({ app, baseUrl, getAuthHeaders } = await startTestApp());
  });

  afterAll(async () => {
    await app.close();
    for (const tid of tenantIds) await cleanTenant(tid);
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    tenantId = `test-${randomUUID()}`;
    tenantIds.push(tenantId);
    authH = await getAuthHeaders(tenantId);

    const { body } = await makeFormData(SAMPLE_CSV);
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { ...authH },
      body,
    });
    uploadId = (await res.json()).uploadId;
  });

  it("returns 200 with PENDING status immediately after upload", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}`, { headers: authH });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uploadId).toBe(uploadId);
    expect(["PENDING", "PROCESSING"]).toContain(json.status);
    expect(json.totalRows).toBe(3);
    expect(Array.isArray(json.alerts)).toBe(true);
  });

  it("returns 401 without a token", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent uploadId", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/nonexistent-id-000`, { headers: authH });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();
  });

  it("alert objects have required shape when present", async () => {
    const upload = await testPrisma.upload.findUnique({
      where: { id: uploadId },
      include: { transactions: { take: 1 } },
    });
    const tx = upload?.transactions[0];

    if (tx) {
      await testPrisma.alert.create({
        data: {
          tenantId, uploadId,
          transactionId: tx.id,
          patternType: "SMURFING",
          riskScore: 78,
          recommendation: "ESCALATE",
          explanation: JSON.stringify({
            summary: "Test summary",
            red_flags: ["flag A", "flag B"],
            pattern_explanation: "Test pattern",
            recommendation_reason: "Test reason",
          }),
        },
      });
      await testPrisma.upload.update({ where: { id: uploadId }, data: { status: "DONE" } });
    }

    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}`, { headers: authH });
    const json = await res.json();
    if (json.alerts.length > 0) {
      const alert = json.alerts[0];
      expect(alert).toHaveProperty("id");
      expect(alert).toHaveProperty("patternType");
      expect(alert).toHaveProperty("riskScore");
      expect(alert).toHaveProperty("recommendation");
      expect(alert).toHaveProperty("explanation");
    }
  });
});

describe("GET /api/analysis/:uploadId/graph", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let getAuthHeaders: (tenantId: string) => Promise<Record<string, string>>;
  const tenantIds: string[] = [];
  let tenantId: string;
  let uploadId: string;
  let authH: Record<string, string>;

  beforeAll(async () => {
    ({ app, baseUrl, getAuthHeaders } = await startTestApp());
  });

  afterAll(async () => {
    await app.close();
    for (const tid of tenantIds) await cleanTenant(tid);
  });

  beforeEach(async () => {
    tenantId = `test-${randomUUID()}`;
    tenantIds.push(tenantId);
    authH = await getAuthHeaders(tenantId);

    const { body } = await makeFormData(SAMPLE_CSV);
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { ...authH },
      body,
    });
    uploadId = (await res.json()).uploadId;
  });

  it("returns 401 without a token", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}/graph`);
    expect(res.status).toBe(401);
  });

  it("returns graph nodes and edges after upload", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}/graph`, { headers: authH });
    expect(res.status).toBe(200);
    const graph = await res.json();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBe(3);
  });

  it("graph nodes contain required fields", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}/graph`, { headers: authH });
    const { nodes } = await res.json();
    for (const node of nodes) {
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("riskScore");
      expect(node).toHaveProperty("totalSent");
      expect(node).toHaveProperty("totalReceived");
    }
  });

  it("graph edges contain source/target/amount", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/${uploadId}/graph`, { headers: authH });
    const { edges } = await res.json();
    for (const edge of edges) {
      expect(edge).toHaveProperty("source");
      expect(edge).toHaveProperty("target");
      expect(edge).toHaveProperty("amount");
      expect(typeof edge.isSuspicious).toBe("boolean");
    }
  });

  it("returns 404 for non-existent upload", async () => {
    const res = await fetch(`${baseUrl}/api/analysis/no-such-upload/graph`, { headers: authH });
    expect(res.status).toBe(404);
  });
});
