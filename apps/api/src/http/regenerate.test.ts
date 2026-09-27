import type { BuilderKit } from "@prepkit/shared";
import { describe, expect, it } from "vitest";
import type { CompleteRequest } from "../llm/client.ts";
import { scriptedLLM } from "../pipeline/fakes.ts";
import { setupBuilder } from "./testApp.ts";

/** scriptedLLM whose question calls wait until `release()`: a slow generator to race edits against. */
function slowLLM() {
  const llm = scriptedLLM({ company_brief: { summary: "Fresh summary.", what_they_do: "Fresh." } });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const running = new Promise<void>((r) => (started = r));
  return {
    llm: {
      calls: llm.calls,
      complete: async (req: CompleteRequest) => {
        if (req.label.startsWith("questions:")) {
          started();
          await gate;
        }
        return llm.complete(req);
      },
    },
    release,
    running,
  };
}

describe("POST /api/kits/:id/regenerate, questions", () => {
  it("THE race: edits made during a regeneration survive; unprotected questions are replaced; version bumps twice", async () => {
    const slow = slowLLM();
    const { a, id, kit, regen } = await setupBuilder({ llm: slow.llm });
    const before = await kit();
    expect(before.version).toBe(1);
    const q1 = before.kit.questions.find((q) => q.id === "q1")!;

    const started = await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).expect(202);
    expect(started.body.regeneration).toMatchObject({ section: "questions", category: "technical", status: "running" });
    await slow.running; // the generator is mid-flight

    await a
      .patch(`/api/kits/${id}/ops`)
      .send({ ops: [{ op: "question.update", id: "q1", patch: { prompt: "My rewrite of q1" }, snapshot: q1 }, { op: "brief.update", patch: { summary: "My brief" } }] })
      .expect(200);
    slow.release();
    await regen!.idle();

    const after = await kit();
    expect(after.version).toBe(3); // the edit, then the merge
    expect(after.regeneration).toMatchObject({ status: "done", summary: { kept: 0, passes: [{ pass: 1, uncovered: [] }] } });
    const technical = after.kit.questions.filter((q) => q.category === "technical");
    expect(technical.find((q) => q.id === "q1")).toMatchObject({ prompt: "My rewrite of q1", meta: { edited: true } });
    expect(technical.find((q) => q.id === "q2")).toBeUndefined(); // unprotected → replaced
    expect(technical.filter((q) => q.id !== "q1").map((q) => q.id)).toEqual(["q5", "q6", "q7"]); // fresh ids
    expect(after.kit.company_brief).toMatchObject({ summary: "My brief", meta: { edited: true } });
    expect(after.kit.questions.filter((q) => q.category !== "technical")).toEqual(before.kit.questions.filter((q) => q.category !== "technical"));
    expect(after.kit.schedule_stale).toBe(true);
  });

  it("kept questions are sent as 'do not duplicate' context", async () => {
    const slow = slowLLM();
    slow.release();
    const { a, id, kit, regen } = await setupBuilder({ llm: slow.llm });
    await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.pin", id: "q2", pinned: true }] }).expect(200);
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).expect(202);
    await regen!.idle();
    expect(slow.llm.calls.find((c) => c.label === "questions:technical")!.user).toContain("- Generated technical question q2");
    expect((await kit()).regeneration).toMatchObject({ status: "done", summary: { kept: 1 } });
  });

  it("an edit arriving AFTER the regeneration removed its question is re-inserted as edited", async () => {
    const slow = slowLLM();
    slow.release();
    const { a, id, kit, regen } = await setupBuilder({ llm: slow.llm });
    const q2 = (await kit()).kit.questions.find((q) => q.id === "q2")!; // the client's stale copy
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).expect(202);
    await regen!.idle();
    expect((await kit()).kit.questions.some((q) => q.id === "q2")).toBe(false);

    const res = await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.update", id: "q2", patch: { prompt: "Keep my SQL question" }, snapshot: q2 }] }).expect(200);
    expect(res.body.kit.questions.find((q: { id: string }) => q.id === "q2")).toMatchObject({ prompt: "Keep my SQL question", category: "technical", meta: { edited: true } });
  });

  it("a second concurrent regeneration → 409; company-fit for an unknown company → 422; missing category → 400", async () => {
    const slow = slowLLM();
    const { a, id, repos, kit, regen } = await setupBuilder({ llm: slow.llm });
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).expect(202);
    const busy = await a.post(`/api/kits/${id}/regenerate`).send({ section: "brief" }).expect(409);
    expect(busy.body.error.code).toBe("REGENERATION_IN_PROGRESS");
    slow.release();
    await regen!.idle();

    const k = (await kit()).kit;
    await repos.kits.update(id, { kit: { ...k, source: { ...k.source, company: "Unknown" }, company_brief: { ...k.company_brief, sources: [] } } as BuilderKit });
    const none = await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "company-fit" }).expect(422);
    expect(none.body.error).toMatchObject({ code: "NOTHING_TO_GENERATE", message: expect.stringContaining("company is unknown") });
    const bad = await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions" }).expect(400);
    expect(bad.body.error.details[0].path).toBe("category");
  });

  it("generation failure → regeneration failed with a code, kit untouched", async () => {
    const failing = { complete: () => Promise.reject(Object.assign(new Error("quota"), { code: "LLM_RATE_LIMITED" })) };
    const { a, id, kit, regen } = await setupBuilder({ llm: failing });
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).expect(202);
    await regen!.idle();
    const after = await kit();
    expect(after.regeneration).toMatchObject({ status: "failed", error: { code: "LLM_RATE_LIMITED" } });
    expect(after.version).toBe(1);
    expect(after.kit.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });
});

