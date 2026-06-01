// apps/api/src/routes/upload.ts
import { FastifyInstance } from "fastify";
import { parse } from "csv-parse/sync";
import { prisma } from "../db/client";
import { analysisQueue } from "../jobs/queue";
import { parseTenant, uploadIdParam, zodError } from "../lib/schemas";
import type { CsvTransactionRow, UploadResponse } from "@aml/types";

export async function uploadRoutes(app: FastifyInstance) {
  /**
   * POST /api/uploads
   * Accept a CSV file, parse it, store transactions, enqueue analysis job
   */
  app.post<{ Headers: { "x-tenant-id"?: string } }>(
    "/",
    async (request, reply) => {
      const tenantId = parseTenant(request.headers["x-tenant-id"]);

      await prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId },
        update: {},
      });

      let data: Awaited<ReturnType<typeof request.file>>;
      try {
        data = await request.file();
      } catch {
        return reply.status(400).send({ error: "No file uploaded or invalid multipart request" });
      }
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const buffer = await data.toBuffer();
      const csvText = buffer.toString("utf-8");

      let rows: CsvTransactionRow[];
      try {
        rows = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as CsvTransactionRow[];
      } catch (err) {
        const message = err instanceof Error ? err.message : "Parse error";
        return reply.status(400).send({ error: `Invalid CSV format: ${message}` });
      }

      if (rows.length === 0) {
        return reply.status(400).send({ error: "CSV file is empty" });
      }

      const required = ["tx_id", "from_account", "to_account", "amount", "date"];
      const headers = Object.keys(rows[0]);
      const missing = required.filter((col) => !headers.includes(col));
      if (missing.length > 0) {
        return reply.status(400).send({
          error: `Missing required columns: ${missing.join(", ")}`,
          expected: required,
          got: headers,
        });
      }

      const upload = await prisma.upload.create({
        data: {
          tenantId,
          filename: data.filename,
          rowCount: rows.length,
          status: "PENDING",
        },
      });

      await prisma.transaction.createMany({
        data: rows.map((row) => ({
          uploadId: upload.id,
          txId: String(row.tx_id),
          fromAccount: String(row.from_account),
          toAccount: String(row.to_account),
          amount: Number(row.amount),
          currency: row.currency ?? "EUR",
          txDate: new Date(row.date),
          txType: row.type,
          country: row.country,
          description: row.description,
        })),
        skipDuplicates: true,
      });

      await (analysisQueue.add as Function)(
        "analyze",
        { uploadId: upload.id, tenantId },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } }
      );

      const response: UploadResponse = {
        uploadId: upload.id,
        status: "PENDING",
        rowCount: rows.length,
      };

      return reply.status(202).send(response);
    }
  );

  /**
   * GET /api/uploads/:uploadId
   */
  app.get<{ Params: { uploadId: string } }>(
    "/:uploadId",
    async (request, reply) => {
      const parsed = uploadIdParam.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: zodError(parsed.error.issues) });
      }

      const upload = await prisma.upload.findUnique({
        where: { id: parsed.data.uploadId },
        include: { _count: { select: { alerts: true } } },
      });

      if (!upload) return reply.status(404).send({ error: "Upload not found" });
      return upload;
    }
  );
}
