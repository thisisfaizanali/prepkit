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
