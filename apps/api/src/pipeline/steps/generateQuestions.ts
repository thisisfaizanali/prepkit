import type { CompanyBrief, Question } from "@prepkit/shared";
import { z } from "zod";
import { MAX_TOKENS } from "../../llm/budgets.ts";
import { LLMError } from "../../llm/client.ts";
import { generateJson } from "../../llm/json.ts";
import { untrusted, UNTRUSTED_POLICY } from "../../llm/untrusted.ts";
import { llmInfo, traced, type PipelineDeps } from "../trace.ts";
import type { KitRequirement } from "./extractRequirements.ts";
import { CATEGORY_ORDER, type QuestionCategory, type QuestionJob } from "./planQuestions.ts";
import type { HiringProcessSummary } from "./summarizeHiringProcess.ts";

export type QuestionContext = {
  requirements: KitRequirement[];
  role: { title: string; seniority: string };
  hiring: Pick<HiringProcessSummary, "stages" | "notes"> | null;
  /** Only company-fit questions see the brief. */
  brief: Pick<CompanyBrief, "summary" | "what_they_do"> | null;
  companyName: string;
};
/** A question before ids are assigned. `fallback` marks the code-built safety net (kit extension). */
export type DraftQuestion = Omit<Question, "id"> & { fallback?: true };
export type KitQuestion = Question & { fallback?: true };

export const QUESTION_META = { origin: "generated", edited: false, pinned: false } as const;

const outline = z.union([z.string(), z.array(z.string()).transform((a) => a.map((x) => `- ${x}`).join("\n"))]);
const DraftSchema = z.object({
  questions: z.array(
    z.object({
      requirement_ids: z.array(z.string()).default([]),
      prompt: z.string().default(""),
      answer_outline: outline.default(""),
      difficulty: z.coerce.number().catch(2),
    }),
  ),
});

const FORMAT = `Return a JSON object:
{ "questions": [{
  "requirement_ids": string[],   // ids of the listed requirements this question tests (only ids from the list)
  "prompt": string,              // the question as the interviewer would ask it
  "answer_outline": string,      // what a strong answer covers: 3-5 short "- " bullet lines, newline-separated
  "difficulty": 1 | 2 | 3        // 1 = fundamentals, 2 = applied, 3 = deep / senior-level
}] }

Rules:
- Ground every question in the listed requirements and their evidence quotes; do not invent skills the role doesn't ask for.
- Pitch difficulty to the role's seniority. Keep outlines concise.
- Follow any guidance lines given.`;

const INTROS: Record<QuestionCategory, string> = {
  technical: `You write TECHNICAL interview questions for a candidate preparing for a specific role.
Probe depth, not trivia: how things work under the hood, trade-offs between approaches, and debugging real failures.
Each question should be answerable from hands-on experience with the requirement it targets.`,
  behavioural: `You write BEHAVIOURAL interview questions for a candidate preparing for a specific role.
Write situational "Tell me about a time..." / "Describe a situation..." questions tied to the listed requirements.
The answer_outline is a STAR skeleton with exactly these bullets: "- Situation: ...", "- Task: ...", "- Action: ...", "- Result: ...",
each saying what this particular answer should cover.`,
  "system-design": `You write SYSTEM DESIGN interview questions for a candidate preparing for a specific role.
Each question is a design problem scoped to this role's domain and technologies (not a generic "design Twitter").
The answer_outline follows: "- Requirements: ...", "- Components: ...", "- Trade-offs: ...", "- Scaling: ...".`,
  "company-fit": `You write COMPANY-FIT interview questions (motivation and values) for a candidate preparing for a specific role.
Ground them ONLY in the provided company brief and hiring process: why this company, how the candidate's values and
working style match what the brief says. Never state facts about the company that the brief doesn't contain.`,
};

const SYSTEMS = Object.fromEntries(
  CATEGORY_ORDER.map((c) => [c, `${INTROS[c]}\n\n${FORMAT}\n\n${UNTRUSTED_POLICY}`]),
) as Record<QuestionCategory, string>;

const clampDifficulty = (d: number) => (Number.isFinite(d) ? Math.min(3, Math.max(1, Math.round(d))) : 2);

/** Category is set by code; ids limited to the job's requirements; empties dropped; difficulty clamped. */
export function postProcess(raw: z.infer<typeof DraftSchema>["questions"], category: QuestionCategory, allowedIds: string[]): DraftQuestion[] {
  const allowed = new Set(allowedIds);
  return raw
    .filter((q) => q.prompt.trim())
    .map((q) => ({
      requirement_ids: [...new Set(q.requirement_ids.filter((id) => allowed.has(id)))],
      category,
      prompt: q.prompt.trim(),
      answer_outline: q.answer_outline.trim(),
      difficulty: clampDifficulty(q.difficulty),
      meta: { ...QUESTION_META },
    }));
}

