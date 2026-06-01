import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { startTestApp, makeFormData } from "./helpers/app";
import { cleanTenant } from "./helpers/db";

const VALID_CSV = [
  "tx_id,from_account,to_account,amount,currency,date,type,country,description",
  "TX001,ACC-A,ACC-B,5000.00,EUR,2024-01-15T09:00:00Z,TRANSFER,DE,Test payment",
  "TX002,ACC-A,ACC-C,3000.00,EUR,2024-01-15T10:00:00Z,TRANSFER,DE,Another payment",
  "TX003,ACC-B,ACC-D,1200.00,EUR,2024-01-16T08:00:00Z,TRANSFER,FR,Third payment",
].join("\n");

const CSV_MISSING_COLUMNS = [
  "id,sender,receiver,value",
  "001,A,B,100",
].join("\n");

const CSV_NO_ROWS = "tx_id,from_account,to_account,amount,currency,date";

describe("POST /api/uploads", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const tenantIds: string[] = [];
  let tenantId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestApp());
  });

  afterAll(async () => {
    await app.close();
    for (const tid of tenantIds) await cleanTenant(tid);
  });

  beforeEach(() => {
    tenantId = `test-${randomUUID()}`;
    tenantIds.push(tenantId);
  });

  it("returns 202 with uploadId for valid CSV", async () => {
    const { body } = await makeFormData(VALID_CSV);
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { "x-tenant-id": tenantId },
      body,
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({
      uploadId: expect.any(String),
      status: "PENDING",
      rowCount: 3,
    });
  });

  it("returns 400 when no file is attached", async () => {
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { "x-tenant-id": tenantId },
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when required columns are missing", async () => {
    const { body } = await makeFormData(CSV_MISSING_COLUMNS, "bad.csv");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { "x-tenant-id": tenantId },
      body,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Missing required columns/i);
    expect(json.expected).toEqual(["tx_id", "from_account", "to_account", "amount", "date"]);
  });

  it("returns 400 for CSV with header only (no rows)", async () => {
    const { body } = await makeFormData(CSV_NO_ROWS, "empty.csv");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { "x-tenant-id": tenantId },
      body,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/empty/i);
  });

  it("persists transactions to the database", async () => {
    const { body } = await makeFormData(VALID_CSV);
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      headers: { "x-tenant-id": tenantId },
      body,
    });

    const { uploadId } = await res.json();

    // Verify via GET that row count is recorded
    const statusRes = await fetch(`${baseUrl}/api/analysis/${uploadId}`, {
      headers: { "x-tenant-id": tenantId },
    });
    const status = await statusRes.json();
    expect(statusRes.status).toBe(200);
    expect(status.totalRows).toBe(3);
    expect(status.uploadId).toBe(uploadId);
  });

  it("uses 'default' tenant when x-tenant-id header is absent", async () => {
    const { body } = await makeFormData(VALID_CSV);
    const res = await fetch(`${baseUrl}/api/uploads`, {
      method: "POST",
      body,
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.uploadId).toBeTruthy();
  });
});
