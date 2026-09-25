import { describe, expect, it } from "vitest";
import { body, fakeRun } from "./fakes.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import type { KitDoc } from "../persistence/types.ts";
import { JobRunner, type RunFn } from "./runner.ts";

describe("JobRunner", () => {
  const doc = (id: string, status: KitDoc["status"], createdAt = 0): KitDoc => ({
    _id: id, userId: "u", status, input: body, inputHash: id, progress: [], kit: null, error: null, researchCache: null, version: 0,
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
  });

  it("throttles progress writes to one per interval, always writing the final state; concurrency 2", async () => {
    const repos = createMemoryRepos();
    const writes: number[] = [];
    const update = repos.kits.update.bind(repos.kits);
    repos.kits.update = async (id, patch) => {
      if (patch.progress && !patch.status) writes.push(patch.progress.length);
      return update(id, patch);
    };
    let running = 0;
    let peak = 0;
    const run: RunFn = async (input, onProgress) => {
      peak = Math.max(peak, ++running);
      for (let i = 0; i < 20; i++) onProgress({ step: `s${i}`, status: "done" });
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return fakeRun(input, () => {});
    };
    for (const id of ["a", "b", "c"]) await repos.kits.insert(doc(id, "queued"));
    const runner = new JobRunner(repos.kits, run, { progressIntervalMs: 60_000 });
    ["a", "b", "c"].forEach((id) => runner.enqueue(id));
    await runner.idle();
    expect(writes).toEqual([1, 1, 1]); // first event only, per job, within the interval
    expect((await repos.kits.getById("a"))!.progress).toHaveLength(20); // final write has everything
    expect(peak).toBe(2);
  });
});
