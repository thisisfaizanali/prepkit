// Test-only fakes for pipeline steps.
import type { CompleteRequest } from "../llm/client.ts";
import type { PipelineDeps, ProgressEvent } from "./trace.ts";

/** Fake LLM: responses keyed by call label (a list is consumed in order); records every request. */
export function fakeLLM(responses: Record<string, unknown | unknown[]>) {
  const calls: CompleteRequest[] = [];
  const queues = new Map(Object.entries(responses).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  return {
    calls,
    complete: async (req: CompleteRequest) => {
      calls.push(req);
      const queue = queues.get(req.label.replace(/ \(repair\)$/, ""));
      if (!queue?.length) throw new Error(`fakeLLM: no response queued for "${req.label}"`);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { text: typeof next === "string" ? next : JSON.stringify(next), provider: "fake", model: "fake-1", usage: { total_tokens: 10 } };
    },
  };
}

export function fakeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps & { events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return {
    llm: fakeLLM({}),
    crawl: async () => {
      throw new Error("crawl not faked");
    },
    search: async () => ({ results: [], queries: [] }),
    fetchPage: async () => {
      throw new Error("fetchPage not faked");
    },
    now: () => 0,
    onProgress: (e) => events.push(e),
    events,
    ...overrides,
  };
}

/**
 * Fake LLM that answers generation prompts like a well-behaved model: "Write exactly N" → N questions spread over
 * the listed requirement ids; gap prompts → one per id; flashcards → one card per id. Other labels from `fixed`.
 * `skip` lists requirement ids it never writes about (to exercise gaps and fallbacks).
 */
export function scriptedLLM(fixed: Record<string, unknown>, { skip = [] as string[] } = {}) {
  const calls: CompleteRequest[] = [];
  const respond = (req: CompleteRequest): unknown => {
    const label = req.label.replace(/ \(repair\)$/, "");
    if (label in fixed) return fixed[label];
    const ids = [...req.user.matchAll(/^(r\d+) \[/gm)].map((m) => m[1]).filter((id) => !skip.includes(id));
    if (label === "flashcards") return { cards: ids.map((id) => ({ requirement_ids: [id], front: `Recall ${id}`, back: `Answer ${id}` })) };
    const n = label.startsWith("gap:") ? ids.length : Number(/Write exactly (\d+)/.exec(req.user)?.[1] ?? 0);
    const questions = Array.from({ length: n }, (_, i) => ({
      requirement_ids: ids.length ? [ids[i % ids.length]] : [],
      prompt: `${label} question ${i + 1}`,
      answer_outline: "- point",
      difficulty: (i % 3) + 1,
    }));
    return { questions };
  };
  return {
    calls,
    complete: async (req: CompleteRequest) => {
      calls.push(req);
      return { text: JSON.stringify(respond(req)), provider: "fake", model: "fake-1", usage: { total_tokens: 10 } };
    },
  };
}
