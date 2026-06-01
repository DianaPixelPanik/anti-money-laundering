import { z } from "zod";

export const uploadIdParam = z.object({
  uploadId: z.string().min(1),
});

export const alertIdParam = z.object({
  alertId: z.string().min(1),
});

export const alertsQuery = z.object({
  limit:   z.coerce.number().int().min(1).max(200).default(50),
  minRisk: z.coerce.number().int().min(0).max(100).default(0),
});

export function zodError(issues: z.ZodIssue[]): string {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
