import type { BuilderKit, Op } from "@prepkit/shared";
import { ApiError } from "../api";
import { begin, emptyQueue, enqueue, ack, fail, unsaved, type Queue } from "./queue";

export type SaveStatus = "saved" | "saving" | "retrying" | "offline";
export type Snapshot = { queue: Queue; status: SaveStatus; error: string | null };
export type Saved = { kit: BuilderKit; version: number };

type Deps = {
  /** PATCH the ops. Must go through the query client so a 401 reaches the global session handler. */
  send: (ops: Op[]) => Promise<Saved>;
  /** Fire-and-forget send that survives the page closing. */
  sendOnExit: (ops: Op[]) => void;
  onSaved: (saved: Saved) => void;
  /** The server refused the batch (400/409): the query should be reloaded from the server. */
  onRejected: () => void;
};

const DEBOUNCE_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** Owns the op queue for one kit: debounced flushing, one request at a time, retry with backoff, offline waits. */
export class BuilderStore {
  private snap: Snapshot = { queue: emptyQueue, status: "saved", error: null };
  private listeners = new Set<() => void>();
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1000;

  constructor(private deps: Deps) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  enqueue = (op: Op) => {
    this.set({ queue: enqueue(this.snap.queue, op), error: null });
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  };

  dismissError = () => this.set({ error: null });

  flush = async () => {
    clearTimeout(this.debounce);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (unsaved(this.snap.queue)) this.set({ status: "offline" });
      return;
    }
    const started = begin(this.snap.queue);
    if (!started) return;
    clearTimeout(this.retry);
    this.set({ queue: started.queue, status: "saving" });
    try {
      const saved = await this.deps.send(started.batch);
      this.backoff = 1000;
      this.deps.onSaved(saved);
      this.set({ queue: ack(this.snap.queue) });
      if (this.snap.queue.pending.length) void this.flush();
      else this.set({ status: "saved" });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 0 || status >= 500 || status === 401) {
        this.set({ queue: fail(this.snap.queue, true), status: navigator.onLine ? "retrying" : "offline" });
        if (status !== 401) this.retry = setTimeout(() => void this.flush(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        return;
      }
      // 400 (the change was invalid) or 409 (conflict, not ready): drop the batch and show the server's state again.
      this.set({ queue: fail(this.snap.queue, false), error: e instanceof Error ? `Couldn't save that change: ${e.message}` : "Couldn't save that change." });
      this.deps.onRejected();
      if (this.snap.queue.pending.length) void this.flush();
      else this.set({ status: "saved" });
    }
  };

  /** The page is going away: send whatever is waiting now, even if a request is still out. */
  flushOnExit = () => {
    clearTimeout(this.debounce);
    const { pending } = this.snap.queue;
    if (!pending.length) return;
    this.deps.sendOnExit(pending);
  };

  dispose() {
    clearTimeout(this.debounce);
    clearTimeout(this.retry);
  }
}
