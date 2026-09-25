import { checkCoverage, validateKit, type Kit } from "@prepkit/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LLMError } from "../llm/client.ts";
import { crawlCompany } from "../retrieval/crawl.ts";
import { HostLimiter } from "../retrieval/fetchPage.ts";
import { closedPort, startFixtureSite, type FixtureSite } from "../retrieval/fixtureSite.ts";
import { fakeDeps, scriptedLLM } from "./fakes.ts";
import { PipelineError, runPipeline } from "./runPipeline.ts";

const JD = `Senior Backend Engineer
Requirements:
- 5+ years of TypeScript
- Experience mentoring engineers
Nice to have:
- Kafka`;

const noSignals = { take_home: false, system_design: false, pair_programming: false, live_coding: false, behavioural: false, culture_values: false };
const fixed = ({ seniority = "senior", title = "Senior Backend Engineer", company = "Acme" as string | null, signals = {} } = {}) => ({
  extract_requirements: {
    company,
    title,
    seniority,
    location: "Remote",
    responsibilities: ["Build APIs"],
    requirements: [
      { text: "TypeScript", kind: "technical", priority: "must", evidence: "5+ years of TypeScript" },
      { text: "Mentoring", kind: "behavioural", priority: "must", evidence: "Experience mentoring engineers" },
      { text: "Kafka", kind: "technical", priority: "nice", evidence: "Kafka" },
    ],
  },
  summarize_hiring_process: { stages: [{ name: "Take-home", description: "" }, { name: "System design", description: "" }], signals: { ...noSignals, ...signals }, notes: "" },
  company_brief: { summary: "Acme makes anvils.", what_they_do: "Anvils." },
});

describe("runPipeline", () => {
  let site: FixtureSite;
  beforeAll(async () => (site = await startFixtureSite()));
  afterAll(() => site.close());
  const crawl = (url: string) => crawlCompany(url, { allowPrivate: true, limiter: new HostLimiter(4, 0) });

  it("e2e on the fixture site: valid kit, requested days, every must covered, 4 distinct category prompts", async () => {
    const llm = scriptedLLM(fixed({ signals: { system_design: true, take_home: true } }));
    const { kit, trace } = await runPipeline({ jd: JD, company_url: `${site.base}/acme/`, days: 5 }, fakeDeps({ llm, crawl }));
    const k = kit as Kit & { research: { hiring_page_found: boolean }; pipeline_trace: unknown[] };

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(k.schedule.days).toHaveLength(5);
    expect(checkCoverage(k.role.requirements, k.questions).uncovered_must_ids).toEqual([]);
    expect(k.coverage).toEqual({ uncovered_requirement_ids: [], passes: 1 });
    expect(k.research.hiring_page_found).toBe(true);
    expect(k.source).toMatchObject({ company: "Acme", company_url: `${site.base}/acme/`, jd_chars: JD.length, role: "Senior Backend Engineer" });
    expect(k.source.pages_used).toContain(`${site.base}/acme/company/life/`);
    expect(k.role.requirements[0]).toMatchObject({ id: "r1", evidence: "5+ years of TypeScript" });
    expect(k.pipeline_trace).toBe(trace);

    const systemByCategory = new Map(llm.calls.filter((c) => c.label.startsWith("questions:")).map((c) => [c.label, c.system]));
    expect([...systemByCategory.keys()].sort()).toEqual(["questions:behavioural", "questions:company-fit", "questions:system-design", "questions:technical"]);
    expect(new Set(systemByCategory.values()).size).toBe(4);
    const technicalUser = llm.calls.find((c) => c.label === "questions:technical")!.user;
    expect(technicalUser).toContain("take-home assignment");
  });

  it("system_design signal present vs absent → 3 vs 0 system-design questions (non-senior role)", async () => {
    const count = async (system_design: boolean) => {
      const llm = scriptedLLM(fixed({ seniority: "mid", title: "Backend Engineer", signals: { system_design } }));
      const { kit } = await runPipeline({ jd: JD, company_url: `${site.base}/acme/`, days: 3 }, fakeDeps({ llm, crawl }));
      return (kit as Kit).questions.filter((q) => q.category === "system-design").length;
    };
    expect(await count(true)).toBe(3);
    expect(await count(false)).toBe(0);
  });

  it("unreachable site → ok kit with honest brief + warnings, company Unknown, no company-fit questions", async () => {
    const llm = scriptedLLM(fixed({ company: null }));
    const url = `http://127.0.0.1:${await closedPort()}/`;
    const { kit } = await runPipeline({ jd: JD, company_url: url, days: 2 }, fakeDeps({ llm, crawl }));
    const k = kit as Kit;
    expect(validateKit(kit).ok).toBe(true);
    expect(k.source.company).toBe("Unknown");
    expect(k.company_brief.sources).toEqual([]);
    expect(k.company_brief.summary).toContain("could not be retrieved");
    expect(k.warnings!.some((w) => w.includes("could not be reached"))).toBe(true);
    expect(k.questions.some((q) => q.category === "company-fit")).toBe(false);
    expect(llm.calls.map((c) => c.label)).not.toContain("company_brief");
  });

  it("invalid input → INVALID_INPUT; extraction LLM failure → fatal with the LLM code", async () => {
    const deps = fakeDeps({ llm: scriptedLLM({}), crawl });
    for (const bad of [{ jd: "  ", company_url: "x", days: 3 }, { jd: "x", company_url: "x", days: 91 }, { jd: "x", company_url: "x", days: 1.5 }]) {
      await expect(runPipeline(bad, deps)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const down = { complete: async () => Promise.reject(new LLMError("LLM_RATE_LIMITED", "quota")) };
    await expect(runPipeline({ jd: JD, company_url: `${site.base}/acme/`, days: 1 }, fakeDeps({ llm: down, crawl }))).rejects.toMatchObject({
      name: "PipelineError",
      code: "LLM_RATE_LIMITED",
    });
  });

  it("timeout → PipelineError TIMEOUT", async () => {
    const hang = { complete: () => new Promise<never>(() => {}) };
    const e = await runPipeline({ jd: JD, company_url: `${site.base}/acme/`, days: 1 }, fakeDeps({ llm: hang, crawl }), { timeoutMs: 50 }).catch((x) => x);
    expect(e).toBeInstanceOf(PipelineError);
    expect(e.code).toBe("TIMEOUT");
  });
});
