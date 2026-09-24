import * as cheerio from "cheerio";
import { isIP } from "node:net";
import { config } from "../config.ts";
import { extractContent, type ExtractedLink } from "./clean.ts";
import { RetrievalError } from "./errors.ts";
import { fetchPage, type FetchOptions } from "./fetchPage.ts";
import { HIRING_CONTENT_THRESHOLD, LINK_SIGNALS, LOCALE_PREFIX, scoreLink, scorePageContent, type LinkKind } from "./rankLinks.ts";
import { Robots } from "./robots.ts";
import { assertFetchable, normalizeCompanyUrl } from "./urlGuard.ts";

export type PageKind = "home" | LinkKind;
export type CrawlPage = {
  url: string;
  title: string;
  description: string;
  text: string;
  kind: PageKind;
  linkScore: number;
  contentScore: number;
};
export type CrawlResult = {
  startUrl: string;
  reachable: boolean;
  error?: { code: string; message: string };
  pages: CrawlPage[];
  /** Every source we tried and couldn't use, with the error code. */
  skipped: { url: string; reason: string }[];
  /** Sitemap discovery log: each sitemap tried, where it came from, and how many <loc> URLs it gave (or why none). */
  sitemaps: SitemapReport[];
  /** True only for pages whose content confirms a hiring process. */
  hiringPageFound: boolean;
  aboutPageFound: boolean;
};
export type SitemapReport = {
  url: string;
  source: "robots" | "fallback" | "index";
  /** <loc> URLs parsed from this sitemap. */
  urls: number;
  /** How many of those made the top-N candidate cut. */
  kept: number;
  children?: number;
  error?: string;
};
export type CrawlOptions = FetchOptions & { maxPages?: number; maxDepth?: number };

type Candidate = { url: string; score: number; kind: LinkKind; fallbackKind: LinkKind; depth: number };

const MAX_SITEMAP_URLS = 20_000; // <loc> URLs parsed in total, across all sitemaps
const MAX_SITEMAP_FILES = 5; // sitemaps taken from robots.txt, and children per index
const MAX_SITEMAP_CANDIDATES = 50; // best-scoring sitemap URLs that enter the queue
const RESERVED_HIRING_FETCHES = 2; // first picks after the start page reserved for "hiring"-kind candidates
const HIRINGISH: PageKind[] = ["hiring", "careers"];

const directoryOf = (pathname: string) => pathname.slice(0, pathname.lastIndexOf("/") + 1);
// ponytail: naive for co.uk-style TLDs; use a public-suffix list if needed.
const baseDomain = (host: string) => host.split(".").slice(-2).join(".");

/**
 * Crawl scope for a start page: same host under the start directory, or (when the start is a site root)
 * a subdomain of its base domain, e.g. about.gitlab.com → handbook.gitlab.com. The bare base domain is in
 * scope only when the start host is the base domain or www.<base>, so about.gitlab.com never wanders into
 * gitlab.com. IP / localhost starts: same host only.
 */
export function makeScope(home: URL): (u: URL) => boolean {
  const prefix = directoryOf(home.pathname);
  const hostIsLocal = isIP(home.hostname.replace(/^\[|\]$/g, "")) !== 0 || home.hostname === "localhost";
  const base = baseDomain(home.hostname);
  const startIsApex = home.hostname === base || home.hostname === `www.${base}`;
  return (u) => {
    if (u.host === home.host && u.pathname.startsWith(prefix)) return true;
    if (hostIsLocal || prefix !== "/") return false;
    if (u.hostname.endsWith(`.${base}`)) return true;
    return u.hostname === base && startIsApex;
  };
}

