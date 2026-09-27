import { isIP } from "node:net";
import { config } from "../config.ts";

export type SearchResult = {
  url: string;
  title: string;
  content: string;
  /** "domain": on the company's domain or mentions its hostname; "name": matched by company name only. */
  attribution: "domain" | "name";
};
export type SearchOutcome = { results: SearchResult[]; queries: string[]; skipped?: string };

export type SearchDeps = {
  apiKey?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type RawResult = Omit<SearchResult, "attribution">;

const ENDPOINT = "https://api.tavily.com/search";
const MAX_ATTEMPTS = 3;
const GENERIC_NAMES = new Set(["company", "the company", "startup", "our company", "unknown", "n a", "na", "none", "confidential"]);

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function searchInterviewDiscussion(
  { companyName, companyUrl, roleTitle }: { companyName: string; companyUrl: string; roleTitle?: string },
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
  // Whole-word, case-insensitive: "Acme" must not match "Acmeville".
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "iu");
  const mentionsCompany = (r: RawResult) => word.test(r.title) || word.test(r.content);
  const attribution = attributionFor(companyUrl);

  for (const query of queries) {
    try {
      for (const r of await tavily(query, apiKey, doFetch, sleep)) {
        if (!byUrl.has(r.url) && mentionsCompany(r)) byUrl.set(r.url, { ...r, attribution: attribution(r) });
      }
    } catch (e) {
      failures.push(`${query}: ${(e as Error).message}`);
    }
  }
  return { results: [...byUrl.values()], queries, ...(failures.length ? { skipped: `search failed, ${failures.join("; ")}` } : {}) };
}

/** "domain" if the result is on the company's domain or mentions its hostname, else "name". Localhost/IPs never count. */
function attributionFor(companyUrl: string): (r: RawResult) => SearchResult["attribution"] {
  let host = "";
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(companyUrl) ? companyUrl : `https://${companyUrl}`).hostname.replace(/^www\./, "");
  } catch {
    // unparseable company URL → every result is name-only
  }
  const meaningful = host.includes(".") && !isIP(host.replace(/^\[|\]$/g, ""));
  return (r) => {
    if (!meaningful) return "name";
    try {
      const h = new URL(r.url).hostname;
      if (h === host || h.endsWith(`.${host}`)) return "domain";
    } catch {
      // fall through to the content check
    }
    return `${r.title}\n${r.content}`.toLowerCase().includes(host.toLowerCase()) ? "domain" : "name";
  };
}

async function tavily(query: string, apiKey: string, doFetch: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<RawResult[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { results?: Partial<RawResult>[] };
      return (data.results ?? [])
        .filter((r): r is RawResult => typeof r.url === "string")
        .map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "" }));
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw new Error(`Tavily HTTP ${res.status}`);
    await sleep(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }
}
