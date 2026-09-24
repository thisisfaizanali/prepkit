import { isIP } from "node:net";
import { extractContent } from "../../retrieval/clean.ts";
import { makeScope, type CrawlPage, type CrawlResult } from "../../retrieval/crawl.ts";
import { RetrievalError } from "../../retrieval/errors.ts";
import { HIRING_CONTENT_THRESHOLD, scorePageContent } from "../../retrieval/rankLinks.ts";
import type { SearchResult } from "../../retrieval/search.ts";
import { normalizeCompanyUrl } from "../../retrieval/urlGuard.ts";
import { traced, type PipelineDeps } from "../trace.ts";
import { extractRequirements, type ExtractionResult } from "./extractRequirements.ts";

const MAX_SEARCH_FETCHES = 2;

export type CompanyNameSource = "job_description" | "site_name" | "page_title" | "hostname";
export type SitePage = Pick<CrawlPage, "url" | "title" | "description" | "text"> & { kind: "home" | "about" | "careers" | "engineering" };
export type HiringPage = { url: string; title: string; text: string; contentScore: number; origin: "crawl" | "search" };

export type ResearchResult = {
  companyName: string;
  companyNameSource: CompanyNameSource;
  reachable: boolean;
  crawlError?: { code: string; message: string };
  pages: SitePage[];
  hiringPages: HiringPage[];
  /** Third-party (out-of-scope) search results about interviewing at the company. */
  discussion: SearchResult[];
  skipped: { source: string; reason: string }[];
  hiringPageFound: boolean;
  warnings: string[];
};

const GENERIC_TITLES = new Set(["home", "homepage", "welcome", "index"]);

/** extraction.company → og:site_name → first segment of the home <title> → hostname label. */
export function resolveCompanyName(
  extractedCompany: string | null,
  home: Pick<CrawlPage, "siteName" | "title"> | undefined,
  companyUrl: string,
): { name: string; source: CompanyNameSource } {
  if (extractedCompany?.trim()) return { name: extractedCompany.trim(), source: "job_description" };
  if (home?.siteName) return { name: home.siteName, source: "site_name" };
  const segment = home?.title
    .split(/\s[|–—\-:·]\s|[|–—:·]/)
    .map((s) => s.trim())
    .find(Boolean);
  if (segment && !GENERIC_TITLES.has(segment.toLowerCase())) return { name: segment, source: "page_title" };

  let host: string;
  try {
    host = normalizeCompanyUrl(companyUrl).hostname.replace(/^www\./, "");
  } catch {
    host = companyUrl;
  }
  const labels = host.split(".");
  const label = isIP(host.replace(/^\[|\]$/g, "")) || labels.length < 2 ? host : labels[labels.length - 2];
  return { name: label.charAt(0).toUpperCase() + label.slice(1), source: "hostname" };
}

/**
 * Extraction and the crawl run in parallel (they're independent); then search, plus search-assisted hiring
 * discovery when the crawl found no content-confirmed hiring page.
 */
export async function extractAndResearch(
  input: { jd: string; companyUrl: string },
  deps: PipelineDeps,
): Promise<{ extraction: ExtractionResult; research: ResearchResult }> {
  const crawlP = traced(
    deps,
    "crawl",
    () => deps.crawl(input.companyUrl),
    (c) => ({
      detail: c.reachable
        ? `${c.pages.length} pages, hiring page ${c.hiringPageFound ? "found" : "not found"}`
        : `unreachable: ${c.error?.code}`,
    }),
  );
  const [extraction, crawl] = await Promise.all([extractRequirements(input.jd, deps), crawlP]);
  const research = await gatherResearch(input.companyUrl, extraction, crawl, deps);
  return { extraction, research };
}

async function gatherResearch(companyUrl: string, extraction: ExtractionResult, crawl: CrawlResult, deps: PipelineDeps): Promise<ResearchResult> {
  const home = crawl.pages.find((p) => p.kind === "home");
  const { name: companyName, source: companyNameSource } = resolveCompanyName(extraction.extraction.company, home, companyUrl);
  const skipped: ResearchResult["skipped"] = crawl.skipped.map((s) => ({ source: s.url, reason: s.reason }));

  const pages: SitePage[] = crawl.pages
    .filter((p): p is CrawlPage & { kind: SitePage["kind"] } => ["home", "about", "careers", "engineering"].includes(p.kind))
    .map(({ url, title, description, text, kind }) => ({ url, title, description, text, kind }));
  const hiringPages: HiringPage[] = crawl.pages
    .filter((p) => p.kind === "hiring")
    .map(({ url, title, text, contentScore }) => ({ url, title, text, contentScore, origin: "crawl" }));

  const search = await traced(
    deps,
    "search",
    () => deps.search({ companyName, companyUrl, roleTitle: extraction.extraction.title || undefined }),
    (s) => ({ detail: s.skipped ? `skipped: ${s.skipped}` : `${s.results.length} results for ${s.queries.length} queries` }),
  );
  if (search.skipped) skipped.push({ source: "search", reason: search.skipped });

  const inScope = home ? makeScope(new URL(home.url)) : () => false;
  const companyOwned = search.results.filter((r) => safeUrl(r.url) && inScope(new URL(r.url)));
  const discussion = search.results.filter((r) => !companyOwned.includes(r));

  // Search-assisted hiring discovery: the crawl may miss a hiring page the search engine knows about.
  if (hiringPages.length === 0 && crawl.reachable) {
    const crawled = new Set(crawl.pages.map((p) => p.url));
    const candidates = companyOwned.filter((r) => !crawled.has(r.url)).slice(0, MAX_SEARCH_FETCHES);
    if (candidates.length === 0) {
      deps.onProgress({ step: "search_hiring_discovery", status: "skipped", detail: "no in-scope search results to check" });
    } else {
      await traced(
        deps,
        "search_hiring_discovery",
        async () => {
          const found: string[] = [];
          for (const c of candidates) {
            try {
              const page = await deps.fetchPage(c.url);
              const content = extractContent(page.body, page.url);
              const contentScore = scorePageContent(content.text);
              if (contentScore >= HIRING_CONTENT_THRESHOLD) {
                hiringPages.push({ url: page.url, title: content.title, text: content.text, contentScore, origin: "search" });
                found.push(page.url);
              }
            } catch (e) {
              skipped.push({ source: c.url, reason: e instanceof RetrievalError ? e.code : "NETWORK" });
            }
          }
          return found;
        },
        (found) => ({ detail: `checked ${candidates.length} in-scope result(s), ${found.length} confirmed as hiring pages` }),
      );
    }
  }

  const warnings: string[] = [];
  if (!crawl.reachable) {
    warnings.push(
      `The company site (${companyUrl}) could not be reached (${crawl.error?.code ?? "UNKNOWN"}); company research is limited to the job description.`,
    );
  } else {
    if (!pages.some((p) => p.kind === "about")) warnings.push("No about page was found on the company site.");
    if (hiringPages.length === 0) warnings.push("No published hiring or interview process was found on the company site.");
  }
  if (discussion.length === 0) {
    warnings.push(`No public interview discussion was found${search.skipped ? ` (${search.skipped})` : ""}.`);
  }

  return {
    companyName,
    companyNameSource,
    reachable: crawl.reachable,
    ...(crawl.error ? { crawlError: crawl.error } : {}),
    pages,
    hiringPages,
    discussion,
    skipped,
    hiringPageFound: hiringPages.length > 0,
    warnings,
  };
}

function safeUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
