import type { CompanyBrief, Question, Schedule } from "../kit.ts";
import { normalizeKit } from "./normalize.ts";
import { BuilderError, GENERATED_META, idSeqOf, isProtected, type BuilderKit } from "./state.ts";

/** Display order of categories; an empty category's new questions go where it would sit. */
const CATEGORY_ORDER: Question["category"][] = ["technical", "system-design", "behavioural", "company-fit"];

/** Index to insert a question of `category` at: after that category's last question, else before the first later category. */
export function categorySlot(questions: Question[], category: Question["category"]): number {
  const last = questions.map((x) => x.category).lastIndexOf(category);
  if (last >= 0) return last + 1;
  const later = questions.findIndex((x) => CATEGORY_ORDER.indexOf(x.category) > CATEGORY_ORDER.indexOf(category));
  return later < 0 ? questions.length : later;
}

/** A generated question before it gets an id. Extra fields (e.g. `fallback`) are kept. */
export type QuestionDraft = Omit<Question, "id" | "meta"> & Record<string, unknown>;

/**
 * Append generated questions with fresh ids from id_seq, each at its category's slot so category runs stay together.
 */
export function appendGenerated<K extends BuilderKit>(input: K, drafts: QuestionDraft[]): K {
  const kit = structuredClone(input);
  const seq = idSeqOf(kit);
  for (const d of drafts) {
    const q = { ...structuredClone(d), id: `q${++seq.q}`, meta: { ...GENERATED_META } } as Question;
    kit.questions.splice(categorySlot(kit.questions, q.category), 0, q);
  }
  kit.id_seq = seq;
  return normalizeKit(kit);
}

/**
 * Regenerate one category without touching anything else: other categories stay exactly as they are,
 * protected questions in the category stay, unprotected ones are replaced by the drafts.
 */
export function mergeQuestionCategory<K extends BuilderKit>(input: K, category: Question["category"], drafts: QuestionDraft[]): K {
  const kit = structuredClone(input);
  kit.id_seq = idSeqOf(kit); // before dropping, so a dropped question's id is never handed out again
  kit.questions = kit.questions.filter((q) => q.category !== category || isProtected(q));
  return appendGenerated(kit, drafts.map((d) => ({ ...d, category })));
}

/** Replace the brief, unless the user edited/pinned it (then only with force). */
export function mergeBrief<K extends BuilderKit>(input: K, brief: Omit<CompanyBrief, "meta">, { force = false } = {}): K {
  if (isProtected(input.company_brief) && !force) {
    throw new BuilderError("BRIEF_PROTECTED", "The company brief was edited or pinned; regenerate with force to replace it");
  }
  const kit = structuredClone(input);
  kit.company_brief = { summary: brief.summary, what_they_do: brief.what_they_do, sources: [...brief.sources], meta: { ...GENERATED_META } };
  return normalizeKit(kit);
}

export function applySchedule<K extends BuilderKit>(input: K, schedule: Schedule): K {
  const kit = normalizeKit({ ...structuredClone(input), schedule: structuredClone(schedule) });
  kit.schedule_stale = false;
  return kit;
}
