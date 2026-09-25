import { isIP } from "node:net";
import { extractContent } from "../../retrieval/clean.ts";
import { makeScope, type CrawlPage, type CrawlResult } from "../../retrieval/crawl.ts";
import { RetrievalError } from "../../retrieval/errors.ts";
import { HIRING_CONTENT_THRESHOLD, scorePageContent } from "../../retrieval/rankLinks.ts";
import type { SearchOutcome, SearchResult } from "../../retrieval/search.ts";
import { isBlockedAddress, normalizeCompanyUrl } from "../../retrieval/urlGuard.ts";
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
  discussion: DiscussionResult[];
  skipped: { source: string; reason: string }[];
  hiringPageFound: boolean;
  /** The JD names one company, the website looks like another's: site content is not used. */
  siteMismatch?: { jdCompany: string; siteName: string };
  warnings: string[];
};

/** A search result plus whether it may feed the hiring-process summary. */
export type DiscussionResult = SearchResult & { usedForSummary: boolean };

const GENERIC_TITLES = new Set(["home", "homepage", "welcome", "index"]);
const UNKNOWN_NAME_REASON = "company name unknown — public search skipped to avoid attributing results to the wrong organisation";

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

  // Last resort: the hostname label. localhost / IP literals say nothing about the company → unknown ("").
  let host = "";
  try {
    host = normalizeCompanyUrl(companyUrl).hostname.replace(/^www\./, "");
  } catch {
    // unparseable URL → unknown
  }
  const labels = host.split(".");
  if (!host || isLocalHost(host) || labels.length < 2) return { name: "", source: "hostname" };
  const label = labels[labels.length - 2];
  return { name: label.charAt(0).toUpperCase() + label.slice(1), source: "hostname" };
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** Loose name match: either normalised name contains the other ("PostHog" ~ "PostHog Inc."). */
export function namesMatch(a: string, b: string): boolean {
  const [x, y] = [squash(a), squash(b)];
  return !x || !y || x.includes(y) || y.includes(x);
}

/** localhost, *.localhost, or an IP literal. */
function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || isIP(h) !== 0;
}

/** Company URL on a loopback / private / local address (e.g. a grader's fixture server). */
function isPrivateCompanyUrl(companyUrl: string): boolean {
  try {
    const h = normalizeCompanyUrl(companyUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h.endsWith(".localhost") || (isIP(h) !== 0 && isBlockedAddress(h));
  } catch {
    return false;
  }
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

  // Who the website says it is, ignoring the JD. A clash means the URL is probably for another company.
  const jdCompany = extraction.extraction.company?.trim() ?? "";
  const siteName = resolveCompanyName(null, home, companyUrl).name;
  const siteMismatch = jdCompany && siteName && !namesMatch(jdCompany, siteName) ? { jdCompany, siteName } : undefined;

  const pages: SitePage[] = siteMismatch ? [] : crawl.pages
    .filter((p): p is CrawlPage & { kind: SitePage["kind"] } => ["home", "about", "careers", "engineering"].includes(p.kind))
    .map(({ url, title, description, text, kind }) => ({ url, title, description, text, kind }));
  const hiringPages: HiringPage[] = crawl.pages
    .filter((p) => p.kind === "hiring" && !siteMismatch)
    .map(({ url, title, text, contentScore }) => ({ url, title, text, contentScore, origin: "crawl" }));

  // A name guessed from the hostname (or none at all) could belong to anyone: don't search the web with it.
  const nameUnknown = companyNameSource === "hostname" || !companyName;
  let search: SearchOutcome;
  if (nameUnknown) {
    search = { results: [], queries: [], skipped: UNKNOWN_NAME_REASON };
    deps.onProgress({ step: "search", status: "skipped", detail: UNKNOWN_NAME_REASON });
  } else {
    search = await traced(
      deps,
      "search",
      () => deps.search({ companyName, companyUrl, roleTitle: extraction.extraction.title || undefined }),
      (s) => ({ detail: s.skipped ? `skipped: ${s.skipped}` : `${s.results.length} results for ${s.queries.length} queries` }),
    );
  }
  if (search.skipped) skipped.push({ source: "search", reason: search.skipped });

  const inScope = home ? makeScope(new URL(home.url)) : () => false;
  const companyOwned = search.results.filter((r) => safeUrl(r.url) && inScope(new URL(r.url)));
  // For a private/local company URL, a name-only match can't be confirmed to be about this company:
  // keep it visible in research, but out of the hiring-process summary.
  const privateUrl = isPrivateCompanyUrl(companyUrl);
  const discussion: DiscussionResult[] = search.results
    .filter((r) => !companyOwned.includes(r))
    .map((r) => ({ ...r, usedForSummary: !(privateUrl && r.attribution === "name") }));

  // Search-assisted hiring discovery: the crawl may miss a hiring page the search engine knows about.
  if (hiringPages.length === 0 && crawl.reachable && !siteMismatch) {
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
  if (siteMismatch) {
    warnings.push(
      `The job description names ${jdCompany} but the website appears to belong to ${siteName}; site content was not used for the company brief or hiring process.`,
    );
  } else if (!crawl.reachable) {
    warnings.push(
      `The company site (${companyUrl}) could not be reached (${crawl.error?.code ?? "UNKNOWN"}); company research is limited to the job description.`,
    );
  } else {
    if (!pages.some((p) => p.kind === "about")) warnings.push("No about page was found on the company site.");
    if (hiringPages.length === 0) warnings.push("No published hiring or interview process was found on the company site.");
  }
  if (nameUnknown) {
    warnings.push("The company name could not be determined, so public interview discussion was not searched (to avoid attributing results to the wrong organisation).");
  } else if (discussion.length === 0) {
    warnings.push(`No public interview discussion was found${search.skipped ? ` (${search.skipped})` : ""}.`);
  }
  if (discussion.some((d) => !d.usedForSummary)) {
    warnings.push("Public discussion matched only by company name; not used because it can't be confirmed to be about this company.");
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
    ...(siteMismatch ? { siteMismatch } : {}),
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
