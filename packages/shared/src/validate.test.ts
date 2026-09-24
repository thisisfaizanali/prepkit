import { describe, expect, it } from "vitest";
import { validateKit } from "./validate.ts";

const fixture = () => ({
  source: {
    company: "Acme",
    company_url: "https://acme.example",
    role: "Backend Engineer",
    location: "Remote",
    jd_chars: 1200,
    researched_at: "2026-09-24T10:00:00Z",
    pages_used: ["https://acme.example/about"],
  },
  company_brief: { summary: "Acme builds anvils.", what_they_do: "Anvils as a service.", sources: ["https://acme.example"] },
  role: {
    title: "Backend Engineer",
    seniority: "mid",
    responsibilities: ["Build APIs"],
    requirements: [
      { id: "r1", text: "Node.js", kind: "technical", priority: "must" },
      { id: "r2", text: "Teamwork", kind: "behavioural", priority: "nice" },
    ],
  },
  questions: [
    { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Explain the event loop.", answer_outline: "Phases...", difficulty: 2 },
    { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "Tell me about a conflict.", answer_outline: "STAR...", difficulty: 1 },
  ],
  flashcards: [{ id: "f1", front: "libuv?", back: "Async I/O library", requirement_ids: ["r1"] }],
  schedule: {
    days_available: 2,
    days: [
      { day: 1, focus: "Node", question_ids: ["q1"], minutes: 60 },
      { day: 2, focus: "Behavioural", question_ids: ["q2"], minutes: 45 },
    ],
  },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});

const errorsOf = (input: unknown) => {
  const r = validateKit(input);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
};

describe("validateKit", () => {
  it("accepts the valid fixture", () => {
    expect(validateKit(fixture())).toMatchObject({ ok: true });
  });

  it("accepts extra unknown keys and optional extensions", () => {
    const k: any = fixture();
    k.extra = 1;
    k.source.foo = "bar";
    k.questions[0].meta = { source: "ai", edited: false, pinned: true, custom: 1 };
    k.warnings = ["job description is very thin"];
    expect(validateKit(k)).toMatchObject({ ok: true });
  });

  it("rejects float minutes", () => {
    const k: any = fixture();
    k.schedule.days[0].minutes = 30.5;
    expect(errorsOf(k).join()).toContain("schedule.days.0.minutes");
  });

  it.each([0, 4])("rejects difficulty %i", (d) => {
    const k: any = fixture();
    k.questions[0].difficulty = d;
    expect(errorsOf(k).join()).toContain("questions.0.difficulty");
  });

  it("rejects bad enum", () => {
    const k: any = fixture();
    k.role.requirements[0].priority = "high";
    expect(errorsOf(k).join()).toContain("role.requirements.0.priority");
  });

  it("rejects missing required field", () => {
    const k: any = fixture();
    delete k.company_brief.summary;
    expect(errorsOf(k).join()).toContain("company_brief.summary");
  });

  it("rejects question referencing unknown requirement", () => {
    const k: any = fixture();
    k.questions[0].requirement_ids = ["r9"];
    expect(errorsOf(k).join()).toContain('"r9"');
  });

  it("rejects schedule referencing unknown question", () => {
    const k: any = fixture();
    k.schedule.days[1].question_ids = ["q9"];
    expect(errorsOf(k).join()).toContain('"q9"');
  });

  it("rejects days.length !== days_available", () => {
    const k: any = fixture();
    k.schedule.days_available = 3;
    expect(errorsOf(k).join()).toContain("days_available is 3");
  });

  it("rejects duplicate question ids", () => {
    const k: any = fixture();
    k.questions[1].id = "q1";
    expect(errorsOf(k).join()).toContain('duplicate id "q1"');
  });

  it("rejects day numbering 1,3", () => {
    const k: any = fixture();
    k.schedule.days[1].day = 3;
    expect(errorsOf(k).join()).toContain("day is 3, expected 2");
  });

  it("collects multiple errors", () => {
    const k: any = fixture();
    k.questions[0].requirement_ids = ["r9"];
    k.flashcards[0].requirement_ids = ["r8"];
    k.coverage.uncovered_requirement_ids = ["r7"];
    expect(errorsOf(k).length).toBeGreaterThanOrEqual(3);
  });
});
