import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompany, type CrawlOptions, type CrawlResult } from "./crawl.ts";
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
    expect(page("/acme/handbook/hiring/")).toMatchObject({ kind: "hiring" });
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
