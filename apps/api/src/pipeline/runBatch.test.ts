import { BatchOutputSchema, type Kit } from "@prepkit/shared";
import { describe, expect, it } from "vitest";
import { fakeDeps, scriptedLLM } from "./fakes.ts";
import { runBatch } from "./runBatch.ts";
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

describe("runBatch", () => {
  const unreachable = async (url: string) => ({ startUrl: url, reachable: false, error: { code: "NETWORK", message: "down" }, pages: [], skipped: [], sitemaps: [], hiringPageFound: false, aboutPageFound: false });

  it("one case throws → 3 entries, one failed with a code, others ok; invalid case → INVALID_INPUT; days 1 and 60 honoured", async () => {
    const deps = fakeDeps({ llm: scriptedLLM(fixed()), crawl: unreachable });
    const updates: number[] = [];
    const out = await runBatch(
      [
        { id: "a", jd: JD, company_url: "https://a.test", days: 1 },
        { id: "boom", jd: JD, company_url: "https://b.test", days: 2 },
        { id: "c", jd: JD, company_url: "https://c.test", days: 60 },
        { id: "bad", jd: JD, days: 3 },
      ],
      async (c) => {
        if (c.id === "boom") throw new Error("kaboom");
        return (await runPipeline(c, deps)).kit as Kit;
      },
      { concurrency: 2, onUpdate: (o) => void updates.push(o.kits.length) },
    );
    expect(BatchOutputSchema.safeParse(out).success).toBe(true);
    expect(out.kits.map((k) => [k.id, k.status, k.error?.code ?? null])).toEqual([
      ["a", "ok", null],
      ["boom", "failed", "INTERNAL"],
      ["c", "ok", null],
      ["bad", "failed", "INVALID_INPUT"],
    ]);
    expect(out.kits[0].kit!.schedule.days).toHaveLength(1);
    expect(out.kits[2].kit!.schedule.days).toHaveLength(60);
    expect(updates.sort()).toEqual([1, 2, 3, 4]); // written after every case
  });

  it("a PipelineError keeps its code", async () => {
    const out = await runBatch([{ id: "x", jd: "jd", company_url: "u", days: 1 }], async () => {
      throw new PipelineError("TIMEOUT", "too slow");
    });
    expect(out.kits[0]).toEqual({ id: "x", status: "failed", kit: null, error: { code: "TIMEOUT", message: "too slow" } });
  });
});
