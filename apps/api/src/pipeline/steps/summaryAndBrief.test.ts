import { describe, expect, it } from "vitest";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { companyBrief, findCompanyParagraph } from "./companyBrief.ts";
import type { SitePage } from "./research.ts";
import { summarizeHiringProcess } from "./summarizeHiringProcess.ts";

const hiringPage = { url: "https://acme.test/how-we-hire", title: "How we hire", text: "Recruiter screen, take-home, onsite.", contentScore: 3, origin: "crawl" as const };
const post = { url: "https://forum.test/acme", title: "Acme interview", content: "Had a system design round at Acme." };

describe("summarizeHiringProcess", () => {
  it("returns null with zero LLM calls when nothing was found", async () => {
    const llm = fakeLLM({});
    const deps = fakeDeps({ llm });
    expect(await summarizeHiringProcess({ hiringPages: [], discussion: [], companyName: "Acme" }, deps)).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(deps.events).toEqual([expect.objectContaining({ step: "summarize_hiring_process", status: "skipped" })]);
  });

  it("maps used source numbers to URLs in code, ignoring invalid ones", async () => {
    const llm = fakeLLM({
      summarize_hiring_process: {
        stages: [{ name: "Recruiter screen", description: "30 min" }],
        signals: { take_home: true, system_design: true },
        notes: "",
        used_sources: [2, 1, 1, 7],
      },
    });
    const s = await summarizeHiringProcess({ hiringPages: [hiringPage], discussion: [post], companyName: "Acme" }, fakeDeps({ llm }));
    expect(s!.sources).toEqual([hiringPage.url, post.url]);
    expect(s!.signals).toEqual({ take_home: true, system_design: true, pair_programming: false, live_coding: false, behavioural: false, culture_values: false });
    expect(llm.calls[0].user).toContain('source="source 1 (official): https://acme.test/how-we-hire"');
    expect(llm.calls[0].user).toContain('source="source 2 (third_party): https://forum.test/acme"');
  });
});

describe("findCompanyParagraph", () => {
  it("finds 'About us' and stops at the next heading; ignores 'About the role'", () => {
    const jd = "About the role\nYou will build APIs for merchants.\n\nAbout us\nAcme makes anvils for cartoon coyotes worldwide.\nWe are 40 people.\n\nRequirements:\n- Go";
    expect(findCompanyParagraph(jd)).toBe("Acme makes anvils for cartoon coyotes worldwide.\nWe are 40 people.");
    expect(findCompanyParagraph("About the role\nYou will build APIs for merchants and partners.")).toBeUndefined();
  });
});

describe("companyBrief", () => {
  const unreachable = { pages: [], reachable: false, crawlError: { code: "UNREACHABLE", message: "connection refused" }, companyName: "Acme" };

  it("unreachable site, no company paragraph in the JD → honest text, zero LLM calls", async () => {
    const llm = fakeLLM({});
    const b = await companyBrief({ research: unreachable, jd: "Backend engineer.\nMust know Go.", companyUrl: "http://localhost:1/" }, fakeDeps({ llm }));
    expect(llm.calls).toHaveLength(0);
    expect(b.summary).toContain("could not be retrieved (UNREACHABLE");
    expect(b.summary).toContain("Nothing here is guessed");
    expect(b).toMatchObject({ what_they_do: "Not available — no information could be retrieved.", sources: [], meta: { origin: "generated", edited: false, pinned: false } });
  });

  it("unreachable site but the JD describes the company → one JD-only call, sources ['job description']", async () => {
    const llm = fakeLLM({ company_brief_from_jd: { what_they_do: "According to the job description, Acme makes anvils." } });
    const jd = "About us\nAcme makes anvils for cartoon coyotes worldwide.\n\nRequirements:\n- Go";
    const b = await companyBrief({ research: unreachable, jd, companyUrl: "http://localhost:1/" }, fakeDeps({ llm }));
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].user).not.toContain("Requirements");
    expect(b).toMatchObject({ what_they_do: "According to the job description, Acme makes anvils.", sources: ["job description"] });
  });

  it("usable site text → one call; sources are the pages passed in, set in code", async () => {
    const page = (kind: SitePage["kind"], url: string): SitePage => ({ kind, url, title: `${kind} page`, description: "", text: "Acme makes anvils. ".repeat(20) });
    const llm = fakeLLM({ company_brief: { summary: "Acme makes anvils.", what_they_do: "Anvils.", sources: ["https://invented.test"] } });
    const research = { pages: [page("about", "https://acme.test/about"), page("home", "https://acme.test/")], reachable: true, companyName: "Acme" };
    const b = await companyBrief({ research, jd: "Go developer", companyUrl: "https://acme.test" }, fakeDeps({ llm }));
    expect(b.sources).toEqual(["https://acme.test/", "https://acme.test/about"]); // home first, model's URLs ignored
    expect(llm.calls[0].user).toContain('<untrusted_content source="home page: https://acme.test/">');
  });
});