export async function crawlCompany(startInput: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 10;
  const maxDepth = opts.maxDepth ?? 2;
  const skipped: CrawlResult["skipped"] = [];
  const sitemaps: SitemapReport[] = [];
  const robots = new Robots(opts);
  const guard = opts.guard ?? ((u: URL) => assertFetchable(u, { allowPrivate: opts.allowPrivate ?? config.ALLOW_PRIVATE_URLS }));
  const reportedRobots = new Set<string>();
  const noteRobotsProblem = async (origin: string) => {
    if (reportedRobots.has(origin)) return;
    reportedRobots.add(origin);
    const problem = await robots.problem(origin);
    if (problem && !/^HTTP_4/.test(problem.code)) skipped.push({ url: `${origin}/robots.txt`, reason: problem.code });
  };
  const allowed = async (url: string) => {
    const ok = await robots.isAllowed(url);
    await noteRobotsProblem(new URL(url).origin);
    return ok;
  };

  // 1. Start page: any failure here → reachable:false, never throw.
  let startUrl = startInput;
  let home;
  try {
    const start = normalizeCompanyUrl(startInput);
    startUrl = start.href;
    await guard(start);
    if (!(await allowed(start.href))) {
      const problem = await robots.problem(start.origin);
      throw problem && !/^HTTP_4/.test(problem.code)
        ? new RetrievalError(problem.code, `robots.txt could not be fetched, so the site is off-limits: ${problem.message}`, start.href)
        : new RetrievalError("ROBOTS_DISALLOWED", "robots.txt disallows the start page", start.href);
    }
    home = await fetchPage(start, opts);
  } catch (e) {
    const err = e instanceof RetrievalError ? e : new RetrievalError("NETWORK", String(e), startUrl);
    return { startUrl, reachable: false, error: { code: err.code, message: err.message }, pages: [], skipped, sitemaps, hiringPageFound: false, aboutPageFound: false };
  }

  const homeUrl = new URL(home.url);
  const prefix = directoryOf(homeUrl.pathname);
  const context = { startLocalised: LOCALE_PREFIX.test(homeUrl.pathname) };
  const inScope = makeScope(homeUrl);

  const pages: CrawlPage[] = [];
  const seen = new Set<string>([startUrl, home.url]);
  const queue = new Map<string, Candidate>();
  let attempts = 1;

  const enqueue = (links: ExtractedLink[], depth: number, foundOn: PageKind) => {
    if (depth > maxDepth) return;
    for (const link of links) {
      const url = new URL(link.url);
      if (seen.has(url.href) || !inScope(url)) continue;
      const ranked = scoreLink(link, context);
      if (ranked.score <= 0) continue;
      const score = ranked.score + (HIRINGISH.includes(foundOn) ? LINK_SIGNALS.foundOnHiringPageBonus : 0);
      const existing = queue.get(url.href);
      if (!existing || score > existing.score) queue.set(url.href, { url: url.href, score, kind: ranked.kind, fallbackKind: ranked.fallbackKind, depth });
    }
  };

  // "hiring" only when the content confirms it; a hiring-looking link falls back to its next-best category.
  const addPage = (url: string, html: string, link: Pick<Candidate, "kind" | "fallbackKind"> | "home", linkScore: number) => {
    const content = extractContent(html, url);
    const contentScore = scorePageContent(content.text);
    const finalKind: PageKind =
      link === "home" ? "home" : contentScore >= HIRING_CONTENT_THRESHOLD ? "hiring" : link.kind === "hiring" ? link.fallbackKind : link.kind;
    pages.push({ url, title: content.title, description: content.description, text: content.text, kind: finalKind, linkScore, contentScore });
    return { content, kind: finalKind };
  };

  const homePage = addPage(home.url, home.body, "home", 0);
  enqueue(homePage.content.links, 1, "home");

  // 2. Sitemaps (silent-skip on failure): robots Sitemap: lines, else <prefix>sitemap.xml.
  // Score every parsed URL by path, then queue only the best, so relevant pages deep in a big sitemap still count.
  const sitemapLocs = await readSitemaps(
    (await robots.sitemaps(homeUrl.origin)).slice(0, MAX_SITEMAP_FILES),
    `${homeUrl.origin}${prefix}sitemap.xml`,
    opts,
    allowed,
    skipped,
    sitemaps,
  );
  const sitemapBest = new Map<string, { url: string; score: number; from: SitemapReport }>();
  for (const { url, from } of sitemapLocs) {
    const u = new URL(url);
    if (sitemapBest.has(u.href) || seen.has(u.href) || !inScope(u)) continue;
    const { score } = scoreLink({ url: u.href, text: "" }, context);
    if (score > 0) sitemapBest.set(u.href, { url: u.href, score, from });
  }
  const topSitemap = [...sitemapBest.values()]
    .sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .slice(0, MAX_SITEMAP_CANDIDATES);
  for (const c of topSitemap) c.from.kept++;
  enqueue(topSitemap.map((c) => ({ url: c.url, text: "" })), 1, "home");

  // 3. Best-first. The first picks after the start page go to strictly-hiring candidates (path-only sitemap
  // URLs can't outscore anchor-text links otherwise); then one about-ish candidate gets an early turn.
  let picks = 0;
  const pick = (): Candidate | undefined => {
    const ordered = [...queue.values()].sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    const haveAbout = pages.some((p) => p.kind === "about");
    return (
      (picks++ < RESERVED_HIRING_FETCHES && ordered.find((c) => c.kind === "hiring")) ||
      (!haveAbout && ordered.find((c) => c.kind === "about")) ||
      ordered[0]
    );
  };

  for (let next = pick(); next && attempts < maxPages; next = pick()) {
    queue.delete(next.url);
    seen.add(next.url);
    if (!(await allowed(next.url))) {
      skipped.push({ url: next.url, reason: "ROBOTS_DISALLOWED" });
      continue;
    }
    attempts++;
    let page;
    try {
      page = await fetchPage(next.url, opts);
    } catch (e) {
      skipped.push({ url: next.url, reason: e instanceof RetrievalError ? e.code : "NETWORK" });
      continue;
    }
    if (page.url !== next.url) {
      if (seen.has(page.url)) {
        skipped.push({ url: next.url, reason: "DUPLICATE" });
        continue;
      }
      if (!inScope(new URL(page.url))) {
        skipped.push({ url: next.url, reason: "OUT_OF_SCOPE_REDIRECT" });
        continue;
      }
      seen.add(page.url);
    }
    const added = addPage(page.url, page.body, next, next.score);
    enqueue(added.content.links, next.depth + 1, added.kind);
  }

  return {
    startUrl,
    reachable: true,
    pages,
    skipped,
    sitemaps,
    hiringPageFound: pages.some((p) => p.kind === "hiring"),
    aboutPageFound: pages.some((p) => p.kind === "about"),
  };
}

