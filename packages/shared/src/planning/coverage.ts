import type { Question, Requirement } from "../kit.ts";

export function checkCoverage(
  requirements: Requirement[],
  questions: Question[],
): { uncovered_requirement_ids: string[]; uncovered_must_ids: string[] } {
  const covered = new Set(questions.filter((q) => q.prompt.trim() !== "").flatMap((q) => q.requirement_ids));
  const uncovered = requirements.filter((r) => !covered.has(r.id));
  return {
    uncovered_requirement_ids: uncovered.map((r) => r.id),
    uncovered_must_ids: uncovered.filter((r) => r.priority === "must").map((r) => r.id),
  };
}
