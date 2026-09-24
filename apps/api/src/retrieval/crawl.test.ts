import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompany, makeScope, type CrawlOptions, type CrawlResult } from "./crawl.ts";
import { HostLimiter } from "./fetchPage.ts";
import { closedPort, startFixtureSite, type FixtureSite } from "./fixtureSite.ts";
import { scoreLink } from "./rankLinks.ts";

let site: FixtureSite;
let result: CrawlResult;
const opts = (): CrawlOptions => ({ allowPrivate: true, limiter: new HostLimiter(2, 0), sleep: async () => {} });

beforeAll(async () => {
  site = await startFixtureSite();
  result = await crawlCompany(`${site.base}/acme/`, opts());
});
afterAll(() => site.close());

const page = (path: string) => result.pages.find((p) => p.url === `${site.base}${path}`);

describe("crawlCompany (fixture site)", () => {
  it("is reachable and starts with the home page", () => {
    expect(result.reachable).toBe(true);
    expect(result.pages[0]).toMatchObject({ url: `${site.base}/acme/`, kind: "home" });
  });

  it("classifies a plainly-named page as hiring from its content", () => {
    expect(page("/acme/company/life/")).toMatchObject({ kind: "hiring" });
    expect(page("/acme/company/life/")!.contentScore).toBeGreaterThanOrEqual(3);
    expect(result.hiringPageFound).toBe(true);
    expect(result.aboutPageFound).toBe(true);
  });

  it("discovers the sitemap-only handbook page", () => {
    expect(page("/acme/handbook/hiring/")).toBeDefined();
    expect(result.sitemaps).toEqual([{ url: `${site.base}/acme/sitemap.xml`, source: "fallback", urls: 2, kept: 2 }]);
  });

  it("a hiring-looking URL without hiring content is not classified hiring", () => {
    // /acme/blog/interview-with-our-ceo/ looks like hiring by URL; its content is a CEO Q&A.
    expect(page("/acme/blog/interview-with-our-ceo/")).toBeDefined();
    expect(page("/acme/blog/interview-with-our-ceo/")!.kind).not.toBe("hiring");
    // The handbook page mentions only one hiring phrase → falls back from hiring to about.
    expect(page("/acme/handbook/hiring/")!.kind).toBe("about");
    expect(result.pages.filter((p) => p.kind === "hiring").map((p) => p.url)).toEqual([`${site.base}/acme/company/life/`]);
  });

  it("never fetches out-of-scope /globex/", () => {
    expect(site.hits).not.toContain("/globex/");
  });

  it("records robots-disallowed and 404 pages in skipped", () => {
    expect(result.skipped).toContainEqual({ url: `${site.base}/acme/internal/`, reason: "ROBOTS_DISALLOWED" });
    expect(site.hits).not.toContain("/acme/internal/");
    expect(result.skipped).toContainEqual({ url: `${site.base}/acme/team/`, reason: "HTTP_404" });
  });

  it("ranks privacy below careers and about, and never fetches it or the pdf", () => {
    const privacy = scoreLink({ url: `${site.base}/acme/legal/privacy`, text: "Privacy" }).score;
    expect(privacy).toBeLessThan(scoreLink({ url: `${site.base}/acme/join/`, text: "Careers" }).score);
    expect(privacy).toBeLessThan(scoreLink({ url: `${site.base}/acme/about/`, text: "About us" }).score);
    expect(site.hits).not.toContain("/acme/legal/privacy");
    expect(site.hits).not.toContain("/acme/docs/brochure.pdf");
  });

  it("respects maxPages (fetch attempts, excluding robots/sitemaps)", async () => {
    const small = await crawlCompany(`${site.base}/acme/`, { ...opts(), maxPages: 3 });
    const failedFetches = small.skipped.filter((s) => s.reason !== "ROBOTS_DISALLOWED").length;
    expect(small.pages.length + failedFetches).toBeLessThanOrEqual(3);
    expect(small.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic", async () => {
    const again = await crawlCompany(`${site.base}/acme/`, opts());
    expect(again.pages.map((p) => p.url)).toEqual(result.pages.map((p) => p.url));
  });

  it("unreachable start → reachable:false with an error code, no throw", async () => {
    const r = await crawlCompany(`http://127.0.0.1:${await closedPort()}/`, opts());
    expect(r.reachable).toBe(false);
    expect(r.error?.code).toBe("UNREACHABLE");
    expect(r.pages).toEqual([]);
  });

  it("invalid and blocked starts → reachable:false", async () => {
    expect((await crawlCompany("ftp://x", opts())).error?.code).toBe("INVALID_URL");
    expect((await crawlCompany("http://169.254.169.254/", { ...opts(), allowPrivate: false })).error?.code).toBe("BLOCKED_URL");
  });
});

describe("early hiring reservation", () => {
  it("a hiring-kind sitemap URL (path-only score) is fetched before higher-scoring about/careers anchor links", () => {
    const order = result.pages.map((p) => p.url.slice(site.base.length));
    const handbook = order.indexOf("/acme/handbook/hiring/");
    expect(handbook).toBeGreaterThan(0);
    expect(handbook).toBeLessThanOrEqual(2); // one of the two reserved picks right after home
    const handbookScore = result.pages[handbook].linkScore;
    for (const path of ["/acme/about/", "/acme/join/"]) {
      const i = order.indexOf(path);
      expect(result.pages[i].linkScore).toBeGreaterThan(handbookScore);
      expect(i).toBeGreaterThan(handbook);
    }
  });
});

describe("sitemap dedupe", () => {
  it("a sitemap referenced twice is fetched and parsed once", async () => {
    const dup = await startFixtureSite({ dupSitemaps: true });
    try {
      const r = await crawlCompany(`${dup.base}/acme/`, opts());
      expect(dup.hits.filter((h) => h === "/acme/sitemap.xml")).toHaveLength(1);
      expect(r.sitemaps.map((s) => [s.url.slice(dup.base.length), s.source, s.error])).toEqual([
        ["/acme/sitemap-index.xml", "robots", undefined],
        ["/acme/sitemap.xml", "index", undefined],
        ["/acme/sitemap.xml", "robots", "duplicate"],
      ]);
    } finally {
      await dup.close();
    }
  });
});

describe("sitemap ranking", () => {
  it("ranks all sitemap URLs before capping: hiring URL #599 of 600 is queued and fetched", async () => {
    const big = await startFixtureSite({ bigSitemap: true });
    try {
      const r = await crawlCompany(`${big.base}/acme/`, opts());
      expect(r.sitemaps).toEqual([{ url: `${big.base}/acme/sitemap.xml`, source: "fallback", urls: 600, kept: 50 }]);
      expect(big.hits).toContain("/acme/pages/how-we-hire/");
      expect(r.pages.find((p) => p.url.endsWith("/acme/pages/how-we-hire/"))).toMatchObject({ kind: "hiring" });
      expect(r.pages.length).toBeLessThanOrEqual(10);
    } finally {
      await big.close();
    }
  });
});

describe("makeScope", () => {
  const scope = (start: string, url: string) => makeScope(new URL(start))(new URL(url));

  it("subdomain start: sibling subdomains in, apex out", () => {
    expect(scope("https://about.gitlab.com/", "https://handbook.gitlab.com/handbook/hiring/")).toBe(true);
    expect(scope("https://about.gitlab.com/", "https://gitlab.com/gitlab-org/gitlab")).toBe(false);
    expect(scope("https://about.gitlab.com/", "https://about.gitlab.com/jobs/")).toBe(true);
  });

  it("apex or www start: www and apex both in", () => {
    expect(scope("https://posthog.com/", "https://www.posthog.com/careers")).toBe(true);
    expect(scope("https://www.posthog.com/", "https://posthog.com/careers")).toBe(true);
  });

  it("other domains and path-scoped / IP starts stay narrow", () => {
    expect(scope("https://posthog.com/", "https://evil-posthog.com/")).toBe(false);
    expect(scope("https://acme.test/acme/", "https://acme.test/globex/")).toBe(false);
    expect(scope("https://acme.test/acme/", "https://jobs.acme.test/")).toBe(false);
    expect(scope("http://127.0.0.1:8080/", "http://127.0.0.2:8080/")).toBe(false);
  });
});
