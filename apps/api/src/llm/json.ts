import type { z } from "zod";
import { MAX_TOKENS } from "./budgets.ts";
import { LLMError, type CompleteRequest, type CompleteResult, type LLMClient } from "./client.ts";

export type GenerateJsonRequest<T> = Omit<CompleteRequest, "json"> & { schema: z.ZodType<T> };
export type GenerateJsonResult<T> = Omit<CompleteResult, "text"> & { data: T; repaired: boolean };

const MAX_LISTED_ERRORS = 20;

type Parsed<T> = { ok: true; data: T } | { ok: false; errors: string[] };

function parse<T>(text: string, schema: z.ZodType<T>): Parsed<T> {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let value: unknown;
  try {
    value = JSON.parse(fenced ? fenced[1] : text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, MAX_LISTED_ERRORS).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/** complete() with json:true, validated against `schema`, with one repair pass on failure. */
export async function generateJson<T>(
  client: Pick<LLMClient, "complete">,
  { schema, ...req }: GenerateJsonRequest<T>,
): Promise<GenerateJsonResult<T>> {
  const first = await client.complete({ ...req, json: true });
  const parsed = parse(first.text, schema);
  if (parsed.ok) return { data: parsed.data, provider: first.provider, model: first.model, usage: first.usage, repaired: false };

  const repairUser = [
    req.user,
    "",
    "Your previous response was:",
    first.text,
    "",
    "It failed validation with these errors:",
    ...parsed.errors.map((e) => `- ${e}`),
    "",
    "Return the corrected JSON only, with no commentary or code fences.",
  ].join("\n");
  const second = await client.complete({ ...req, user: repairUser, maxTokens: Math.max(req.maxTokens ?? 0, MAX_TOKENS.repair), json: true, label: `${req.label} (repair)` });
  const reparsed = parse(second.text, schema);
  const usage = { total_tokens: first.usage.total_tokens + second.usage.total_tokens };
  if (reparsed.ok) return { data: reparsed.data, provider: second.provider, model: second.model, usage, repaired: true };

  throw new LLMError(
    "LLM_INVALID_OUTPUT",
    `LLM output for "${req.label}" failed validation after one repair attempt: ${reparsed.errors.join("; ")}`,
  );
}
