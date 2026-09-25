import { checkCoverage, type Coverage } from "@prepkit/shared";
import type { PipelineDeps } from "../trace.ts";
import type { KitRequirement } from "./extractRequirements.ts";
import { errorCode, generateQuestions, numberQuestions, QUESTION_META, type DraftQuestion, type KitQuestion, type QuestionContext } from "./generateQuestions.ts";

/**
 * Pass 1 checks the draft; passes 2–3 retry only the gaps with targeted prompts. Beyond that we'd be burning
 * tokens on a requirement the model can't handle, and the deterministic fallback guarantees must-have coverage.
 */
export const MAX_PASSES = 3;

export type CoveragePass = { pass: number; uncovered: string[] };

const lcFirst = (t: string) => (/^\p{Lu}\p{Ll}/u.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

/** Code-built question for a must-have requirement the model never covered. */
function fallbackQuestion(r: KitRequirement): DraftQuestion {
  const behavioural = r.kind === "behavioural";
  return {
    requirement_ids: [r.id],
    category: behavioural ? "behavioural" : "technical",
    prompt: behavioural
      ? `Tell me about a time you demonstrated ${lcFirst(r.text)}.`
      : `Walk me through how you've applied ${r.text} in a real project — what trade-offs did you make?`,
    answer_outline: behavioural
      ? "- Situation: the context and what was at stake\n- Task: what you were responsible for\n- Action: the specific steps you took\n- Result: the measurable outcome and what you learned"
      : `- The project and why ${r.text} mattered there\n- What you built or decided, and your part in it\n- The trade-offs you weighed and why you chose as you did\n- The outcome, and what you'd do differently`,
    difficulty: 2,
    meta: { ...QUESTION_META },
    fallback: true,
  };
}

export async function coverageLoop(
  questions: KitQuestion[],
  ctx: QuestionContext,
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
): Promise<{ questions: KitQuestion[]; coverage: Coverage; passes: CoveragePass[]; warnings: string[] }> {
  const all = [...questions];
  const passes: CoveragePass[] = [];
  const warnings: string[] = [];
  const append = (drafts: DraftQuestion[]) => all.push(...numberQuestions(drafts, all.length + 1));

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const { uncovered_requirement_ids: uncovered } = checkCoverage(ctx.requirements, all);
    passes.push({ pass, uncovered });
    deps.onProgress({ step: "coverage_check", status: "done", detail: `pass ${pass}: ${uncovered.length ? `uncovered ${uncovered.join(", ")}` : "all covered"}` });
    if (uncovered.length === 0 || pass === MAX_PASSES) break;

    const gaps = ctx.requirements.filter((r) => uncovered.includes(r.id));
    const groups = [
      { category: "technical" as const, ids: gaps.filter((r) => r.kind !== "behavioural").map((r) => r.id) },
      { category: "behavioural" as const, ids: gaps.filter((r) => r.kind === "behavioural").map((r) => r.id) },
    ].filter((g) => g.ids.length);
    const drafts = await Promise.all(
      groups.map((g) =>
        generateQuestions({ category: g.category, requirementIds: g.ids, target: g.ids.length, guidance: [] }, ctx, deps, { gap: true }).catch((e) => {
          warnings.push(`Could not generate gap questions for ${g.ids.join(", ")}: ${errorCode(e)}`);
          return [];
        }),
      ),
    );
    append(drafts.flat());
  }

  const { uncovered_must_ids } = checkCoverage(ctx.requirements, all);
  if (uncovered_must_ids.length) {
    append(ctx.requirements.filter((r) => uncovered_must_ids.includes(r.id)).map(fallbackQuestion));
    warnings.push(`No generated question covered must-have requirement(s) ${uncovered_must_ids.join(", ")}; added a template question for each.`);
  }
  const final = checkCoverage(ctx.requirements, all);
  return {
    questions: all,
    coverage: { uncovered_requirement_ids: final.uncovered_requirement_ids, passes: passes.length },
    passes,
    warnings,
  };
}
