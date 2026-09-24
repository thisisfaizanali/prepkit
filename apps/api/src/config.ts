import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Repo-root .env (apps/api/src → ../../../.env). Real env vars win over the file.
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const EnvSchema = z.object({
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_TPM: positiveInt(6000),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_TPM: positiveInt(200000),
  LLM_TIMEOUT_MS: positiveInt(60000),
});

export const config = EnvSchema.parse(process.env);
export type Config = typeof config;
