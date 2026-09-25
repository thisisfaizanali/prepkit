import { applyOps, type BuilderKit } from "@prepkit/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { body } from "../jobs/fakes.ts";
import { setupBuilder } from "./testApp.ts";

describe("PATCH /api/kits/:id/ops", () => {
  it("applies ops, bumps the version, and persists; the owner sees it, another user gets 404", async () => {
    const { a, id, kit, user } = await setupBuilder();
    const q1 = (await kit()).kit.questions[0];
    const res = await a
      .patch(`/api/kits/${id}/ops`)
      .send({ ops: [{ op: "question.update", id: "q1", patch: { prompt: "My own wording" }, snapshot: q1 }, { op: "brief.update", patch: { summary: "My summary" } }] })
      .expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.kit.questions[0]).toMatchObject({ prompt: "My own wording", meta: { edited: true } });
    const saved = await kit();
    expect(saved.version).toBe(2);
    expect(saved.kit.company_brief).toMatchObject({ summary: "My summary", meta: { edited: true } });

    const b = await user("b@x.test");
    await b.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.delete", id: "q1" }] }).expect(404);
    expect((await kit()).kit.questions).toHaveLength(4);
  });

  it("invalid ops → 400 VALIDATION_ERROR with details; unauthenticated → 401", async () => {
    const { a, id, app } = await setupBuilder();
    const bad = await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.update", id: "q1", patch: { difficulty: 9 } }] }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.body.error.details.length).toBeGreaterThan(0);
    await a.patch(`/api/kits/${id}/ops`).send({ ops: Array.from({ length: 201 }, () => ({ op: "question.delete", id: "x" })) }).expect(400);
    await request(app).patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "brief.pin", pinned: true }] }).expect(401);
  });

  it("a kit that isn't done yet → 409 NOT_READY", async () => {
    const { a, repos } = await setupBuilder();
    const userId = (await a.get("/api/auth/me")).body.user.id;
    const at = new Date();
    await repos.kits.insert({ _id: "pending", userId, status: "queued", input: body, inputHash: "h", progress: [], kit: null, error: null, researchCache: null, version: 0, createdAt: at, updatedAt: at });
    const res = await a.patch("/api/kits/pending/ops").send({ ops: [{ op: "brief.pin", pinned: true }] }).expect(409);
    expect(res.body.error.code).toBe("NOT_READY");
  });

  it("lost compare-and-swap → reloads and re-applies onto the newer kit (both changes kept)", async () => {
    const { a, id, repos, kit } = await setupBuilder();
    const cas = repos.kits.casKit.bind(repos.kits);
    let raced = false;
    repos.kits.casKit = async (userId, kitId, version, k, extra) => {
      if (!raced) {
        raced = true; // someone else saves a brief edit first
        const current = (await repos.kits.getById(kitId))!;
        await cas(userId, kitId, current.version, applyOps(current.kit as BuilderKit, [{ op: "brief.update", patch: { summary: "Theirs" } }]));
      }
      return cas(userId, kitId, version, k, extra);
    };
    const q2 = (await kit()).kit.questions[1];
    const res = await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.update", id: "q2", patch: { prompt: "Mine" }, snapshot: q2 }] }).expect(200);
    expect(res.body.version).toBe(3);
    const saved = await kit();
    expect(saved.kit.company_brief.summary).toBe("Theirs");
    expect(saved.kit.questions[1].prompt).toBe("Mine");
  });
});
