import type { Question, Requirement } from "@prepkit/shared";
import type { HiringProcessSummary } from "./summarizeHiringProcess.ts";

export type QuestionCategory = Question["category"];
export type QuestionJob = { category: QuestionCategory; requirementIds: string[]; target: number; guidance: string[] };

/** Order questions are numbered and listed in. */
export const CATEGORY_ORDER: QuestionCategory[] = ["technical", "system-design", "behavioural", "company-fit"];
const BATCH_SIZE = 6;
const SENIOR = /senior|staff|principal|lead|architect/i;

const target = (reqs: Requirement[]) => reqs.reduce((n, r) => n + (r.priority === "must" ? 2 : 1), 0);
const ids = (reqs: Requirement[]) => reqs.map((r) => r.id);
const batches = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / BATCH_SIZE) }, (_, i) => items.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));

/**
 * Deterministic question mix: which categories, how many questions, for which requirements.
 * The hiring process shapes the kit here, through targets and per-job guidance.
 */
export function planQuestionJobs(
  requirements: Requirement[],
  hiring: Pick<HiringProcessSummary, "signals" | "stages"> | null,
  seniority: string,
  briefIsReal: boolean,
): QuestionJob[] {
  const signals = hiring?.signals;
  const stages = hiring?.stages.map((s) => s.name).filter(Boolean) ?? [];
  const context = stages.length ? [`The company's interview stages are: ${stages.join(" → ")}.`] : [];
  const jobs: QuestionJob[] = [];

  const technical = requirements.filter((r) => r.kind === "technical" || r.kind === "domain");
  const hands = signals?.live_coding || signals?.pair_programming ? ["Include hands-on coding exercise prompts."] : [];
  batches(technical).forEach((batch, i) => {
    const takeHome = signals?.take_home && i === 0 ? ["Include one question on how you'd approach a take-home assignment for this role."] : [];
    jobs.push({ category: "technical", requirementIds: ids(batch), target: target(batch), guidance: [...takeHome, ...hands, ...context] });
  });

  const techMust = requirements.filter((r) => r.kind === "technical" && r.priority === "must");
  const sdTarget = signals?.system_design ? 3 : SENIOR.test(seniority) ? 1 : 0;
  if (sdTarget > 0) {
    const mirror = signals?.system_design ? ["Mirror a dedicated system design round."] : [];
    jobs.push({ category: "system-design", requirementIds: ids(techMust), target: sdTarget, guidance: [...mirror, ...context] });
  }

  const behavioural = requirements.filter((r) => r.kind === "behavioural");
  if (behavioural.length) {
    for (const batch of batches(behavioural)) {
      jobs.push({ category: "behavioural", requirementIds: ids(batch), target: target(batch), guidance: [...context] });
    }
  } else if (signals?.behavioural) {
    jobs.push({ category: "behavioural", requirementIds: [], target: 2, guidance: [...context] });
  }

  if (briefIsReal) {
    const fit = requirements.filter((r) => r.kind === "behavioural" || r.kind === "domain");
    jobs.push({ category: "company-fit", requirementIds: ids(fit), target: signals?.culture_values ? 3 : 2, guidance: [...context] });
  }
  return jobs;
}
