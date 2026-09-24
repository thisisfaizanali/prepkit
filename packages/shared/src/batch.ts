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
