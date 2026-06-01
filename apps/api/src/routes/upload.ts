// apps/api/src/routes/upload.ts
import { FastifyInstance } from "fastify";
import { parse } from "csv-parse/sync";
import { prisma } from "../db/client";
import { analysisQueue } from "../jobs/queue";
import type { CsvTransactionRow, UploadResponse } from "@aml/types";

export async function uploadRoutes(app: FastifyInstance) {
  /**
   * POST /api/uploads
   * Accept a CSV file, parse it, store transactions, enqueue analysis job
   */
  app.post<{ Headers: { "x-tenant-id"?: string } }>(
    "/",
    async (request, reply) => {
      const tenantId = request.headers["x-tenant-id"] ?? "default";

      // Ensure tenant exists
      await prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId },
        update: {},
      });

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const buffer = await data.toBuffer();
      const csvText = buffer.toString("utf-8");

      // Parse CSV
      let rows: CsvTransactionRow[];
      try {
        rows = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as CsvTransactionRow[];
      } catch (err) {
        return reply.status(400).send({ error: "Invalid CSV format", details: String(err) });
      }

      if (rows.length === 0) {
        return reply.status(400).send({ error: "CSV file is empty" });
      }

      // Validate required columns
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

      // Create upload record
      const upload = await prisma.upload.create({
        data: {
          tenantId,
          filename: data.filename,
          rowCount: rows.length,
          status: "PENDING",
        },
      });

      // Bulk insert transactions
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

      // Enqueue background analysis job
      await analysisQueue.add(
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
   * Get upload metadata
   */
  app.get<{ Params: { uploadId: string } }>(
    "/:uploadId",
    async (request, reply) => {
      const upload = await prisma.upload.findUnique({
        where: { id: request.params.uploadId },
        include: { _count: { select: { alerts: true } } },
      });

      if (!upload) return reply.status(404).send({ error: "Upload not found" });
      return upload;
    }
  );
}
