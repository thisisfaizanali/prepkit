import type { Op, Question } from "@prepkit/shared";
import { describe, expect, it } from "vitest";
import { fixtureKit } from "../../../../../packages/shared/src/builder/fixture.ts";
import { ack, begin, emptyQueue, enqueue, fail, localKit, type Queue } from "./queue";

const kit = fixtureKit();
const snap = (id: string) => kit.questions.find((q) => q.id === id)!;
const update = (id: string, patch: Partial<Question>): Op => ({ op: "question.update", id, patch, snapshot: { ...snap(id), ...patch } });
const ids = (k: typeof kit) => k.questions.map((q) => q.id);

describe("builder queue", () => {
  it("applies enqueued ops optimistically", () => {
    const q = enqueue(emptyQueue, update("q1", { prompt: "New" }));
    const local = localKit(kit, q);
    expect(local.questions[0]).toMatchObject({ prompt: "New", meta: { edited: true } });
    expect(kit.questions[0].prompt).toBe("Prompt q1"); // server kit untouched
  });

  it("coalesces updates of the same item, keeping the latest snapshot", () => {
    let q = enqueue(emptyQueue, update("q1", { prompt: "A" }));
    q = enqueue(q, update("q2", { prompt: "other" }));
    q = enqueue(q, update("q1", { difficulty: 3 }));
    expect(q.pending).toHaveLength(2);
    expect(q.pending[0]).toMatchObject({ id: "q1", patch: { prompt: "A", difficulty: 3 }, snapshot: { difficulty: 3 } });
  });

  it("doesn't coalesce across another op on the same item, or into the in-flight batch", () => {
    let q = enqueue(emptyQueue, update("q1", { prompt: "A" }));
    q = enqueue(q, { op: "question.delete", id: "q1" });
    q = enqueue(q, update("q1", { prompt: "B" }));
    expect(q.pending.map((o) => o.op)).toEqual(["question.update", "question.delete", "question.update"]);

    const sent = begin(enqueue(emptyQueue, update("q2", { prompt: "A" })))!.queue;
    expect(enqueue(sent, update("q2", { prompt: "B" })).pending).toHaveLength(1);
  });

  it("rebases unacknowledged ops onto a newer server kit", () => {
    const q = enqueue(emptyQueue, { op: "question.move", id: "q4", category: "technical", beforeId: "q1", snapshot: snap("q4") });
    // Meanwhile a regeneration replaced q2 with q9 on the server.
    const newer = { ...kit, questions: [...kit.questions.filter((x) => x.id !== "q2"), { ...snap("q2"), id: "q9" }] };
    expect(ids(localKit(newer, q))).toEqual(["q4", "q1", "q3", "q9"]);
  });

  it("drops acknowledged ops and keeps ones enqueued during the request", () => {
    let q: Queue = enqueue(emptyQueue, update("q1", { prompt: "A" }));
    const started = begin(q)!;
    expect(started.batch).toHaveLength(1);
    expect(begin(started.queue)).toBeNull(); // one request at a time
    q = enqueue(started.queue, update("q2", { prompt: "B" }));
    q = ack(q);
    expect(q).toEqual({ inflight: null, pending: [expect.objectContaining({ id: "q2" })] });
  });

  it("keeps a failed batch in front of later ops, in order; a rejected batch is dropped", () => {
    const first = enqueue(emptyQueue, { op: "question.delete", id: "q2" });
    let q = enqueue(begin(first)!.queue, update("q1", { prompt: "B" }));
    expect(fail(q, true).pending.map((o) => o.op)).toEqual(["question.delete", "question.update"]);
    q = fail(q, false);
    expect(q.pending.map((o) => o.op)).toEqual(["question.update"]);
  });
});
