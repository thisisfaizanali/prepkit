import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Repo-root .env (apps/api/src → ../../../.env). Real env vars win over the file.
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
// Sent as `reasoning_effort`. Set to "off" to omit it (for models that reject the param).
const reasoningEffort = (fallback: "off" | "low" | "medium" | "high") =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(["off", "low", "medium", "high"]).default(fallback));

const EnvSchema = z.object({
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_TPM: positiveInt(6000),
  GROQ_REASONING_EFFORT: reasoningEffort("low"),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_TPM: positiveInt(200000),
  GEMINI_REASONING_EFFORT: reasoningEffort("low"),
  LLM_TIMEOUT_MS: positiveInt(60000),
  // The batch grader serves fixture sites from localhost, so private URLs are allowed outside production.
  // In production they must be blocked (SSRF: cloud metadata, internal services).
  TAVILY_API_KEY: optionalString,
  ALLOW_PRIVATE_URLS: z.preprocess(
    (v) => (v === undefined || v === "" ? process.env.NODE_ENV !== "production" : v === "true" || v === "1"),
    z.boolean(),
  ),
});

export const config = EnvSchema.parse(process.env);
export type Config = typeof config;
