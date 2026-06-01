"use client";

import Papa from "papaparse";
import type { Transaction } from "@/types/aml";

export interface ParseResult {
  transactions: Transaction[];
  detectedColumns: string[];
  validationErrors: string[];
  rowCount: number;
}

const REQUIRED_COLUMNS = ["tx_id", "from_account", "to_account", "amount", "date"];
const OPTIONAL_COLUMNS = ["currency", "type", "country", "description"];

export function parseTransactionCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields: string[] = results.meta.fields ?? [];
        const detectedColumns = fields.filter(
          (f) => REQUIRED_COLUMNS.includes(f) || OPTIONAL_COLUMNS.includes(f)
        );

        const validationErrors: string[] = [];

        // Check required columns
        for (const col of REQUIRED_COLUMNS) {
          if (!fields.includes(col)) {
            validationErrors.push(`Missing required column: "${col}"`);
          }
        }

        const rawRows = results.data as Record<string, string>[];
        const transactions: Transaction[] = [];

        rawRows.forEach((row, idx) => {
          const rowNum = idx + 2; // 1-based, plus header row
          const tx_id = row["tx_id"]?.trim();
          const from_account = row["from_account"]?.trim();
          const to_account = row["to_account"]?.trim();
          const amountRaw = row["amount"]?.trim();
          const date = row["date"]?.trim();

          if (!tx_id) {
            validationErrors.push(`Row ${rowNum}: missing tx_id`);
            return;
          }
          if (!from_account) {
            validationErrors.push(`Row ${rowNum}: missing from_account`);
            return;
          }
          if (!to_account) {
            validationErrors.push(`Row ${rowNum}: missing to_account`);
            return;
          }
          if (!amountRaw || isNaN(Number(amountRaw))) {
            validationErrors.push(`Row ${rowNum}: invalid amount "${amountRaw}"`);
            return;
          }
          if (!date) {
            validationErrors.push(`Row ${rowNum}: missing date`);
            return;
          }

          transactions.push({
            tx_id,
            from_account,
            to_account,
            amount: Number(amountRaw),
            date,
            currency: row["currency"]?.trim() || undefined,
            type: row["type"]?.trim() || undefined,
            country: row["country"]?.trim() || undefined,
            description: row["description"]?.trim() || undefined,
          });
        });

        resolve({
          transactions,
          detectedColumns,
          validationErrors,
          rowCount: rawRows.length,
        });
      },
      error: (err) => {
        resolve({
          transactions: [],
          detectedColumns: [],
          validationErrors: [`CSV parse error: ${err.message}`],
          rowCount: 0,
        });
      },
    });
  });
}

export function downloadSampleCsv(): void {
  const rows = [
    ["tx_id", "from_account", "to_account", "amount", "currency", "date", "type", "country", "description"],
    ["TX-001", "ACC-1001", "ACC-2001", "9500", "EUR", "2024-01-15", "WIRE", "DE", "Invoice payment"],
    ["TX-002", "ACC-1002", "ACC-2002", "150000", "USD", "2024-01-15", "WIRE", "US", "Real estate"],
    ["TX-003", "ACC-1001", "ACC-2003", "9800", "EUR", "2024-01-15", "WIRE", "DE", "Consulting fee"],
    ["TX-004", "ACC-1001", "ACC-2004", "9750", "EUR", "2024-01-15", "WIRE", "KP", "Services"],
    ["TX-005", "ACC-1003", "ACC-2005", "200", "EUR", "2024-01-16", "POS", "FR", "Retail"],
    ["TX-006", "ACC-1001", "ACC-2006", "9900", "EUR", "2024-01-15", "WIRE", "DE", "Consulting"],
  ];

  const csvContent = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sample_transactions.csv";
  link.click();
  URL.revokeObjectURL(url);
}