async function readSitemaps(
  listed: string[],
  fallback: string,
  opts: FetchOptions,
  allowed: (url: string) => Promise<boolean>,
  skipped: CrawlResult["skipped"],
  reports: SitemapReport[],
): Promise<{ url: string; from: SitemapReport }[]> {
  const urls: { url: string; from: SitemapReport }[] = [];
  const parsed = new Set<string>();
  const read = async (sitemapUrl: string, source: SitemapReport["source"]) => {
    const report: SitemapReport = { url: sitemapUrl, source, urls: 0, kept: 0 };
    reports.push(report);
    if (parsed.has(sitemapUrl)) return void (report.error = "duplicate");
    parsed.add(sitemapUrl);
    if (urls.length >= MAX_SITEMAP_URLS) return void (report.error = `URL cap of ${MAX_SITEMAP_URLS} already reached`);
    if (!(await allowed(sitemapUrl))) {
      report.error = "ROBOTS_DISALLOWED";
      return void skipped.push({ url: sitemapUrl, reason: "ROBOTS_DISALLOWED" });
    }
    let body: string;
    try {
      const page = await fetchPage(sitemapUrl, { ...opts, allowXml: true });
      body = page.body;
      if (page.truncated) report.error = "truncated at size cap (partial)";
    } catch (e) {
      const code = e instanceof RetrievalError ? e.code : "NETWORK";
      report.error = code;
      return void skipped.push({ url: sitemapUrl, reason: code });
    }
    const $ = cheerio.load(body, { xml: true });
    const locs = (sel: string) => $(sel).map((_, el) => $(el).text().trim()).get().filter(Boolean);
    if ($("sitemapindex").length) {
      const children = locs("sitemap > loc");
      report.children = children.length;
      if (source === "index") return void (report.error = "nested sitemap index ignored (one level only)");
      for (const child of children.slice(0, MAX_SITEMAP_FILES)) await read(child, "index");
      return;
    }
    const before = urls.length;
    for (const loc of locs("url > loc")) {
      if (urls.length >= MAX_SITEMAP_URLS) break;
      try {
        urls.push({ url: new URL(loc).href, from: report });
      } catch {
        // ignore malformed <loc>
      }
    }
    report.urls = urls.length - before;
  };
  if (listed.length) for (const s of listed) await read(s, "robots");
  else await read(fallback, "fallback");
  return urls;
}
