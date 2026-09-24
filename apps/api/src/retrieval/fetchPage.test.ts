import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractContent } from "./clean.ts";
import { fetchPage, HostLimiter, type FetchOptions } from "./fetchPage.ts";
import { closedPort, startFixtureSite, type FixtureSite } from "./fixtureSite.ts";
import { assertFetchable } from "./urlGuard.ts";

let site: FixtureSite;
beforeAll(async () => (site = await startFixtureSite()));
afterAll(() => site.close());

const sleeps: number[] = [];
const opts = (): FetchOptions => ({
  allowPrivate: true,
  limiter: new HostLimiter(2, 0),
  sleep: async (ms) => void sleeps.push(ms),
  random: () => 0,
});

describe("fetchPage", () => {
  it("fetches HTML with final url, status and content type", async () => {
    const p = await fetchPage(`${site.base}/acme/`, opts());
    expect(p).toMatchObject({ url: `${site.base}/acme/`, status: 200, contentType: "text/html" });
    expect(p.body).toContain("Acme builds anvils");
  });

  it("follows relative redirects and reports the final url", async () => {
    expect((await fetchPage(`${site.base}/acme/go`, opts())).url).toBe(`${site.base}/acme/about/`);
  });

  it("runs the guard on every redirect hop (metadata IP blocked)", async () => {
    const guard = (u: URL) => assertFetchable(u, { allowPrivate: u.hostname === "127.0.0.1" });
    await expect(fetchPage(`${site.base}/acme/r`, { ...opts(), guard })).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("stops reading at 2 MB (no content-length) and returns the truncated page, links still extractable", async () => {
    const p = await fetchPage(`${site.base}/acme/huge`, opts());
    expect(p.truncated).toBe(true);
    expect(p.body.length).toBe(2 * 1024 * 1024);
    expect(extractContent(p.body, p.url).links).toEqual([{ url: `${site.base}/acme/about/`, text: "About us" }]);
    expect((await fetchPage(`${site.base}/acme/`, opts())).truncated).toBe(false);
  });

  it("allows 5 MB when allowXml", async () => {
    expect((await fetchPage(`${site.base}/acme/huge`, { ...opts(), allowXml: true })).truncated).toBe(false);
  });

  it("rejects binary content → UNSUPPORTED_CONTENT_TYPE", async () => {
    await expect(fetchPage(`${site.base}/acme/binary`, opts())).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
  });

  it("xml only when allowXml", async () => {
    await expect(fetchPage(`${site.base}/acme/sitemap.xml`, opts())).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
    expect((await fetchPage(`${site.base}/acme/sitemap.xml`, { ...opts(), allowXml: true })).contentType).toBe("application/xml");
  });

  it("404 → HTTP_404 without retry", async () => {
    const before = site.hits.filter((h) => h === "/acme/nope").length;
    await expect(fetchPage(`${site.base}/acme/nope`, opts())).rejects.toMatchObject({ code: "HTTP_404" });
    expect(site.hits.filter((h) => h === "/acme/nope").length - before).toBe(1);
  });

  it("retries 503 and then succeeds", async () => {
    sleeps.length = 0;
    expect((await fetchPage(`${site.base}/acme/flaky`, opts())).body).toContain("ok now");
    expect(sleeps).toEqual([500, 1000]);
  });

  it("closed port → UNREACHABLE after retries", async () => {
    const port = await closedPort();
    await expect(fetchPage(`http://127.0.0.1:${port}/`, opts())).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});

describe("HostLimiter", () => {
  it("spaces request starts per host and caps concurrency at 2", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = new HostLimiter(2, 500, () => clock, async (ms) => {
      waits.push(ms);
      clock += ms;
    });
    let active = 0;
    let peak = 0;
    const job = () =>
      limiter.run("h", async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([job(), job(), job(), limiter.run("other", async () => {})]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(waits.filter((w) => w > 0).length).toBeGreaterThanOrEqual(2); // 2nd and 3rd starts on "h" were spaced
  });

  it("crawl delay raises the gap, capped at 5s", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = new HostLimiter(2, 500, () => clock, async (ms) => void waits.push(ms));
    limiter.setCrawlDelay("h", 30_000);
    await limiter.run("h", async () => {});
    await limiter.run("h", async () => {});
    expect(waits).toEqual([5000]);
  });
});
