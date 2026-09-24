import type { LLMClient } from "../llm/client.ts";
import type { GenerateJsonResult } from "../llm/json.ts";
import type { crawlCompany } from "../retrieval/crawl.ts";
import type { fetchPage } from "../retrieval/fetchPage.ts";
import type { searchInterviewDiscussion } from "../retrieval/search.ts";

export type LLMCallInfo = { label: string; provider: string; model: string; tokens: number; repaired: boolean };

export type ProgressEvent = {
  step: string;
  status: "started" | "done" | "skipped" | "failed";
  detail?: string;
  ms?: number;
  llm?: LLMCallInfo;
};

/** Everything a pipeline step touches, injected so tests can fake it. */
export type PipelineDeps = {
  llm: Pick<LLMClient, "complete">;
  crawl: typeof crawlCompany;
  search: typeof searchInterviewDiscussion;
  fetchPage: typeof fetchPage;
  now: () => number;
  onProgress: (e: ProgressEvent) => void;
};

/** Collects every progress event (the future `pipeline_trace`) and forwards it. */
export function createTrace(forward?: (e: ProgressEvent) => void) {
  const trace: ProgressEvent[] = [];
  return { trace, onProgress: (e: ProgressEvent) => (trace.push(e), forward?.(e)) };
}

export const llmInfo = (label: string, r: Omit<GenerateJsonResult<unknown>, "data">): LLMCallInfo => ({
  label,
  provider: r.provider,
  model: r.model,
  tokens: r.usage.total_tokens,
  repaired: r.repaired,
});

/** Run a step with started/done/failed events and timing. */
export async function traced<T>(
  deps: Pick<PipelineDeps, "now" | "onProgress">,
  step: string,
  fn: () => Promise<T>,
  summarize?: (result: T) => Pick<ProgressEvent, "detail" | "llm">,
): Promise<T> {
  const start = deps.now();
  deps.onProgress({ step, status: "started" });
  try {
    const result = await fn();
    deps.onProgress({ step, status: "done", ms: deps.now() - start, ...summarize?.(result) });
    return result;
  } catch (e) {
    deps.onProgress({ step, status: "failed", ms: deps.now() - start, detail: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
