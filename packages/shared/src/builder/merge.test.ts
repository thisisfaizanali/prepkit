import { describe, expect, it } from "vitest";
import { validateKit } from "../validate.ts";
import { fixtureKit, q } from "./fixture.ts";
import { appendGenerated, applySchedule, mergeBrief, mergeQuestionCategory, type QuestionDraft } from "./merge.ts";
import { normalizeKit } from "./normalize.ts";
import { BuilderError, idSeqOf, isProtected, newUserItemId } from "./state.ts";

const draft = (prompt: string, requirement_ids: string[] = ["r1"]): QuestionDraft => ({ category: "technical", requirement_ids, prompt, answer_outline: "- x", difficulty: 2 });

describe("item state", () => {
  it("isProtected: user, edited or pinned; missing meta = generated", () => {
    expect(isProtected({})).toBe(false);
    expect(isProtected({ meta: { origin: "user", edited: false, pinned: false } })).toBe(true);
    expect(isProtected({ meta: { origin: "generated", edited: true, pinned: false } })).toBe(true);
    expect(isProtected({ meta: { origin: "generated", edited: false, pinned: true } })).toBe(true);
  });

  it("id_seq initialises from the highest q<n>/f<n>, ignores user ids, never goes backwards", () => {
    const kit = fixtureKit();
    kit.questions.push(q("qu-abcd1234", "technical", []), q("q12", "technical", []));
    expect(idSeqOf(kit)).toEqual({ q: 12, f: 2 });
    expect(idSeqOf({ ...kit, id_seq: { q: 40, f: 1 } })).toEqual({ q: 40, f: 2 });
    expect(newUserItemId("q")).toMatch(/^qu-[a-z0-9]{8}$/);
  });
});

describe("normalizeKit", () => {
  it("prunes dangling requirement and schedule refs, recomputes uncovered, marks the schedule stale; passes validateKit", () => {
    const kit = fixtureKit();
    kit.questions = kit.questions.filter((x) => x.id !== "q4"); // the only r3 question
    kit.questions[0].requirement_ids.push("r99");
    kit.flashcards[0].requirement_ids.push("r98");
    const n = normalizeKit(kit);
    expect(n.questions[0].requirement_ids).toEqual(["r1"]);
    expect(n.flashcards[0].requirement_ids).toEqual(["r1"]);
    expect(n.schedule.days[1].question_ids).toEqual(["q2"]);
    expect(n.coverage).toEqual({ uncovered_requirement_ids: ["r3"], passes: 1 });
    expect(n.schedule_stale).toBe(true);
    expect(n.id_seq).toEqual({ q: 3, f: 2 }); // deleted outside the builder, before id_seq existed (applyOps seeds it first)
    expect(validateKit(n).ok).toBe(true);
    expect(kit.schedule.days[1].question_ids).toEqual(["q2", "q4"]); // input untouched
  });

  it("schedule matching the questions → not stale; an unscheduled question → stale (and it stays stale until rebuilt)", () => {
    expect(normalizeKit(fixtureKit()).schedule_stale).toBe(false);
    const kit = fixtureKit();
    kit.questions.push(q("qu-new00001", "technical", ["r1"]));
    const stale = normalizeKit(kit);
    expect(stale.schedule_stale).toBe(true);
    stale.questions.pop();
    expect(normalizeKit(stale).schedule_stale).toBe(true);
    expect(applySchedule(stale, fixtureKit().schedule).schedule_stale).toBe(false);
  });
});

describe("mergeQuestionCategory", () => {
  it("keeps protected questions and every other category byte-identical; replaces unprotected; fresh ids never reuse deleted ones", () => {
    const kit = fixtureKit();
    kit.questions[1].meta = { origin: "generated", edited: true, pinned: false }; // q2 edited
    kit.questions.push(q("qu-user0001", "technical", ["r1"], { origin: "user", edited: false, pinned: false }));
    kit.questions.push(q("q5", "technical", ["r1"], { origin: "generated", edited: false, pinned: true }));
    const others = JSON.stringify(kit.questions.filter((x) => x.category !== "technical"));

    const merged = mergeQuestionCategory(kit, "technical", [draft("New A"), draft("New B", ["r2"])]);
    expect(merged.questions.map((x) => x.id)).toEqual(["q2", "q3", "q4", "qu-user0001", "q5", "q6", "q7"]);
    expect(JSON.stringify(merged.questions.filter((x) => x.category !== "technical"))).toBe(others);
    expect(merged.questions.find((x) => x.id === "q1")).toBeUndefined();
    expect(merged.questions.find((x) => x.id === "q6")).toMatchObject({ prompt: "New A", meta: { origin: "generated", edited: false, pinned: false } });
    expect(validateKit(merged).ok).toBe(true);

    // q6/q7 get dropped by a second regeneration; their ids are never handed out again
    const again = mergeQuestionCategory(merged, "technical", [draft("Newer")]);
    expect(again.questions.filter((x) => x.category === "technical").map((x) => x.id)).toEqual(["q2", "qu-user0001", "q5", "q8"]);
  });

  it("forces the category onto drafts and places them in the category's slot even when it's empty", () => {
    const merged = mergeQuestionCategory(fixtureKit(), "system-design", [{ ...draft("Design X"), category: "technical" }]);
    expect(merged.questions.map((x) => [x.id, x.category])).toEqual([["q1", "technical"], ["q2", "technical"], ["q5", "system-design"], ["q4", "behavioural"]]);
  });

  it("appendGenerated keeps extensions like fallback and numbers from id_seq", () => {
    const kit = appendGenerated({ ...fixtureKit(), id_seq: { q: 9, f: 2 } }, [{ ...draft("fb"), category: "behavioural", fallback: true }]);
    expect(kit.questions.at(-1)).toMatchObject({ id: "q10", fallback: true });
  });
});

describe("mergeBrief", () => {
  const brief = { summary: "New", what_they_do: "New things", sources: ["https://acme.test/about"] };
  it("replaces an unprotected brief with generated meta", () => {
    expect(mergeBrief(fixtureKit(), brief).company_brief).toEqual({ ...brief, meta: { origin: "generated", edited: false, pinned: false } });
  });
  it("protected brief → BRIEF_PROTECTED; force → replaced", () => {
    const kit = fixtureKit();
    kit.company_brief.meta = { origin: "generated", edited: true, pinned: false };
    expect(() => mergeBrief(kit, brief)).toThrow(BuilderError);
    expect(() => mergeBrief(kit, brief)).toThrow(expect.objectContaining({ code: "BRIEF_PROTECTED" }));
    expect(mergeBrief(kit, brief, { force: true }).company_brief.summary).toBe("New");
  });
});
