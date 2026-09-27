import { describe, expect, it } from "vitest";
import type { Flashcard, Requirement } from "./kit.ts";
import { cardsForDay, orderSession, todayDay, type PracticeProgress } from "./practice.ts";

const card = (id: string, requirement_ids: string[] = ["r2"]): Flashcard => ({ id, front: id, back: id, requirement_ids });
const reqs: Requirement[] = [
  { id: "r1", text: "must", kind: "technical", priority: "must" },
  { id: "r2", text: "nice", kind: "technical", priority: "nice" },
];
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const now = new Date(Date.UTC(2026, 0, 2));

describe("orderSession", () => {
  it("never reviewed, then Not yet, Shaky, Got it", () => {
    const cards = ["got", "shaky", "new", "notyet"].map((id) => card(id));
    const progress: PracticeProgress = {
      got: { confidence: 3, reviews: 1, lastReviewedAt: at(1) },
      shaky: { confidence: 2, reviews: 1, lastReviewedAt: at(1) },
      notyet: { confidence: 1, reviews: 1, lastReviewedAt: at(1) },
    };
    expect(orderSession(cards, progress, reqs, now)).toEqual(["new", "notyet", "shaky", "got"]);
  });

  it("must-linked cards first within a group", () => {
    expect(orderSession([card("a"), card("b", ["r1"]), card("c", ["r2", "r1"])], {}, reqs, now)).toEqual(["b", "c", "a"]);
  });

  it("least recently reviewed breaks ties, then kit order", () => {
    const progress: PracticeProgress = {
      a: { confidence: 2, reviews: 1, lastReviewedAt: at(5) },
      b: { confidence: 2, reviews: 3, lastReviewedAt: at(1) },
      c: { confidence: 2, reviews: 1, lastReviewedAt: at(5) },
    };
    expect(orderSession([card("a"), card("b"), card("c")], progress, reqs, now)).toEqual(["b", "a", "c"]);
  });

  it("ignores progress for deleted cards and is deterministic", () => {
    const cards = [card("x"), card("y", ["r1"]), card("z")];
    const progress: PracticeProgress = { gone: { confidence: 1, reviews: 1, lastReviewedAt: at(0) }, z: { confidence: 1, reviews: 1, lastReviewedAt: at(0) } };
    const first = orderSession(cards, progress, reqs, now);
    expect(first).toEqual(["y", "x", "z"]);
    expect(orderSession(cards, progress, reqs, now)).toEqual(first);
    expect(orderSession([...cards], structuredClone(progress), [...reqs].reverse(), now)).toEqual(first);
  });
});

describe("schedule helpers", () => {
  it("cardsForDay picks cards linked to that day's question requirements; todayDay is the first undone day", () => {
    const day = { day: 2, focus: "", question_ids: ["q1"], minutes: 0 };
    const questions = [{ id: "q1", requirement_ids: ["r1"] }, { id: "q2", requirement_ids: ["r2"] }] as never;
    expect(cardsForDay(day, questions, [card("a", ["r1"]), card("b", ["r2"])]).map((c) => c.id)).toEqual(["a"]);
    const days = [1, 2, 3].map((d) => ({ ...day, day: d }));
    expect(todayDay(days, { 1: "t" })).toBe(2);
    expect(todayDay(days, { 1: "t", 2: "t", 3: "t" })).toBeNull();
  });
});