function userPrompt(job: QuestionJob, ctx: QuestionContext, gap: boolean, avoid: string[]): string {
  const reqs = ctx.requirements.filter((r) => job.requirementIds.includes(r.id));
  const reqLines = reqs.map((r) => `${r.id} [${r.priority}, ${r.kind}] ${r.text} — evidence: "${r.evidence}"`).join("\n");
  const hiring = ctx.hiring && (ctx.hiring.stages.length || ctx.hiring.notes)
    ? [...ctx.hiring.stages.map((s) => `- ${s.name}: ${s.description}`), ...(ctx.hiring.notes ? [`Notes: ${ctx.hiring.notes}`] : [])].join("\n")
    : "";
  const task = gap
    ? `Write exactly one question for EACH listed requirement (${reqs.length} questions). Each question's requirement_ids must contain that requirement's id.`
    : `Write exactly ${job.target} ${job.category} questions.${reqs.length ? " Cover every listed requirement; must-have requirements get more questions than nice-to-haves." : ""}`;
  return [
    `Role: ${ctx.role.title || "(untitled role)"}${ctx.role.seniority ? ` (${ctx.role.seniority})` : ""}${ctx.companyName ? ` at ${ctx.companyName}` : ""}`,
    reqs.length ? `Requirements:\n${untrusted("requirements", reqLines, 6000)}` : "No specific requirements are listed for this set; base the questions on the role.",
    ...(hiring ? [`Hiring process:\n${untrusted("hiring_process", hiring, 2000)}`] : []),
    ...(job.category === "company-fit" && ctx.brief
      ? [`Company brief:\n${untrusted("company_brief", `${ctx.brief.summary}\n${ctx.brief.what_they_do}`, 2000)}`]
      : []),
    // Kept questions (user-written or edited): untrusted, since users write them.
    ...(avoid.length
      ? [`Existing questions that stay in the kit; do not duplicate them:\n${untrusted("existing_questions", avoid.map((p) => `- ${p}`).join("\n"), 4000)}`]
      : []),
    ...(job.guidance.length ? [`Guidance:\n${job.guidance.map((g) => `- ${g}`).join("\n")}`] : []),
    task,
  ].join("\n\n");
}

/**
 * One LLM call for one job. `gap` switches to the coverage loop's one-question-per-requirement instruction;
 * `avoid` lists prompts of questions that stay in the kit, so they aren't duplicated.
 */
export async function generateQuestions(
  job: QuestionJob,
  ctx: QuestionContext,
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
  { gap = false, avoid = [] as string[] } = {},
): Promise<DraftQuestion[]> {
  const label = `${gap ? "gap" : "questions"}:${job.category}`;
  return traced(
    deps,
    label,
    async () => {
      const res = await generateJson(deps.llm, {
        label,
        system: SYSTEMS[job.category],
        user: userPrompt(job, ctx, gap, avoid),
        schema: DraftSchema,
        temperature: 0.3,
        maxTokens: MAX_TOKENS.questionBatch,
      });
      return { questions: postProcess(res.data.questions, job.category, job.requirementIds), llm: llmInfo(label, res) };
    },
    (r) => ({ detail: `${r.questions.length} questions (asked for ${gap ? job.requirementIds.length : job.target})`, llm: r.llm }),
  ).then((r) => r.questions);
}

export const errorCode = (e: unknown) => (e instanceof LLMError ? e.code : "INTERNAL");

/** Order by category (then job, then model order) and number from q<start>. */
export function numberQuestions(drafts: DraftQuestion[], start = 1): KitQuestion[] {
  return drafts
    .map((q, i) => ({ q, i }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.q.category) - CATEGORY_ORDER.indexOf(b.q.category) || a.i - b.i)
    .map(({ q }, n) => ({ id: `q${start + n}`, ...q }));
}

/** All jobs concurrently (the client's pacer handles limits); a failed job becomes a warning. */
export async function generateAllQuestions(
  jobs: QuestionJob[],
  ctx: QuestionContext,
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
): Promise<{ questions: KitQuestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const results = await Promise.all(
    jobs.map((job) =>
      generateQuestions(job, ctx, deps).catch((e) => {
        warnings.push(`Could not generate ${job.category} questions: ${errorCode(e)}`);
        return [];
      }),
    ),
  );
  return { questions: numberQuestions(results.flat()), warnings };
}
