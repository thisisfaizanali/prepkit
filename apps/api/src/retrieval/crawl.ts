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
  hiringPageFound: boolean;
  aboutPageFound: boolean;
};
export type CrawlOptions = FetchOptions & { maxPages?: number; maxDepth?: number };

type Candidate = { url: string; score: number; kind: LinkKind; depth: number };

const MAX_SITEMAP_URLS = 500;
const MAX_SITEMAP_FILES = 5;
const HIRINGISH: PageKind[] = ["hiring", "careers"];

const directoryOf = (pathname: string) => pathname.slice(0, pathname.lastIndexOf("/") + 1);
// ponytail: naive for co.uk-style TLDs; use a public-suffix list if needed.
const baseDomain = (host: string) => host.split(".").slice(-2).join(".");

export async function crawlCompany(startInput: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 8;
  const maxDepth = opts.maxDepth ?? 2;
  const skipped: CrawlResult["skipped"] = [];
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
    return { startUrl, reachable: false, error: { code: err.code, message: err.message }, pages: [], skipped, hiringPageFound: false, aboutPageFound: false };
  }

  const homeUrl = new URL(home.url);
  const prefix = directoryOf(homeUrl.pathname);
  const hostIsLocal = isIP(homeUrl.hostname.replace(/^\[|\]$/g, "")) !== 0 || homeUrl.hostname === "localhost";
  const context = { startLocalised: LOCALE_PREFIX.test(homeUrl.pathname) };
  const inScope = (u: URL) => {
    if (u.host === homeUrl.host && u.pathname.startsWith(prefix)) return true;
    if (hostIsLocal || prefix !== "/") return false;
    const base = baseDomain(homeUrl.hostname);
    return u.hostname === base || u.hostname.endsWith(`.${base}`);
  };

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
      if (!existing || score > existing.score) queue.set(url.href, { url: url.href, score, kind: ranked.kind, depth });
    }
  };

  const addPage = (url: string, html: string, kind: LinkKind | "home", linkScore: number) => {
    const content = extractContent(html, url);
    const contentScore = scorePageContent(content.text);
    const finalKind: PageKind = kind !== "home" && contentScore >= HIRING_CONTENT_THRESHOLD ? "hiring" : kind;
    pages.push({ url, title: content.title, description: content.description, text: content.text, kind: finalKind, linkScore, contentScore });
    return { content, kind: finalKind };
  };

  const homePage = addPage(home.url, home.body, "home", 0);
  enqueue(homePage.content.links, 1, "home");

  // 2. Sitemaps (silent-skip on failure): robots Sitemap: lines, else <prefix>sitemap.xml. Path-only scoring.
  const sitemapLinks = await readSitemaps(
    (await robots.sitemaps(homeUrl.origin)).slice(0, MAX_SITEMAP_FILES),
    `${homeUrl.origin}${prefix}sitemap.xml`,
    opts,
    allowed,
    skipped,
  );
  enqueue(sitemapLinks.map((url) => ({ url, text: "" })), 1, "home");

  // 3. Best-first, making sure one hiring-ish and one about-ish candidate get a turn early.
  const pick = (): Candidate | undefined => {
    const ordered = [...queue.values()].sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    const haveHiring = pages.some((p) => HIRINGISH.includes(p.kind));
    const haveAbout = pages.some((p) => p.kind === "about");
    return (
      (!haveHiring && ordered.find((c) => HIRINGISH.includes(c.kind))) ||
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
    const added = addPage(page.url, page.body, next.kind, next.score);
    enqueue(added.content.links, next.depth + 1, added.kind);
  }

  return {
    startUrl,
    reachable: true,
    pages,
    skipped,
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
): Promise<string[]> {
  const urls: string[] = [];
  const read = async (sitemapUrl: string, allowIndex: boolean) => {
    if (urls.length >= MAX_SITEMAP_URLS) return;
    if (!(await allowed(sitemapUrl))) return void skipped.push({ url: sitemapUrl, reason: "ROBOTS_DISALLOWED" });
    let body: string;
    try {
      body = (await fetchPage(sitemapUrl, { ...opts, allowXml: true })).body;
    } catch (e) {
      return void skipped.push({ url: sitemapUrl, reason: e instanceof RetrievalError ? e.code : "NETWORK" });
    }
    const $ = cheerio.load(body, { xml: true });
    const locs = (sel: string) => $(sel).map((_, el) => $(el).text().trim()).get().filter(Boolean);
    if ($("sitemapindex").length) {
      if (!allowIndex) return; // one level of index only
      for (const child of locs("sitemap > loc").slice(0, MAX_SITEMAP_FILES)) await read(child, false);
      return;
    }
    for (const loc of locs("url > loc")) {
      if (urls.length >= MAX_SITEMAP_URLS) break;
      try {
        urls.push(new URL(loc).href);
      } catch {
        // ignore malformed <loc>
      }
    }
  };
  for (const s of listed.length ? listed : [fallback]) await read(s, true);
  return urls;
}
