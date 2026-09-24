import { config } from "../config.ts";

export type SearchResult = { url: string; title: string; content: string };
export type SearchOutcome = { results: SearchResult[]; queries: string[]; skipped?: string };

export type SearchDeps = {
  apiKey?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const ENDPOINT = "https://api.tavily.com/search";
const MAX_ATTEMPTS = 3;
const GENERIC_NAMES = new Set(["company", "the company", "startup", "our company", "unknown", "n a", "na", "none", "confidential"]);

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function searchInterviewDiscussion(
  { companyName, roleTitle }: { companyName: string; companyUrl: string; roleTitle?: string },
  deps: SearchDeps = {},
): Promise<SearchOutcome> {
  const apiKey = deps.apiKey ?? config.TAVILY_API_KEY;
  if (!apiKey) return { results: [], queries: [], skipped: "TAVILY_API_KEY not set" };

  const name = companyName.trim();
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized.length < 2 || GENERIC_NAMES.has(normalized)) {
    return { results: [], queries: [], skipped: `company name "${name}" is empty or too generic to search for` };
  }

  const queries = [`"${name}" interview process`];
  if (roleTitle?.trim()) queries.push(`"${name}" ${roleTitle.trim()} interview questions`);

  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? sleepReal;
  const byUrl = new Map<string, SearchResult>();
  const failures: string[] = [];
  const mentionsCompany = (r: SearchResult) => `${r.title}\n${r.content}`.toLowerCase().includes(name.toLowerCase());

  for (const query of queries) {
    try {
      for (const r of await tavily(query, apiKey, doFetch, sleep)) {
        if (!byUrl.has(r.url) && mentionsCompany(r)) byUrl.set(r.url, r);
      }
    } catch (e) {
      failures.push(`${query}: ${(e as Error).message}`);
    }
  }
  return { results: [...byUrl.values()], queries, ...(failures.length ? { skipped: `search failed — ${failures.join("; ")}` } : {}) };
}

async function tavily(query: string, apiKey: string, doFetch: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { results?: Partial<SearchResult>[] };
      return (data.results ?? [])
        .filter((r): r is SearchResult => typeof r.url === "string")
        .map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "" }));
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw new Error(`Tavily HTTP ${res.status}`);
    await sleep(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }
}
