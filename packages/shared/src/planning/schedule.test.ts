import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "../kit.ts";
import { validateKit } from "../validate.ts";
import { buildSchedule } from "./schedule.ts";

const requirements: Requirement[] = [
  { id: "r1", text: "Node.js and TypeScript in production", kind: "technical", priority: "must" },
  { id: "r2", text: "Designing scalable distributed systems at high throughput", kind: "technical", priority: "must" },
  { id: "r3", text: "Cross-team collaboration", kind: "behavioural", priority: "nice" },
  { id: "r4", text: "Fintech domain knowledge", kind: "domain", priority: "nice" },
];
const q = (id: string, requirement_ids: string[], category: Question["category"], difficulty: number): Question => ({
  id, requirement_ids, category, difficulty, prompt: `Prompt ${id}`, answer_outline: "",
});
const questions: Question[] = [
  q("q1", ["r3"], "behavioural", 1),
  q("q2", ["r1"], "technical", 2),
  q("q3", ["r2"], "system-design", 3),
  q("q4", ["r4"], "company-fit", 2),
  q("q5", ["r1", "r3"], "technical", 1),
  q("q6", ["r4"], "company-fit", 3),
];
// Expected rank: must first, then difficulty desc, then index.
const rankOrder = ["q3", "q2", "q5", "q6", "q4", "q1"];

const ids = (n: number) => buildSchedule(requirements, questions, n).days.flatMap((d) => d.question_ids);

describe("buildSchedule", () => {
  it.each([1, 3, 5, 60])("N=%i → N days numbered 1..N, integer minutes", (n) => {
    const s = buildSchedule(requirements, questions, n);
    expect(s.days_available).toBe(n);
    expect(s.days.map((d) => d.day)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    for (const d of s.days) expect(Number.isInteger(d.minutes)).toBe(true);
  });

  it.each([1, 3, 5, 6])("Q >= N (N=%i): each question exactly once", (n) => {
    expect([...ids(n)].sort()).toEqual(questions.map((x) => x.id).sort());
  });

  it.each([7, 10, 60])("Q < N (N=%i): every question at least once, no empty day", (n) => {
    const s = buildSchedule(requirements, questions, n);
    for (const x of questions) expect(ids(n)).toContain(x.id);
    for (const d of s.days) expect(d.question_ids.length).toBeGreaterThan(0);
  });

  it.each([1, 3, 10])("every covered must requirement is scheduled (N=%i)", (n) => {
    const scheduled = new Set(ids(n).flatMap((id) => questions.find((x) => x.id === id)!.requirement_ids));
    expect(scheduled.has("r1") && scheduled.has("r2")).toBe(true);
  });

  it("day 1 has the top-ranked question; day 1 ranks higher on average than the last day", () => {
    const s = buildSchedule(requirements, questions, 3);
    expect(s.days[0].question_ids).toContain("q3");
    const avg = (qs: string[]) => qs.reduce((sum, id) => sum + rankOrder.indexOf(id), 0) / qs.length;
    expect(avg(s.days[0].question_ids)).toBeLessThan(avg(s.days.at(-1)!.question_ids));
  });

  it("review days preserve ranked order", () => {
    const s = buildSchedule(requirements, questions, 10);
    expect(s.days.slice(questions.length).flatMap((d) => d.question_ids)).toEqual(rankOrder);
  });

  it("truncates long requirement text at a word boundary with …", () => {
    const focus = buildSchedule(requirements, questions, 10).days[0].focus;
    expect(focus).toBe("System design: Designing scalable distributed systems…");
    expect(buildSchedule(requirements, questions, 10).days[1].focus).not.toContain("…");
  });

  it("N=1 → everything on day 1 in rank order", () => {
    expect(buildSchedule(requirements, questions, 1).days[0].question_ids).toEqual(rankOrder);
  });

  it("zero questions → N empty days", () => {
    const s = buildSchedule(requirements, [], 4);
    expect(s.days).toHaveLength(4);
    for (const d of s.days) expect(d).toMatchObject({ question_ids: [], minutes: 0 });
  });

  it("is deterministic", () => {
    expect(buildSchedule(requirements, questions, 4)).toEqual(buildSchedule(requirements, questions, 4));
  });

  it.each([1, 3, 10])("integrates with validateKit (N=%i)", (n) => {
    const kit = {
      source: {
        company: "Acme", company_url: "https://acme.example", role: "BE", location: "Remote",
        jd_chars: 1, researched_at: "2026-09-24T10:00:00Z", pages_used: [],
      },
      company_brief: { summary: "s", what_they_do: "w", sources: [] },
      role: { title: "BE", seniority: "mid", responsibilities: [], requirements },
      questions,
      flashcards: [],
      schedule: buildSchedule(requirements, questions, n),
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };
    expect(validateKit(kit)).toMatchObject({ ok: true });
  });
});
