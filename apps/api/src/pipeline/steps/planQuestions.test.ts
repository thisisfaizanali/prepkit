import type { Requirement } from "@prepkit/shared";
import { describe, expect, it } from "vitest";
import { planQuestionJobs } from "./planQuestions.ts";

const r = (id: string, kind: Requirement["kind"], priority: Requirement["priority"] = "must"): Requirement => ({ id, text: id, kind, priority });
const noSignals = { take_home: false, system_design: false, pair_programming: false, live_coding: false, behavioural: false, culture_values: false };
const hiring = (signals: Partial<typeof noSignals> = {}) => ({ stages: [{ name: "Screen", description: "" }, { name: "Onsite", description: "" }], signals: { ...noSignals, ...signals } });
const REQS = [r("r1", "technical"), r("r2", "technical", "nice"), r("r3", "domain"), r("r4", "behavioural"), r("r5", "behavioural", "nice")];
const job = (jobs: ReturnType<typeof planQuestionJobs>, category: string) => jobs.filter((j) => j.category === category);

describe("planQuestionJobs", () => {
  it("targets: 2 per must + 1 per nice; technical takes technical + domain", () => {
    const jobs = planQuestionJobs(REQS, null, "", true);
    expect(job(jobs, "technical")).toEqual([{ category: "technical", requirementIds: ["r1", "r2", "r3"], target: 5, guidance: [] }]);
    expect(job(jobs, "behavioural")[0]).toMatchObject({ requirementIds: ["r4", "r5"], target: 3 });
    expect(job(jobs, "company-fit")[0]).toMatchObject({ requirementIds: ["r3", "r4", "r5"], target: 2 });
  });

  it("system_design signal → target 3 with round guidance; junior with no signal → no system-design job", () => {
    const withSignal = job(planQuestionJobs(REQS, hiring({ system_design: true }), "junior", true), "system-design");
    expect(withSignal).toHaveLength(1);
    expect(withSignal[0]).toMatchObject({ target: 3, requirementIds: ["r1"] });
    expect(withSignal[0].guidance).toContain("Mirror a dedicated system design round.");
    expect(job(planQuestionJobs(REQS, hiring(), "junior", true), "system-design")).toEqual([]);
    expect(job(planQuestionJobs(REQS, null, "Staff Engineer", true), "system-design")[0].target).toBe(1);
  });

  it("take_home adds guidance to the technical job; live coding adds hands-on prompts; stages go to every job", () => {
    const jobs = planQuestionJobs(REQS, hiring({ take_home: true, live_coding: true }), "", true);
    expect(job(jobs, "technical")[0].guidance).toEqual([
      "Include one question on how you'd approach a take-home assignment for this role.",
      "Include hands-on coding exercise prompts.",
      "The company's interview stages are: Screen → Onsite.",
    ]);
    expect(jobs.every((j) => j.guidance.includes("The company's interview stages are: Screen → Onsite."))).toBe(true);
  });

  it("unknown company (brief not real) → no company-fit job; culture_values → 3", () => {
    expect(job(planQuestionJobs(REQS, null, "", false), "company-fit")).toEqual([]);
    expect(job(planQuestionJobs(REQS, hiring({ culture_values: true }), "", true), "company-fit")[0].target).toBe(3);
  });

  it("batches technical requirements at 6; take-home guidance only on the first batch", () => {
    const many = Array.from({ length: 8 }, (_, i) => r(`r${i + 1}`, "technical"));
    const jobs = job(planQuestionJobs(many, hiring({ take_home: true }), "", false), "technical");
    expect(jobs.map((j) => [j.requirementIds.length, j.target])).toEqual([[6, 12], [2, 4]]);
    expect(jobs[1].guidance.some((g) => g.includes("take-home"))).toBe(false);
  });

  it("no behavioural requirements: behavioural signal → one job with no ids, target 2; else none", () => {
    const tech = [r("r1", "technical")];
    expect(job(planQuestionJobs(tech, hiring({ behavioural: true }), "", false), "behavioural")).toEqual([
      expect.objectContaining({ requirementIds: [], target: 2 }),
    ]);
    expect(job(planQuestionJobs(tech, hiring(), "", false), "behavioural")).toEqual([]);
  });
});
