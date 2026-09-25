import type { Kit } from "@prepkit/shared";
import type { KitInput, KitRepo } from "../persistence/types.ts";
import { PipelineError, type PipelineResult } from "../pipeline/runPipeline.ts";
import type { ProgressEvent } from "../pipeline/trace.ts";

export type RunFn = (input: KitInput, onProgress: (e: ProgressEvent) => void) => Promise<PipelineResult>;
export type JobQueue = { enqueue(id: string): void };

/**
 * Background generation: a FIFO queue drained by `concurrency` workers, all sharing the process's one LLM client.
 * ponytail: in-process queue, single instance; move to a persistent queue (BullMQ/Agenda) for multiple instances.
 */
export class JobRunner implements JobQueue {
  private readonly queue: string[] = [];
  private readonly pending = new Set<string>();
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly kits: KitRepo,
    private readonly run: RunFn,
    private readonly opts: { concurrency?: number; progressIntervalMs?: number; now?: () => number } = {},
  ) {}

  enqueue(id: string): void {
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(id);
    this.pump();
  }

  /** Resolves once the queue is empty and no job is running (tests, graceful shutdown). */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private pump(): void {
    while (this.active < (this.opts.concurrency ?? 2) && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      this.process(id)
        .catch((e) => console.error(`job ${id}: could not record its outcome`, e))
        .finally(() => {
          this.pending.delete(id);
          this.active--;
          this.pump();
          if (this.active === 0 && this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r());
        });
    }
  }

  private async process(id: string): Promise<void> {
    const doc = await this.kits.getById(id);
    if (!doc || doc.status !== "queued") return; // deleted, or already handled
    await this.kits.update(id, { status: "running", progress: [], error: null });

    // Progress goes to the DB at most once per interval (in order); the final state is always written below.
    const now = this.opts.now ?? Date.now;
    const interval = this.opts.progressIntervalMs ?? 1000;
    const progress: ProgressEvent[] = [];
    let lastWrite = 0;
    let writes = Promise.resolve();
    const onProgress = (e: ProgressEvent) => {
      progress.push(e);
      if (now() - lastWrite < interval) return;
      lastWrite = now();
      const snapshot = [...progress];
      writes = writes.then(() => this.kits.update(id, { progress: snapshot })).catch((err) => console.error(`job ${id}: progress write failed`, err));
    };

    try {
      const result = await this.run(doc.input, onProgress);
      await writes;
      await this.kits.update(id, { status: "done", kit: result.kit as Kit, researchCache: result.researchCache, version: 1, progress, error: null });
    } catch (e) {
      await writes;
      if (!(e instanceof PipelineError)) console.error(`job ${id}: unexpected failure`, e);
      const error = e instanceof PipelineError ? { code: e.code, message: e.message } : { code: "INTERNAL", message: "Unexpected error while generating the kit" };
      await this.kits.update(id, { status: "failed", progress, error });
    }
  }
}
