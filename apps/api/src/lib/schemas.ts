import { z } from "zod";

export const uploadIdParam = z.object({
  uploadId: z.string().min(1),
});

export const alertIdParam = z.object({
  alertId: z.string().min(1),
});

export const alertsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  minRisk: z.coerce.number().int().min(0).max(100).default(0),
});

export const tenantIdHeader = z
  .string()
  .min(1)
  .regex(/^[\w-]+$/, "tenantId must be alphanumeric");

export function parseTenant(raw: string | undefined): string {
  const result = tenantIdHeader.safeParse(raw ?? "default");
  return result.success ? result.data : "default";
}

export function zodError(issues: z.ZodIssue[]): string {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
