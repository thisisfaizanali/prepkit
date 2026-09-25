import { z } from "zod";
import { KitSchema } from "./kit.ts";

export const BatchCaseSchema = z.object({
  id: z.string(),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1),
});
export const BatchInputSchema = z.array(BatchCaseSchema);

export const BatchResultSchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "failed"]),
  kit: KitSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const BatchOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  kits: z.array(BatchResultSchema),
});

export type BatchCase = z.infer<typeof BatchCaseSchema>;
export type BatchInput = z.infer<typeof BatchInputSchema>;
export type BatchResult = z.infer<typeof BatchResultSchema>;
export type BatchOutput = z.infer<typeof BatchOutputSchema>;

/** One kit request, as POST /api/kits takes it (and each case of POST /api/kits/batch). */
export const KitInputSchema = z.object({
  jd: z.string().trim().min(1, "jd is empty").max(50_000),
  company_url: z.string().trim().min(1, "company_url is empty").max(2000),
  days: z.number().int().min(1).max(90),
});
export const MAX_BATCH = 10;
export const KitBatchRequestSchema = z.object({ cases: z.array(KitInputSchema).min(1).max(MAX_BATCH) });
export type KitInputRequest = z.infer<typeof KitInputSchema>;
