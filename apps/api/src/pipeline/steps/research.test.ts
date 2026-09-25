import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompleteRequest } from "../../llm/client.ts";
import type { CrawlResult } from "../../retrieval/crawl.ts";
import { fetchPage, HostLimiter } from "../../retrieval/fetchPage.ts";
import { startFixtureSite, type FixtureSite } from "../../retrieval/fixtureSite.ts";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { extractAndResearch, resolveCompanyName } from "./research.ts";
import { summarizeHiringProcess } from "./summarizeHiringProcess.ts";

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
  it("localhost and IP literals → unknown (empty), never 'Localhost'", () => {
    for (const url of ["http://localhost:1/", "http://127.0.0.1:8080/acme/", "http://[::1]/", "http://app.localhost/"]) {
      expect(resolveCompanyName(null, undefined, url)).toEqual({ name: "", source: "hostname" });
    }
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
          { url: `${site.base}/globex/`, title: "Globex careers", content: "Acme vs Globex", attribution: "name" },
          { url: `${site.base}/acme/pages/how-we-hire/`, title: "Joining Acme", content: "Acme hiring process", attribution: "name" },
          { url: "https://forum.test/acme-interview", title: "My Acme interview", content: "Acme onsite", attribution: "name" },
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
    // 127.0.0.1 company URL + name-only results → kept for visibility, excluded from the summary.
    expect(research.discussion.every((d) => d.attribution === "name" && !d.usedForSummary)).toBe(true);
    expect(research.warnings).toEqual([
      "No about page was found on the company site.",
      "Public discussion matched only by company name; not used because it can't be confirmed to be about this company.",
    ]);
  });

  it("local company URL + name-only results → summarizeHiringProcess receives none of them", async () => {
    const llm = fakeLLM({ extract_requirements: extraction("Acme") });
    const deps = fakeDeps({
      llm,
      crawl: async () => crawlResult(site.base),
      search: async () => ({
        queries: ['"Acme" interview process'],
        results: [{ url: "https://forum.test/acme", title: "Acme interview", content: "Acme onsite, take-home", attribution: "name" }],
      }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: `${site.base}/acme/` }, deps);
    expect(research.discussion).toHaveLength(1);
    expect(await summarizeHiringProcess(research, deps)).toBeNull();
    expect(llm.calls.map((c) => c.label)).toEqual(["extract_requirements"]); // no summary call
  });

  it("public site: name-only discussion is still used for the summary", async () => {
    const deps = fakeDeps({
      llm: fakeLLM({ extract_requirements: extraction("Acme") }),
      crawl: async () => ({ ...crawlResult("https://acme.test"), startUrl: "https://acme.test/" }),
      search: async () => ({
        queries: ['"Acme" interview process'],
        results: [{ url: "https://forum.test/acme", title: "Acme interview", content: "Acme onsite", attribution: "name" }],
      }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: "https://acme.test/" }, deps);
    expect(research.discussion[0].usedForSummary).toBe(true);
  });

  it("unreachable site, name only from the hostname: no search call, honest warnings", async () => {
    let searched = false;
    const deps = fakeDeps({
      llm: fakeLLM({ extract_requirements: extraction() }),
      crawl: async () => ({ ...crawlResult(site.base), reachable: false, pages: [], error: { code: "UNREACHABLE", message: "down" } }),
      search: async () => ((searched = true), { results: [], queries: [] }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: "https://www.acme-anvils.com/" }, deps);
    expect(searched).toBe(false);
    expect(research).toMatchObject({ reachable: false, companyName: "Acme-anvils", companyNameSource: "hostname", crawlError: { code: "UNREACHABLE" } });
    expect(research.warnings).toEqual([
      "The company site (https://www.acme-anvils.com/) could not be reached (UNREACHABLE); company research is limited to the job description.",
      "The company name could not be determined, so public interview discussion was not searched (to avoid attributing results to the wrong organisation).",
    ]);
    expect(research.skipped).toContainEqual({
      source: "search",
      reason: "company name unknown — public search skipped to avoid attributing results to the wrong organisation",
    });
    expect(deps.events).toContainEqual(expect.objectContaining({ step: "search", status: "skipped" }));
  });

  it("hostname fallback on localhost → name unknown, no search call", async () => {
    let searched = false;
    const deps = fakeDeps({
      llm: fakeLLM({ extract_requirements: extraction() }),
      crawl: async () => ({ ...crawlResult(site.base), reachable: false, pages: [], error: { code: "UNREACHABLE", message: "down" } }),
      search: async () => ((searched = true), { results: [], queries: [] }),
    });
    const { research } = await extractAndResearch({ jd: JD, companyUrl: "http://localhost:1/" }, deps);
    expect(research.companyName).toBe("");
    expect(searched).toBe(false);
  });
});
