// Test-only: a small valid kit for builder tests.
import type { Question } from "../kit.ts";
import type { BuilderKit } from "./state.ts";

export const q = (id: string, category: Question["category"], requirement_ids: string[], meta?: Question["meta"]): Question => ({
  id, category, requirement_ids, prompt: `Prompt ${id}`, answer_outline: `Outline ${id}`, difficulty: 2, ...(meta ? { meta } : {}),
});

export function fixtureKit(): BuilderKit {
  return {
    source: { company: "Acme", company_url: "https://acme.test/", role: "Engineer", location: "", jd_chars: 100, researched_at: "2026-01-01T00:00:00Z", pages_used: [] },
    company_brief: { summary: "Acme makes anvils.", what_they_do: "Anvils.", sources: ["https://acme.test/"], meta: { origin: "generated", edited: false, pinned: false } },
    role: {
      title: "Engineer", seniority: "senior", responsibilities: [],
      requirements: [
        { id: "r1", text: "Go", kind: "technical", priority: "must" },
        { id: "r2", text: "SQL", kind: "technical", priority: "nice" },
        { id: "r3", text: "Mentoring", kind: "behavioural", priority: "must" },
      ],
    },
    questions: [q("q1", "technical", ["r1"]), q("q2", "technical", ["r2"]), q("q3", "system-design", ["r1"]), q("q4", "behavioural", ["r3"])],
    flashcards: [{ id: "f1", front: "Go?", back: "A language", requirement_ids: ["r1"] }, { id: "f2", front: "SQL?", back: "Queries", requirement_ids: ["r2"] }],
    schedule: { days_available: 2, days: [{ day: 1, focus: "a", question_ids: ["q1", "q3"], minutes: 50 }, { day: 2, focus: "b", question_ids: ["q2", "q4"], minutes: 50 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    warnings: [],
  };
}
