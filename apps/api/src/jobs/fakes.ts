// Test-only fakes for the job runner and kit endpoints.
import type { Kit } from "@prepkit/shared";
import { PipelineError } from "../pipeline/runPipeline.ts";
import type { RunFn } from "./runner.ts";

export const body = { jd: "Backend engineer.\nMust know Go.", company_url: "https://acme.test", days: 3 };

export const fakeKit = (days: number) =>
  ({
    source: { company: "Acme", company_url: "https://acme.test/", role: "Backend Engineer", location: "", jd_chars: 10, researched_at: new Date(0).toISOString(), pages_used: [] },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: { title: "Backend Engineer", seniority: "", responsibilities: [], requirements: [{ id: "r1", text: "Go", kind: "technical", priority: "must" }] },
    questions: [{ id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "p", answer_outline: "a", difficulty: 2 }],
    flashcards: [],
    schedule: { days_available: days, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  }) as unknown as Kit;

/** Fake pipeline: "FAIL" in the JD → PipelineError, "CRASH" → a plain Error; otherwise two progress events and a kit. */
export const fakeRun: RunFn = async (input, onProgress) => {
  onProgress({ step: "extract_requirements", status: "started" });
  if (input.jd.includes("FAIL")) throw new PipelineError("LLM_RATE_LIMITED", "All LLM providers are rate limited");
  if (input.jd.includes("CRASH")) throw new Error("secret internal detail");
  onProgress({ step: "extract_requirements", status: "done", ms: 5 });
  return { kit: fakeKit(input.days) as unknown as Record<string, unknown>, trace: [], researchCache: { pages: [{ url: "u", kind: "home", text: "t" }] } };
};
