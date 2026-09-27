import type { Flashcard, Question, Requirement, ScheduleDay } from "./kit.ts";

export const CONFIDENCE_LABELS = { 1: "Not yet", 2: "Shaky", 3: "Got it" } as const;
export type Confidence = keyof typeof CONFIDENCE_LABELS;
/** lastReviewedAt: ISO string. */
export type PracticeEntry = { confidence: Confidence; reviews: number; lastReviewedAt: string };
export type PracticeProgress = Record<string, PracticeEntry>;

/**
 * Order a practice session: never reviewed, then "Not yet", "Shaky", "Got it". Within a group, cards linked to a must
 * requirement first, then least recently reviewed, then kit order.
 *
 * Why not spaced repetition (SM-2): the interview is days away, so SM-2's growing intervals would schedule most
 * reviews after the interview. A confidence-first order with a recency tie-break gives the weakest material the most
 * exposure inside the window that exists. Progress for deleted cards is simply never looked up.
 * `now` is unused by the rule today; it's kept in the signature so a time-based rule can drop in without call-site churn.
 */
export function orderSession(flashcards: Flashcard[], progress: PracticeProgress, requirements: Requirement[], _now: Date = new Date()): string[] {
  const musts = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const rank = flashcards.map((c, index) => {
    const p = progress[c.id];
    return {
      id: c.id,
      group: p ? p.confidence : 0,
      must: c.requirement_ids.some((id) => musts.has(id)) ? 0 : 1,
      seen: p ? Date.parse(p.lastReviewedAt) : 0,
      index,
    };
  });
  rank.sort((a, b) => a.group - b.group || a.must - b.must || a.seen - b.seen || a.index - b.index);
  return rank.map((r) => r.id);
}

/** Flashcards linked to the requirements of one schedule day's questions. */
export function cardsForDay(day: ScheduleDay, questions: Question[], flashcards: Flashcard[]): Flashcard[] {
  const ids = new Set(day.question_ids);
  const reqs = new Set(questions.filter((q) => ids.has(q.id)).flatMap((q) => q.requirement_ids));
  return flashcards.filter((c) => c.requirement_ids.some((r) => reqs.has(r)));
}

/** First schedule day not marked done (null when every day is done). */
export function todayDay(days: ScheduleDay[], done: Record<string, unknown> = {}): number | null {
  return days.find((d) => !done[d.day])?.day ?? null;
}
