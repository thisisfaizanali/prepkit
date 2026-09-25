import type { KitRepo } from "../persistence/types.ts";
import type { JobQueue } from "./runner.ts";

/** After a restart: queued kits are re-enqueued; running ones (and running regenerations) lost their worker, so they fail with INTERRUPTED. */
export async function recoverJobs(kits: KitRepo, queue: JobQueue): Promise<{ requeued: number; interrupted: number; regenerationsInterrupted: number }> {
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
  // A section regeneration's worker died too; the kit itself is intact (merges are all-or-nothing).
  const regenerationsInterrupted = await kits.failRunningRegenerations(
    { code: "INTERRUPTED", message: "Regeneration was interrupted by a server restart — run it again" },
    new Date(),
  );
  return { requeued: queued.length, interrupted: running.length, regenerationsInterrupted };
}
