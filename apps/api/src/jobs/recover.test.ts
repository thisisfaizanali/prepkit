import { describe, expect, it } from "vitest";
import { body, fakeRun } from "./fakes.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import type { KitDoc } from "../persistence/types.ts";
import { recoverJobs } from "./recover.ts";
import { JobRunner } from "./runner.ts";

describe("recoverJobs", () => {
  const doc = (id: string, status: KitDoc["status"], createdAt = 0): KitDoc => ({
    _id: id, userId: "u", status, input: body, inputHash: id, progress: [], kit: null, error: null, researchCache: null, version: 0,
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
  });

  it("startup recovery: running → failed INTERRUPTED; queued → re-enqueued and run", async () => {
    const repos = createMemoryRepos();
    await repos.kits.insert(doc("running1", "running"));
    await repos.kits.insert(doc("queued1", "queued"));
    await repos.kits.insert({ ...doc("done1", "done"), regeneration: { section: "brief", status: "running", startedAt: new Date(0) } });
    const runner = new JobRunner(repos.kits, fakeRun);
    expect(await recoverJobs(repos.kits, runner)).toEqual({ requeued: 1, interrupted: 1, regenerationsInterrupted: 1 });
    await runner.idle();
    expect((await repos.kits.getById("running1"))!).toMatchObject({
      status: "failed",
      error: { code: "INTERRUPTED", message: "Generation was interrupted by a server restart — retry to continue" },
    });
    expect((await repos.kits.getById("queued1"))!.status).toBe("done");
    expect((await repos.kits.getById("done1"))!).toMatchObject({ status: "done", regeneration: { status: "failed", error: { code: "INTERRUPTED" } } });
  });

});
