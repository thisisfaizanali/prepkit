import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompleteRequest } from "../../llm/client.ts";
import type { CrawlResult } from "../../retrieval/crawl.ts";
import { fetchPage, HostLimiter } from "../../retrieval/fetchPage.ts";
import { startFixtureSite, type FixtureSite } from "../../retrieval/fixtureSite.ts";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { extractAndResearch, resolveCompanyName } from "./research.ts";

const JD = "Backend Engineer\nRequirements:\n- TypeScript\n- PostgreSQL\n- Kafka";
const extraction = (company: string | null = null) => ({
  company,
  title: "Backend Engineer",
  seniority: "",
  location: "",
  responsibilities: [],
  requirements: [{ text: "TypeScript", kind: "technical", priority: "must", evidence: "TypeScript" }],
});

const crawlResult = (base: string, overrides: Partial<CrawlResult> = {}): CrawlResult => ({
  startUrl: `${base}/acme/`,
  reachable: true,
  pages: [{ url: `${base}/acme/`, title: "Acme | Home", siteName: "", description: "", text: "Acme builds anvils.", kind: "home", linkScore: 0, contentScore: 0 }],
  skipped: [],
  sitemaps: [],
  hiringPageFound: false,
  aboutPageFound: false,
  ...overrides,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("resolveCompanyName", () => {
  const home = (title: string, siteName = "") => ({ title, siteName });
  it("prefers the JD's company", () => {
    expect(resolveCompanyName("Acme Corp", home("Other | Site", "Other"), "https://acme.test")).toEqual({ name: "Acme Corp", source: "job_description" });
  });
  it("then og:site_name", () => {
    expect(resolveCompanyName(null, home("Whatever", "PostHog"), "https://posthog.com")).toEqual({ name: "PostHog", source: "site_name" });
  });
  it("then the first <title> segment", () => {
    expect(resolveCompanyName(null, home("GitLab – The DevSecOps Platform"), "https://about.gitlab.com")).toEqual({ name: "GitLab", source: "page_title" });
    expect(resolveCompanyName(null, home("Acme: anvils | Home"), "https://acme.test")).toEqual({ name: "Acme", source: "page_title" });
  });
  it("then the hostname label (www and TLD stripped)", () => {
    expect(resolveCompanyName(null, undefined, "https://www.stripe.com/jobs")).toEqual({ name: "Stripe", source: "hostname" });
    expect(resolveCompanyName(null, home("Home"), "about.gitlab.com")).toEqual({ name: "Gitlab", source: "hostname" });
  });
});

describe("extractAndResearch", () => {
  let site: FixtureSite;
  beforeAll(async () => (site = await startFixtureSite()));
  afterAll(() => site.close());

  it("runs the crawl in parallel with extraction", async () => {
    const started: string[] = [];
    const llmGate = deferred<void>();
    const crawlGate = deferred<void>();
    const llm = fakeLLM({ extract_requirements: extraction("Acme") });
    const deps = fakeDeps({
      llm: {
        complete: async (r: CompleteRequest) => {
          started.push("llm");
          await llmGate.promise;
          return llm.complete(r);
        },
      },
      crawl: async () => {
        started.push("crawl");
        await crawlGate.promise;
        return crawlResult(site.base);
      },
    });
    const run = extractAndResearch({ jd: JD, companyUrl: `${site.base}/acme/` }, deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(started.sort()).toEqual(["crawl", "llm"]); // both began before either finished
    llmGate.resolve();
    crawlGate.resolve();
    const { research } = await run;
    expect(research.companyName).toBe("Acme");
  });

  it("search-assisted discovery adds an in-scope hiring page, ignores out-of-scope, splits discussion", async () => {
    const deps = fakeDeps({
      llm: fakeLLM({ extract_requirements: extraction() }),
      crawl: async () => crawlResult(site.base),
      search: async () => ({
        queries: ['"Acme" interview process'],
        results: [
          { url: `${site.base}/globex/`, title: "Globex careers", content: "Acme vs Globex" },
          { url: `${site.base}/acme/pages/how-we-hire/`, title: "Joining Acme", content: "Acme hiring process" },
          { url: "https://forum.test/acme-interview", title: "My Acme interview", content: "Acme onsite" },
        ],
      }),
      fetchPage: (url) => fetchPage(url, { allowPrivate: true, limiter: new HostLimiter(2, 0) }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: `${site.base}/acme/` }, deps);
    expect(research.companyName).toBe("Acme");
    expect(research.companyNameSource).toBe("page_title");
    expect(research.hiringPages).toEqual([
      expect.objectContaining({ url: `${site.base}/acme/pages/how-we-hire/`, origin: "search" }),
    ]);
    expect(research.hiringPageFound).toBe(true);
    expect(site.hits).not.toContain("/globex/");
    expect(research.discussion.map((d) => d.url)).toEqual([`${site.base}/globex/`, "https://forum.test/acme-interview"]);
    expect(deps.events).toContainEqual(expect.objectContaining({ step: "search_hiring_discovery", status: "done" }));
    expect(research.warnings).toEqual(["No about page was found on the company site."]);
  });

  it("unreachable site: honest warnings, hostname fallback, no search-assisted fetches", async () => {
    const deps = fakeDeps({
      llm: fakeLLM({ extract_requirements: extraction() }),
      crawl: async () => ({ ...crawlResult(site.base), reachable: false, pages: [], error: { code: "UNREACHABLE", message: "down" } }),
      search: async () => ({ results: [], queries: [], skipped: "TAVILY_API_KEY not set" }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: "https://www.acme-anvils.com/" }, deps);
    expect(research).toMatchObject({ reachable: false, companyName: "Acme-anvils", companyNameSource: "hostname", crawlError: { code: "UNREACHABLE" } });
    expect(research.warnings).toEqual([
      "The company site (https://www.acme-anvils.com/) could not be reached (UNREACHABLE); company research is limited to the job description.",
      "No public interview discussion was found (TAVILY_API_KEY not set).",
    ]);
    expect(research.skipped).toContainEqual({ source: "search", reason: "TAVILY_API_KEY not set" });
  });
});
