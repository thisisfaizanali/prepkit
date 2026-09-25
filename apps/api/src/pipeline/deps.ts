import type { Config } from "../config.ts";
import { LLMClient, providersFromConfig, type LLMEvent } from "../llm/client.ts";
import { crawlCompany } from "../retrieval/crawl.ts";
import { fetchPage } from "../retrieval/fetchPage.ts";
import { searchInterviewDiscussion } from "../retrieval/search.ts";
import type { PipelineDeps } from "./trace.ts";

export type CoreDeps = Omit<PipelineDeps, "onProgress">;

/** Real pipeline dependencies. Call once per process: the LLM client's pacing windows must be shared by every run. */
export function createPipelineDeps(config: Config, { onLLMEvent }: { onLLMEvent?: (e: LLMEvent) => void } = {}): CoreDeps {
  return {
    llm: new LLMClient({ providers: providersFromConfig(config), timeoutMs: config.LLM_TIMEOUT_MS, onEvent: onLLMEvent }),
    crawl: crawlCompany,
    search: searchInterviewDiscussion,
    fetchPage,
    now: Date.now,
  };
}
