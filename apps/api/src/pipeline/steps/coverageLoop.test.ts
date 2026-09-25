import { describe, expect, it } from "vitest";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { coverageLoop, MAX_PASSES } from "./coverageLoop.ts";
import { numberQuestions, QUESTION_META, type QuestionContext } from "./generateQuestions.ts";
import type { KitRequirement } from "./extractRequirements.ts";

const req = (id: string, kind: KitRequirement["kind"], priority: KitRequirement["priority"] = "must"): KitRequirement => ({ id, text: `Skill ${id}`, kind, priority, evidence: id });
const ctx = (requirements: KitRequirement[]): QuestionContext => ({ requirements, role: { title: "Engineer", seniority: "" }, hiring: null, brief: null, companyName: "" });
const draft = (ids: string[]) => ({ requirement_ids: ids, category: "technical" as const, prompt: `About ${ids.join(",")}`, answer_outline: "- x", difficulty: 2, meta: { ...QUESTION_META } });
const q = (prompt: string, requirement_ids: string[]) => ({ prompt, requirement_ids, answer_outline: "- x", difficulty: 2 });

describe("coverageLoop", () => {
  it("gap closed on pass 2 → passes 2, uncovered []; the gap question is returned as added (no id)", async () => {
    const llm = fakeLLM({ "gap:technical": { questions: [q("Gap r2", ["r2"])] } });
    const r = await coverageLoop(numberQuestions([draft(["r1"])]), ctx([req("r1", "technical"), req("r2", "technical")]), fakeDeps({ llm }));
    expect(r.coverage).toEqual({ uncovered_requirement_ids: [], passes: 2 });
    expect(r.passes).toEqual([{ pass: 1, uncovered: ["r2"] }, { pass: 2, uncovered: [] }]);
    expect(r.added).toEqual([expect.objectContaining({ prompt: "Gap r2", requirement_ids: ["r2"], category: "technical" })]);
    expect(r.added[0]).not.toHaveProperty("id");
    expect(r.warnings).toEqual([]);
  });

  it("gap prompt lists exactly the uncovered ids, grouped by kind", async () => {
    const llm = fakeLLM({ "gap:technical": { questions: [q("a", ["r2"]), q("b", ["r3"])] }, "gap:behavioural": { questions: [q("c", ["r4"])] } });
    const reqs = [req("r1", "technical"), req("r2", "technical"), req("r3", "domain"), req("r4", "behavioural")];
    await coverageLoop(numberQuestions([draft(["r1"])]), ctx(reqs), fakeDeps({ llm }));
    const tech = llm.calls.find((c) => c.label === "gap:technical")!.user;
    expect([...tech.matchAll(/^(r\d+) \[/gm)].map((m) => m[1])).toEqual(["r2", "r3"]);
    expect(tech).toContain("Write exactly one question for EACH listed requirement");
    const beh = llm.calls.find((c) => c.label === "gap:behavioural")!.user;
    expect([...beh.matchAll(/^(r\d+) \[/gm)].map((m) => m[1])).toEqual(["r4"]);
  });

  it("model never covers must r3 → fallback question, uncovered [], passes 3, warning", async () => {
    const llm = fakeLLM({ "gap:behavioural": { questions: [q("off-topic", ["r1"])] } });
    const r = await coverageLoop(numberQuestions([draft(["r1"])]), ctx([req("r1", "technical"), req("r3", "behavioural")]), fakeDeps({ llm }));
    expect(r.coverage).toEqual({ uncovered_requirement_ids: [], passes: MAX_PASSES });
    expect(llm.calls).toHaveLength(MAX_PASSES - 1);
    const fb = r.added.at(-1)!;
    expect(fb).toMatchObject({ category: "behavioural", requirement_ids: ["r3"], difficulty: 2, fallback: true, prompt: "Tell me about a time you demonstrated skill r3." });
    expect(fb.answer_outline).toContain("- Situation:");
    expect(r.warnings).toEqual(["No generated question covered must-have requirement(s) r3; added a template question for each."]);
  });

  it("an uncovered nice requirement stays reported (no fallback for nice)", async () => {
    const llm = fakeLLM({ "gap:technical": { questions: [] } });
    const r = await coverageLoop(numberQuestions([draft(["r1"])]), ctx([req("r1", "technical"), req("r2", "technical", "nice")]), fakeDeps({ llm }));
    expect(r.coverage).toEqual({ uncovered_requirement_ids: ["r2"], passes: 3 });
    expect(r.added).toEqual([]);
  });

  it("a failed gap call is a warning; the fallback still covers the must", async () => {
    const failing = { complete: async () => Promise.reject(new Error("boom")) };
    const r = await coverageLoop([], ctx([req("r1", "technical")]), fakeDeps({ llm: failing }));
    expect(r.coverage.uncovered_requirement_ids).toEqual([]);
    expect(r.added[0]).toMatchObject({ fallback: true, prompt: "Walk me through how you've applied Skill r1 in a real project — what trade-offs did you make?" });
    expect(r.warnings[0]).toBe("Could not generate gap questions for r1: INTERNAL");
  });
});
