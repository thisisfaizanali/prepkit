import { checkCoverage } from "../planning/coverage.ts";
import { idSeqOf, type BuilderKit } from "./state.ts";

/**
 * Repair cross-references after edits: drop unknown requirement ids and schedule entries, recompute uncovered
 * requirements, pin down id_seq, and flag the schedule as stale when it no longer matches the questions.
 * Pure: returns a new kit.
 */
export function normalizeKit<K extends BuilderKit>(input: K): K {
  const kit = structuredClone(input);
  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  for (const item of [...kit.questions, ...kit.flashcards]) item.requirement_ids = item.requirement_ids.filter((id) => reqIds.has(id));

  const qIds = new Set(kit.questions.map((q) => q.id));
  let pruned = false;
  for (const day of kit.schedule.days) {
    const kept = day.question_ids.filter((id) => qIds.has(id));
    pruned ||= kept.length !== day.question_ids.length;
    day.question_ids = kept;
  }
  const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
  const unscheduled = kit.questions.some((q) => !scheduled.has(q.id));
  // Sticky: once stale, only a rebuilt schedule (applySchedule) clears it; a later no-op edit mustn't hide it.
  kit.schedule_stale = (input.schedule_stale ?? false) || pruned || unscheduled;

  kit.coverage = { ...kit.coverage, uncovered_requirement_ids: checkCoverage(kit.role.requirements, kit.questions).uncovered_requirement_ids };
  kit.id_seq = idSeqOf(kit);
  return kit;
}
