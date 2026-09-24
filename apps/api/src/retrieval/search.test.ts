import { describe, expect, it } from "vitest";
import { searchInterviewDiscussion } from "./search.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(...responses: Response[]) {
  const bodies: any[] = [];
  return {
    bodies,
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return responses.shift() ?? json({ results: [] });
    }) as typeof fetch,
  };
}
const deps = (f: typeof fetch) => ({ apiKey: "test", fetch: f, sleep: async () => {} });
const input = { companyName: "Acme", companyUrl: "https://acme.test", roleTitle: "Backend Engineer" };

describe("searchInterviewDiscussion", () => {
  it("builds two queries and keeps only results mentioning the company, deduped by URL", async () => {
    const f = fakeFetch(
      json({
        results: [
          { url: "https://forum.test/1", title: "Acme interview experience", content: "..." },
          { url: "https://forum.test/2", title: "Generic interview tips", content: "nothing relevant" },
        ],
      }),
      json({
        results: [
          { url: "https://forum.test/1", title: "dupe", content: "acme again" },
          { url: "https://blog.test/3", title: "Backend questions", content: "Asked at ACME: design a queue" },
        ],
      }),
    );
    const r = await searchInterviewDiscussion(input, deps(f.fetch));
    expect(r.queries).toEqual(['"Acme" interview process', '"Acme" Backend Engineer interview questions']);
    expect(r.results.map((x) => x.url)).toEqual(["https://forum.test/1", "https://blog.test/3"]);
    expect(r.skipped).toBeUndefined();
    expect(f.bodies[0]).toEqual({ query: '"Acme" interview process', search_depth: "basic", max_results: 5 });
  });

  it("no key → skipped", async () => {
    expect(await searchInterviewDiscussion(input, { apiKey: "" })).toMatchObject({ results: [], skipped: "TAVILY_API_KEY not set" });
  });

  it("generic company name → skipped with reason", async () => {
    const r = await searchInterviewDiscussion({ ...input, companyName: "The Company" }, deps(fakeFetch().fetch));
    expect(r.results).toEqual([]);
    expect(r.skipped).toMatch(/generic/);
  });

  it("retries 429 then succeeds; persistent failure → empty results with reason, no throw", async () => {
    const ok = fakeFetch(json({}, 429), json({ results: [{ url: "https://x.test", title: "Acme", content: "" }] }));
    expect((await searchInterviewDiscussion({ ...input, roleTitle: undefined }, deps(ok.fetch))).results).toHaveLength(1);

    const bad = fakeFetch(json({}, 503), json({}, 503), json({}, 503));
    const r = await searchInterviewDiscussion({ ...input, roleTitle: undefined }, deps(bad.fetch));
    expect(r.results).toEqual([]);
    expect(r.skipped).toMatch(/HTTP 503/);
    expect(bad.bodies).toHaveLength(3);
  });

  it("network error → no throw", async () => {
    const r = await searchInterviewDiscussion(input, deps((async () => { throw new TypeError("fetch failed"); }) as typeof fetch));
    expect(r.results).toEqual([]);
    expect(r.skipped).toMatch(/fetch failed/);
  });
});
