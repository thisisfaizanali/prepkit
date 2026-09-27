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
const EMPTY_FOCUS = "General preparation, no questions available";

const learnMinutes = (q: Question) => MINUTES_BY_DIFFICULTY[q.difficulty] ?? 0;
const reviewMinutes = () => REVIEW_MINUTES;

/** Truncate at the last word boundary within `max` chars, appending "…" only when cut. */
function truncate(text: string, max = 40): string {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max);
  return text.slice(0, space > 0 ? space : max).trimEnd() + "…";
}

/**
 * Split items into `days` contiguous non-empty chunks, balanced by cost.
 * Each day takes items while under its minutes target, and at least its fair share by count,
 * so leftovers land on earlier (higher-ranked) days instead of piling onto the last one.
 */
function chunkBalanced<T>(items: T[], days: number, cost: (item: T) => number): T[][] {
  const chunks: T[][] = [];
  let i = 0;
  let remainingMinutes = items.reduce((sum, x) => sum + cost(x), 0);
  for (let d = 1; d <= days; d++) {
    const daysLeft = days - d + 1;
    const target = remainingMinutes / daysLeft;
    const minCount = Math.ceil((items.length - i) / daysLeft);
    const chunk = [items[i++]];
    let dayMinutes = cost(chunk[0]);
    while (i < items.length && items.length - i > daysLeft - 1 && (dayMinutes < target || chunk.length < minCount)) {
      dayMinutes += cost(items[i]);
      chunk.push(items[i++]);
    }
    remainingMinutes -= dayMinutes;
    chunks.push(chunk);
  }
  return chunks;
}

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

  // g) up to 2 distinct requirement texts, first-appearance order.
  const reqText = (qs: Question[]) => {
    const texts: string[] = [];
    for (const id of new Set(qs.flatMap((q) => q.requirement_ids))) {
      const r = reqById.get(id);
      if (r && texts.length < 2) texts.push(truncate(r.text));
    }
    return texts.join(", ");
  };
  const toDay = (day: number, prefix: string, qs: Question[], cost: (q: Question) => number): ScheduleDay => {
    const text = reqText(qs);
    return {
      day,
      focus: text ? `${prefix}: ${text}` : prefix,
      question_ids: qs.map((q) => q.id),
      minutes: qs.reduce((sum, q) => sum + cost(q), 0),
    };
  };
  const learningDay = (day: number, qs: Question[]) =>
    toDay(day, [...new Set(qs.map((q) => CATEGORY_LABELS[q.category]))].join(" + "), qs, learnMinutes);

  if (ranked.length >= N) {
    // c) N contiguous chunks of the ranked list, balanced by learning minutes.
    return { days_available: N, days: chunkBalanced(ranked, N, learnMinutes).map((qs, i) => learningDay(i + 1, qs)) };
  }

  // d) one question per learning day, then the ranked list again, chunked over review days.
  // More review days than questions → repeat whole passes of the list so no day is empty.
  const reviewDays = N - ranked.length;
  const reviewList = Array.from({ length: Math.ceil(reviewDays / ranked.length) }, () => ranked).flat();
  const days = [
    ...ranked.map((q, i) => learningDay(i + 1, [q])),
    ...chunkBalanced(reviewList, reviewDays, reviewMinutes).map((qs, i) =>
      toDay(ranked.length + i + 1, "Review", qs, reviewMinutes),
    ),
  ];
  return { days_available: N, days };
}
