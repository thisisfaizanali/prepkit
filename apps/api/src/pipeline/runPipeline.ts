import { buildSchedule, validateKit, type CompanyBrief } from "@prepkit/shared";
import { z } from "zod";
import { LLMError } from "../llm/client.ts";
import { normalizeCompanyUrl } from "../retrieval/urlGuard.ts";
import { companyBrief } from "./steps/companyBrief.ts";
import { coverageLoop } from "./steps/coverageLoop.ts";
import { generateFlashcards } from "./steps/generateFlashcards.ts";
import { errorCode, generateAllQuestions, numberQuestions, QUESTION_META } from "./steps/generateQuestions.ts";
import { planQuestionJobs } from "./steps/planQuestions.ts";
import { extractAndResearch } from "./steps/research.ts";
import { summarizeHiringProcess } from "./steps/summarizeHiringProcess.ts";
import { createTrace, type PipelineDeps, type ProgressEvent } from "./trace.ts";

export const DEFAULT_TIMEOUT_MS = 240_000;

export type PipelineErrorCode = "INVALID_INPUT" | "TIMEOUT" | "INVALID_KIT" | LLMError["code"];

export class PipelineError extends Error {
  constructor(
    public code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export const PipelineInputSchema = z.object({
  jd: z.string().trim().min(1, "jd is empty").max(50_000, "jd is longer than 50,000 characters"),
  company_url: z.string(),
  days: z.number().int().min(1).max(90),
});
export type PipelineInput = z.infer<typeof PipelineInputSchema>;

export const RESEARCH_CACHE_CHARS = 30_000;
export type ResearchCachePage = { url: string; kind: string; text: string };
/** researchCache: the site and hiring page texts the run used, so the brief can be regenerated without re-crawling. */
export type PipelineResult = { kit: Record<string, unknown>; trace: ProgressEvent[]; researchCache: { pages: ResearchCachePage[] } };

/** Keep pages in order until the total text budget runs out (the last one truncated). */
export function capPages(pages: ResearchCachePage[], budget = RESEARCH_CACHE_CHARS): ResearchCachePage[] {
  const out: ResearchCachePage[] = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const text = p.text.slice(0, budget);
    out.push({ ...p, text });
    budget -= text.length;
  }
  return out;
}

/**
 * Full run: [extraction ∥ crawl] → search → hiring summary ∥ brief → plan → questions → coverage loop → flashcards
 * → schedule → assemble → validate. Only invalid input, extraction LLM failure, an invalid final kit and the
 * timeout are fatal; everything else degrades with a warning.
 */
export async function runPipeline(input: unknown, deps: PipelineDeps, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}): Promise<PipelineResult> {
  const parsed = PipelineInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PipelineError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  // ponytail: race doesn't cancel in-flight work; thread an AbortSignal through deps if this matters.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PipelineError("TIMEOUT", `pipeline did not finish within ${timeoutMs / 1000}s`)), timeoutMs);
  });
  try {
    return await Promise.race([run(parsed.data, deps), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function run({ jd, company_url, days }: PipelineInput, outer: PipelineDeps): Promise<PipelineResult> {
  const { trace, onProgress } = createTrace(outer.onProgress);
  const deps: PipelineDeps = { ...outer, onProgress };
  const warnings: string[] = [];

  const { extraction, research } = await extractAndResearch({ jd, companyUrl: company_url }, deps).catch((e) => {
    if (e instanceof LLMError) throw new PipelineError(e.code, `requirement extraction failed: ${e.message}`);
    throw e;
  });
  warnings.push(...extraction.warnings, ...research.warnings);
  const requirements = extraction.requirements;
  const x = extraction.extraction;

  const [hiring, brief] = await Promise.all([
    summarizeHiringProcess(research, deps).catch((e) => {
      warnings.push(`Could not summarise the hiring process: ${errorCode(e)}`);
      return null;
    }),
    companyBrief({ research, jd, companyUrl: company_url }, deps).catch((e): CompanyBrief => {
      warnings.push(`Could not write the company brief: ${errorCode(e)}`);
      return {
        summary: `The company brief could not be generated (${errorCode(e)}). Nothing here is guessed.`,
        what_they_do: "Not available — the brief could not be generated.",
        sources: [],
        meta: { ...QUESTION_META },
      };
    }),
  ]);

  // A brief with no sources is the honest "nothing retrieved" placeholder: nothing to base company-fit questions on.
  const briefIsReal = brief.sources.length > 0;
  const jobs = planQuestionJobs(requirements, hiring, x.seniority || x.title, briefIsReal);
  onProgress({ step: "plan_questions", status: "done", detail: jobs.map((j) => `${j.category}×${j.target}`).join(", ") || "no jobs" });

  const ctx = { requirements, role: { title: x.title, seniority: x.seniority }, hiring, brief, companyName: research.companyName };
  const drafted = await generateAllQuestions(jobs, ctx, deps);
  const covered = await coverageLoop(drafted.questions, ctx, deps);
  const questions = [...drafted.questions, ...numberQuestions(covered.added, drafted.questions.length + 1)];
  const cards = await generateFlashcards(requirements, questions, deps);
  warnings.push(...drafted.warnings, ...covered.warnings, ...cards.warnings);

  const schedule = buildSchedule(requirements, questions, days);
  onProgress({ step: "schedule", status: "done", detail: `${schedule.days.length} days, ${questions.length} questions` });

  let companyUrl = company_url;
  try {
    companyUrl = normalizeCompanyUrl(company_url).href;
  } catch {
    // keep the raw input
  }
  const pagesUsed = [...new Set([...(hiring?.sources ?? []), ...brief.sources.filter((s) => /^https?:\/\//.test(s))])];

  const kit = {
    source: {
      company: research.companyName || "Unknown",
      company_url: companyUrl,
      role: x.title,
      location: x.location,
      jd_chars: jd.length,
      researched_at: new Date().toISOString(),
      pages_used: pagesUsed,
    },
    company_brief: brief,
    role: { title: x.title, seniority: x.seniority, responsibilities: x.responsibilities, requirements },
    questions,
    id_seq: { q: questions.length, f: cards.flashcards.length },
    flashcards: cards.flashcards,
    schedule,
    coverage: covered.coverage,
    warnings,
    research: {
      hiring_page_found: research.hiringPageFound,
      hiring_process: hiring ? { stages: hiring.stages, signals: hiring.signals, notes: hiring.notes } : null,
      discussion: research.discussion.map(({ url, title, attribution }) => ({ url, title, attribution })),
      skipped: research.skipped,
    },
    pipeline_trace: trace,
  };

  const valid = validateKit(kit);
  if (!valid.ok) throw new PipelineError("INVALID_KIT", valid.errors.join("; "));
  const researchCache = {
    pages: capPages([
      ...research.pages.map(({ url, kind, text }) => ({ url, kind, text })),
      ...research.hiringPages.map(({ url, text }) => ({ url, kind: "hiring", text })),
    ]),
  };
  return { kit, trace, researchCache };
}
