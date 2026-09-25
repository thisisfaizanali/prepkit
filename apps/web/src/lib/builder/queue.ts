import { applyOps, type BuilderKit, type Op } from "@prepkit/shared";

/**
 * The builder's op queue, as pure functions. The server kit lives in the query cache; this only tracks what hasn't
 * been acknowledged yet: `inflight` (the one request being sent) and `pending` (waiting for the next flush).
 * The local kit is always server kit + inflight + pending, via the same applyOps the server runs, so a newer server
 * kit (e.g. a regeneration finished) is simply rebased under whatever is still unacknowledged.
 */
export type Queue = { inflight: Op[] | null; pending: Op[] };
export const emptyQueue: Queue = { inflight: null, pending: [] };

type UpdateOp = Extract<Op, { op: "question.update" | "flashcard.update" | "brief.update" }>;
const isUpdate = (op: Op): op is UpdateOp => op.op === "question.update" || op.op === "flashcard.update" || op.op === "brief.update";
function idOf(op: Op): string {
  if ("id" in op) return op.id;
  if (op.op === "question.add") return op.question.id;
  if (op.op === "flashcard.add") return op.flashcard.id;
  return "brief";
}

/**
 * Append an op. An update merges into a still-unsent update of the same item (latest snapshot wins), as long as no
 * other op for that item sits between them: merging across a delete or move would change the outcome.
 */
export function enqueue(q: Queue, op: Op): Queue {
  if (isUpdate(op)) {
    const at = q.pending.findLastIndex((p) => idOf(p) === idOf(op));
    const prev = at >= 0 ? q.pending[at] : null;
    if (prev && prev.op === op.op) {
      const merged = { ...prev, ...op, patch: { ...prev.patch, ...op.patch } } as Op;
      return { ...q, pending: q.pending.with(at, merged) };
    }
  }
  return { ...q, pending: [...q.pending, op] };
}

/** Start sending: everything pending becomes the in-flight batch. Null when there's nothing to send or a request is out. */
export function begin(q: Queue): { queue: Queue; batch: Op[] } | null {
  if (q.inflight || q.pending.length === 0) return null;
  return { queue: { inflight: q.pending, pending: [] }, batch: q.pending };
}

/** The server applied the batch: it's part of the server kit now. */
export const ack = (q: Queue): Queue => ({ ...q, inflight: null });

/** The batch wasn't saved. Retryable: it goes back in front of anything enqueued meanwhile. Rejected (400): dropped. */
export const fail = (q: Queue, retry: boolean): Queue => ({ inflight: null, pending: retry && q.inflight ? [...q.inflight, ...q.pending] : q.pending });

export const unsaved = (q: Queue) => (q.inflight?.length ?? 0) + q.pending.length;

export function localKit<K extends BuilderKit>(server: K, q: Queue): K {
  const ops = [...(q.inflight ?? []), ...q.pending];
  return ops.length ? applyOps(server, ops) : server;
}
