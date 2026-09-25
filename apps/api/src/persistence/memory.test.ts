import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "./memory.ts";
import { DuplicateKeyError, type KitDoc } from "./types.ts";

const kit = (over: Partial<KitDoc> = {}): KitDoc => ({
  _id: "k1", userId: "u1", status: "queued", input: { jd: "jd", company_url: "https://a.test", days: 3 }, inputHash: "h1",
  progress: [], kit: null, error: null, researchCache: null, version: 0, createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

describe("memory repos (same contract as Mongo)", () => {
  it("unique email and unique (userId, inputHash)", async () => {
    const r = createMemoryRepos();
    await r.users.create({ _id: "u1", email: "a@x.test", passwordHash: "h", createdAt: new Date() });
    await expect(r.users.create({ _id: "u2", email: "a@x.test", passwordHash: "h", createdAt: new Date() })).rejects.toBeInstanceOf(DuplicateKeyError);
    await r.kits.insert(kit());
    await expect(r.kits.insert(kit({ _id: "k2" }))).rejects.toBeInstanceOf(DuplicateKeyError);
    await r.kits.insert(kit({ _id: "k3", userId: "u2" })); // same hash, other user: fine
  });

  it("owned get, list newest-first without heavy fields, update sets updatedAt, delete is scoped", async () => {
    let clock = 1000;
    const r = createMemoryRepos(() => clock);
    await r.kits.insert(kit({ progress: [{ step: "x", status: "done" }] }));
    await r.kits.insert(kit({ _id: "k2", inputHash: "h2" }));
    expect(await r.kits.get("u2", "k1")).toBeNull();
    clock = 5000;
    await r.kits.update("k1", { status: "done" });
    await r.kits.update("missing", { status: "done" }); // no-op
    const list = await r.kits.list("u1");
    expect(list.map((k) => k._id)).toEqual(["k1", "k2"]);
    expect(list[0]).not.toHaveProperty("progress");
    expect(list[0].updatedAt.getTime()).toBe(5000);
    expect(await r.kits.delete("u2", "k1")).toBe(false);
    expect(await r.kits.delete("u1", "k1")).toBe(true);
    expect((await r.kits.findByStatus(["queued"])).map((k) => k._id)).toEqual(["k2"]);
  });

  it("returns copies, not live references", async () => {
    const r = createMemoryRepos();
    await r.kits.insert(kit());
    const k = (await r.kits.getById("k1"))!;
    k.status = "done";
    expect((await r.kits.getById("k1"))!.status).toBe("queued");
  });
});