describe("POST /api/kits/:id/regenerate, brief and schedule", () => {
  it("protected brief without force → 409; with force → replaced from stored pages only", async () => {
    const slow = slowLLM();
    slow.release();
    const { a, id, kit, regen } = await setupBuilder({ llm: slow.llm });
    await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "brief.pin", pinned: true }] }).expect(200);
    expect((await a.post(`/api/kits/${id}/regenerate`).send({ section: "brief" }).expect(409)).body.error.code).toBe("BRIEF_PROTECTED");
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "brief", force: true }).expect(202);
    await regen!.idle();
    const after = await kit();
    expect(after.regeneration).toMatchObject({ section: "brief", status: "done" });
    expect(after.kit.company_brief.meta).toEqual({ origin: "generated", edited: false, pinned: false });
    expect(after.kit.company_brief.summary).not.toBe("Acme makes anvils.");
  });

  it("schedule: synchronous, exact day counts for 1 and 60, clears schedule_stale", async () => {
    const { a, id } = await setupBuilder();
    const del = await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.delete", id: "q2" }] }).expect(200);
    expect(del.body.kit.schedule_stale).toBe(true);
    for (const days of [1, 60]) {
      const res = await a.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days }).expect(200);
      expect(res.body.kit.schedule.days).toHaveLength(days);
      expect(res.body.kit.schedule.days_available).toBe(days);
      expect(res.body.kit.schedule_stale).toBe(false);
    }
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 91 }).expect(400);
    const same = await a.post(`/api/kits/${id}/regenerate`).send({ section: "schedule" }).expect(200);
    expect(same.body.kit.schedule.days).toHaveLength(60); // defaults to the current days_available
  });
});

describe("POST /api/kits/:id/regenerate, gaps", () => {
  it("delete every question covering must r1 → uncovered → regenerate gaps → covered; summary shows the passes", async () => {
    const llm = scriptedLLM({});
    const { a, id, kit, regen } = await setupBuilder({ llm });
    const del = await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.delete", id: "q1" }, { op: "question.delete", id: "q3" }] }).expect(200);
    expect(del.body.kit.coverage.uncovered_requirement_ids).toEqual(["r1"]);

    const res = await a.post(`/api/kits/${id}/regenerate`).send({ section: "gaps" }).expect(202);
    expect(res.body.regeneration).toMatchObject({ section: "gaps", status: "running" });
    await regen!.idle();
    const after = await kit();
    expect(after.kit.coverage).toEqual({ uncovered_requirement_ids: [], passes: 2 });
    expect(after.regeneration).toMatchObject({
      status: "done",
      summary: { passes: [{ pass: 1, uncovered: ["r1"] }, { pass: 2, uncovered: [] }], added: 1, fallback: 0 },
    });
    const added = after.kit.questions.find((q) => q.id === "q5")!;
    expect(added).toMatchObject({ category: "technical", requirement_ids: ["r1"], meta: { origin: "generated" } });
    expect(llm.calls.map((c) => c.label)).toEqual(["gap:technical"]);
  });

  it("the model never covers must r3 → deterministic fallback after 3 passes", async () => {
    const llm = scriptedLLM({}, { skip: ["r3"] });
    const { a, id, kit, regen } = await setupBuilder({ llm });
    await a.patch(`/api/kits/${id}/ops`).send({ ops: [{ op: "question.delete", id: "q4" }] }).expect(200);
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "gaps" }).expect(202);
    await regen!.idle();
    const after = await kit();
    expect(after.kit.coverage).toEqual({ uncovered_requirement_ids: [], passes: 3 });
    expect(after.regeneration).toMatchObject({ summary: { fallback: 1, passes: [{ uncovered: ["r3"] }, { uncovered: ["r3"] }, { uncovered: ["r3"] }] } });
    expect(after.kit.questions.find((q) => (q as { fallback?: boolean }).fallback)).toMatchObject({ category: "behavioural", requirement_ids: ["r3"] });
  });
});
