import { describe, expect, it } from "vitest";
import { validateKit } from "../validate.ts";
import { fixtureKit, q } from "./fixture.ts";
import { applyOps, OpSchema, type Op } from "./ops.ts";

const kit = fixtureKit();
const snap = (id: string) => structuredClone(kit.questions.find((x) => x.id === id)!);
const ids = (k: ReturnType<typeof fixtureKit>) => k.questions.map((x) => x.id);
const EDITED = { origin: "generated", edited: true, pinned: false };

describe("applyOps: questions", () => {
  it("update applies the patch and marks edited; input untouched; output valid", () => {
    const out = applyOps(kit, [{ op: "question.update", id: "q2", patch: { prompt: "Better?", difficulty: 3 }, snapshot: snap("q2") }]);
    expect(out.questions[1]).toMatchObject({ id: "q2", prompt: "Better?", difficulty: 3, meta: EDITED });
    expect(kit.questions[1].prompt).toBe("Prompt q2");
    expect(validateKit(out).ok).toBe(true);
  });

  it("update of a question a regeneration removed → the snapshot is re-inserted with the patch, as edited", () => {
    const gone = applyOps(kit, [{ op: "question.delete", id: "q2" }]);
    const out = applyOps(gone, [{ op: "question.update", id: "q2", patch: { prompt: "Still mine" }, snapshot: snap("q2") }]);
    expect(ids(out)).toEqual(["q1", "q2", "q3", "q4"]); // back in the technical run
    expect(out.questions[1]).toMatchObject({ prompt: "Still mine", meta: EDITED });
  });

  it("add: user origin at its category's slot; re-applying is a no-op", () => {
    const add: Op = { op: "question.add", question: { ...q("qu-abcd1234", "behavioural", ["r3"]), prompt: "Mine" } };
    const out = applyOps(applyOps(kit, [add]), [add]);
    expect(ids(out)).toEqual(["q1", "q2", "q3", "q4", "qu-abcd1234"]);
    expect(out.questions.at(-1)!.meta).toEqual({ origin: "user", edited: false, pinned: false });
    expect(out.schedule_stale).toBe(true); // not in the schedule yet
  });

  it("delete removes, prunes the schedule and recomputes coverage; a missing id is a no-op", () => {
    const out = applyOps(kit, [{ op: "question.delete", id: "q4" }, { op: "question.delete", id: "nope" }]);
    expect(ids(out)).toEqual(["q1", "q2", "q3"]);
    expect(out.coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(out.schedule.days[1].question_ids).toEqual(["q2"]);
    expect(out.id_seq).toEqual({ q: 4, f: 2 }); // seeded before the delete
  });

  it("move: before another question, across categories, and to the end of a category's run (beforeId null)", () => {
    const before = applyOps(kit, [{ op: "question.move", id: "q2", beforeId: "q1", snapshot: snap("q2") }]);
    expect(ids(before)).toEqual(["q2", "q1", "q3", "q4"]);
    expect(before.questions[0].meta).toEqual(EDITED);

    const across = applyOps(kit, [{ op: "question.move", id: "q1", category: "behavioural", beforeId: null, snapshot: snap("q1") }]);
    expect(across.questions.map((x) => [x.id, x.category])).toEqual([["q2", "technical"], ["q3", "system-design"], ["q4", "behavioural"], ["q1", "behavioural"]]);

    const endOfRun = applyOps(kit, [{ op: "question.move", id: "q1", beforeId: null, snapshot: snap("q1") }]);
    expect(ids(endOfRun)).toEqual(["q2", "q1", "q3", "q4"]);
  });

  it("move of a missing id re-inserts the snapshot", () => {
    const gone = applyOps(kit, [{ op: "question.delete", id: "q3" }]);
    const out = applyOps(gone, [{ op: "question.move", id: "q3", beforeId: "q1", snapshot: snap("q3") }]);
    expect(ids(out)).toEqual(["q3", "q1", "q2", "q4"]);
    expect(out.questions[0].meta).toEqual(EDITED);
  });

  it("pin sets meta.pinned; pin of a missing id is a no-op", () => {
    const out = applyOps(kit, [{ op: "question.pin", id: "q1", pinned: true }, { op: "question.pin", id: "zz", pinned: true }]);
    expect(out.questions[0].meta).toEqual({ origin: "generated", edited: false, pinned: true });
  });
});

describe("applyOps: flashcards and brief", () => {
  const fsnap = (id: string) => structuredClone(kit.flashcards.find((x) => x.id === id)!);
  it("update / add / move / pin / delete follow the same rules", () => {
    let out = applyOps(kit, [
      { op: "flashcard.update", id: "f1", patch: { back: "Compiled language" }, snapshot: fsnap("f1") },
      { op: "flashcard.add", flashcard: { id: "fu-abcd1234", front: "Mine", back: "Yes", requirement_ids: ["r3", "r99"] } },
      { op: "flashcard.move", id: "f2", beforeId: "f1", snapshot: fsnap("f2") },
      { op: "flashcard.pin", id: "f1", pinned: true },
    ]);
    expect(out.flashcards.map((f) => f.id)).toEqual(["f2", "f1", "fu-abcd1234"]);
    expect(out.flashcards[1]).toMatchObject({ back: "Compiled language", meta: { origin: "generated", edited: true, pinned: true } });
    expect(out.flashcards[2]).toMatchObject({ requirement_ids: ["r3"], meta: { origin: "user" } }); // dangling r99 pruned
    out = applyOps(out, [{ op: "flashcard.delete", id: "f2" }, { op: "flashcard.update", id: "f2", patch: { front: "Back?" }, snapshot: fsnap("f2") }]);
    expect(out.flashcards.find((f) => f.id === "f2")).toMatchObject({ front: "Back?", meta: { edited: true } });
  });

  it("brief.update marks edited; brief.pin pins", () => {
    const out = applyOps(kit, [{ op: "brief.update", patch: { summary: "Mine" } }, { op: "brief.pin", pinned: true }]);
    expect(out.company_brief).toMatchObject({ summary: "Mine", what_they_do: "Anvils.", meta: { origin: "generated", edited: true, pinned: true } });
  });
});

describe("OpSchema", () => {
  it("rejects unknown ops, unknown patch fields and badly formed user ids", () => {
    expect(OpSchema.safeParse({ op: "question.explode", id: "q1" }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "question.update", id: "q1", patch: { category: "technical" }, snapshot: snap("q1") }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "question.add", question: q("q9", "technical", []) }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "question.update", id: "q1", patch: { difficulty: 5 }, snapshot: snap("q1") }).success).toBe(false);
  });
});
