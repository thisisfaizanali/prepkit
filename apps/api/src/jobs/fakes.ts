// Test-only fakes for the job runner and kit endpoints.
import { buildSchedule, type Kit, type Question } from "@prepkit/shared";
import { PipelineError } from "../pipeline/runPipeline.ts";
import type { RunFn } from "./runner.ts";

export const body = { jd: "Backend engineer.\nMust know Go.", company_url: "https://acme.test", days: 3 };

const GENERATED = { origin: "generated", edited: false, pinned: false } as const;
const question = (id: string, category: Question["category"], requirement_ids: string[]): Question => ({
  id, category, requirement_ids, prompt: `Generated ${category} question ${id}`, answer_outline: "- point", difficulty: 2, meta: { ...GENERATED },
});

/** A small valid kit, shaped like runPipeline's output (with the evidence and research extensions). */
export const fakeKit = (days: number) => {
  const requirements = [
    { id: "r1", text: "Go", kind: "technical", priority: "must", evidence: "Must know Go" },
    { id: "r2", text: "SQL", kind: "technical", priority: "nice", evidence: "SQL is a plus" },
    { id: "r3", text: "Mentoring", kind: "behavioural", priority: "must", evidence: "Mentor others" },
  ] as const;
  const questions = [question("q1", "technical", ["r1"]), question("q2", "technical", ["r2"]), question("q3", "system-design", ["r1"]), question("q4", "behavioural", ["r3"])];
  return {
    source: { company: "Acme", company_url: "https://acme.test/", role: "Backend Engineer", location: "", jd_chars: 10, researched_at: new Date(0).toISOString(), pages_used: ["https://acme.test/"] },
    company_brief: { summary: "Acme makes anvils.", what_they_do: "Anvils for everyone.", sources: ["https://acme.test/"], meta: { ...GENERATED } },
    role: { title: "Backend Engineer", seniority: "senior", responsibilities: [], requirements: requirements.map((r) => ({ ...r })) },
    questions,
    flashcards: [{ id: "f1", front: "Go?", back: "A language", requirement_ids: ["r1"], meta: { ...GENERATED } }],
    schedule: buildSchedule(requirements.map((r) => ({ ...r })), questions, days),
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    warnings: [],
    research: { hiring_page_found: false, hiring_process: null, discussion: [], skipped: [] },
  } as Kit;
};

/** Fake pipeline: "FAIL" in the JD → PipelineError, "CRASH" → a plain Error; otherwise two progress events and a kit. */
export const fakeRun: RunFn = async (input, onProgress) => {
  onProgress({ step: "extract_requirements", status: "started" });
  if (input.jd.includes("FAIL")) throw new PipelineError("LLM_RATE_LIMITED", "All LLM providers are rate limited");
  if (input.jd.includes("CRASH")) throw new Error("secret internal detail");
  onProgress({ step: "extract_requirements", status: "done", ms: 5 });
  return { kit: fakeKit(input.days) as unknown as Record<string, unknown>, trace: [], researchCache: { pages: [{ url: "u", kind: "home", text: "t" }] } };
};
