import type { KitRepo } from "../persistence/types.ts";
import type { JobQueue } from "./runner.ts";

/** After a restart: queued kits are re-enqueued; running ones lost their worker, so they fail with INTERRUPTED. */
export async function recoverJobs(kits: KitRepo, queue: JobQueue): Promise<{ requeued: number; interrupted: number }> {
  const stuck = await kits.findByStatus(["queued", "running"]);
  const running = stuck.filter((k) => k.status === "running");
  for (const k of running) {
    await kits.update(k._id, {
      status: "failed",
      error: { code: "INTERRUPTED", message: "Generation was interrupted by a server restart — retry to continue" },
    });
  }
  const queued = stuck.filter((k) => k.status === "queued").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const k of queued) queue.enqueue(k._id);
  return { requeued: queued.length, interrupted: running.length };
}
