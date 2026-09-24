import type { Question, Requirement, Schedule, ScheduleDay } from "../kit.ts";

/** Learning minutes per question, keyed by difficulty. Tunable. */
export const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 15, 2: 25, 3: 40 };
/** Minutes to revisit one question on a review day. Tunable. */
export const REVIEW_MINUTES = 10;

const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};
const EMPTY_FOCUS = "General preparation — no questions available";

const learnMinutes = (q: Question) => MINUTES_BY_DIFFICULTY[q.difficulty] ?? 0;

export function buildSchedule(requirements: Requirement[], questions: Question[], daysAvailable: number): Schedule {
  const N = daysAvailable;
  if (questions.length === 0) {
    const days = Array.from({ length: N }, (_, i) => ({ day: i + 1, focus: EMPTY_FOCUS, question_ids: [], minutes: 0 }));
    return { days_available: N, days };
  }

  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const isMust = (q: Question) => q.requirement_ids.some((id) => reqById.get(id)?.priority === "must");

  // a) must first, then harder first, then original order.
  const ranked = questions
    .map((q, index) => ({ q, index, must: isMust(q) }))
    .sort((a, b) => Number(b.must) - Number(a.must) || b.q.difficulty - a.q.difficulty || a.index - b.index)
    .map((x) => x.q);

  // g) up to 2 distinct requirement texts, first-appearance order, 40 chars each.
  const reqText = (qs: Question[]) => {
    const texts: string[] = [];
    for (const id of new Set(qs.flatMap((q) => q.requirement_ids))) {
      const r = reqById.get(id);
      if (r && texts.length < 2) texts.push(r.text.slice(0, 40));
    }
    return texts.join(", ");
  };
  const withText = (prefix: string, qs: Question[]) => {
    const text = reqText(qs);
    return text ? `${prefix}: ${text}` : prefix;
  };
  const learningDay = (day: number, qs: Question[]): ScheduleDay => ({
    day,
    focus: withText([...new Set(qs.map((q) => CATEGORY_LABELS[q.category]))].join(" + "), qs),
    question_ids: qs.map((q) => q.id),
    minutes: qs.reduce((sum, q) => sum + learnMinutes(q), 0),
  });

  const days: ScheduleDay[] = [];

  if (ranked.length >= N) {
    // c) N contiguous non-empty chunks, balanced by minutes; last day takes the rest.
    let i = 0;
    let remainingMinutes = ranked.reduce((sum, q) => sum + learnMinutes(q), 0);
    for (let d = 1; d <= N; d++) {
      const laterDays = N - d;
      const target = remainingMinutes / (laterDays + 1);
      const chunk = [ranked[i++]];
      let dayMinutes = learnMinutes(chunk[0]);
      while (i < ranked.length && (d === N || (dayMinutes < target && ranked.length - i > laterDays))) {
        dayMinutes += learnMinutes(ranked[i]);
        chunk.push(ranked[i++]);
      }
      remainingMinutes -= dayMinutes;
      days.push(learningDay(d, chunk));
    }
  } else {
    // d) one question per learning day, then round-robin the ranked list over review days.
    ranked.forEach((q, i) => days.push(learningDay(i + 1, [q])));
    const reviewDays = N - ranked.length;
    const buckets: Question[][] = Array.from({ length: reviewDays }, () => []);
    for (let k = 0; k < Math.max(ranked.length, reviewDays); k++) {
      buckets[k % reviewDays].push(ranked[k % ranked.length]);
    }
    buckets.forEach((qs, i) =>
      days.push({
        day: ranked.length + i + 1,
        focus: withText("Review", qs),
        question_ids: qs.map((q) => q.id),
        minutes: qs.length * REVIEW_MINUTES,
      }),
    );
  }

  return { days_available: N, days };
}
