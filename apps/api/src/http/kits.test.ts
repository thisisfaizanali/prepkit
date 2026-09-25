import request from "supertest";
import { describe, expect, it } from "vitest";
import { body, fakeRun } from "../jobs/fakes.ts";
import { JobRunner, type RunFn } from "../jobs/runner.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import { PipelineError } from "../pipeline/runPipeline.ts";
import { createApp } from "./app.ts";
import { inputHash } from "./kits.ts";

function setup(run: RunFn = fakeRun) {
  const repos = createMemoryRepos();
  const runner = new JobRunner(repos.kits, run);
  const app = createApp({ repos, jobs: runner, authRateLimit: 100 });
  const user = async (email: string) => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123" }).expect(201);
    return agent;
  };
  return { app, repos, runner, user };
}

describe("kit endpoints", () => {
  it("require a session", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/kits").expect(401)).body.error.code).toBe("UNAUTHENTICATED");
  });

  it("POST → 202 queued → job runs → GET shows done with kit + progress, without researchCache", async () => {
    const { user, runner, repos } = setup();
    const a = await user("a@x.test");
    const created = await a.post("/api/kits").send(body).expect(202);
    expect(created.body).toEqual({ id: expect.any(String), status: "queued", duplicate: false });
    await runner.idle();
    const kit = (await a.get(`/api/kits/${created.body.id}`).expect(200)).body;
    expect(kit).toMatchObject({ id: created.body.id, status: "done", version: 1, error: null, input: body });
    expect(kit.kit.source.company).toBe("Acme");
    expect(kit.progress.map((e: { status: string }) => e.status)).toEqual(["started", "done"]);
    expect(kit).not.toHaveProperty("researchCache");
    expect((await repos.kits.getById(created.body.id))!.researchCache!.pages).toHaveLength(1); // stored, just not served
    const list = (await a.get("/api/kits").expect(200)).body.kits;
    expect(list).toEqual([expect.objectContaining({ id: created.body.id, status: "done", company: "Acme", role: "Backend Engineer", days: 3, counts: { requirements: 1, questions: 1, flashcards: 0 } })]);
  });

  it("user B can't GET/DELETE/retry user A's kit (404); lists are per user", async () => {
    const { user, runner } = setup();
    const a = await user("a@x.test");
    const b = await user("b@x.test");
    const { id } = (await a.post("/api/kits").send(body).expect(202)).body;
    await runner.idle();
    expect((await b.get(`/api/kits/${id}`).expect(404)).body.error.code).toBe("NOT_FOUND");
    await b.delete(`/api/kits/${id}`).expect(404);
    await b.post(`/api/kits/${id}/retry`).expect(404);
    expect((await b.get("/api/kits").expect(200)).body.kits).toEqual([]);
    expect((await a.get("/api/kits").expect(200)).body.kits).toHaveLength(1);
    await a.delete(`/api/kits/${id}`).expect(204);
    await a.get(`/api/kits/${id}`).expect(404);
  });

  it("same JD (different whitespace) + same URL → duplicate with the same id; days don't matter", async () => {
    const { user } = setup();
    const a = await user("a@x.test");
    const first = (await a.post("/api/kits").send(body).expect(202)).body;
    const again = await a.post("/api/kits").send({ jd: "  Backend engineer.   Must know\tGo.\n", company_url: "HTTPS://ACME.test/", days: 7 }).expect(200);
    expect(again.body).toEqual({ id: first.id, status: expect.any(String), duplicate: true });
    expect(inputHash("u", "a  b", "https://x.test")).toBe(inputHash("u", "a b\n", "x.test"));
    expect(inputHash("u", "a b", "x.test")).not.toBe(inputHash("other", "a b", "x.test"));
  });

  it("two concurrent identical POSTs → one kit", async () => {
    const { user, repos } = setup();
    const a = await user("a@x.test");
    const [r1, r2] = await Promise.all([a.post("/api/kits").send(body), a.post("/api/kits").send(body)]);
    expect(r1.body.id).toBe(r2.body.id);
    expect([r1.body.duplicate, r2.body.duplicate].sort()).toEqual([false, true]);
    expect(await repos.kits.findByStatus(["queued", "running", "done"])).toHaveLength(1);
  });

  it("pipeline failure → failed with the structured error; unexpected errors don't leak details", async () => {
    const { user, runner } = setup();
    const a = await user("a@x.test");
    const failed = (await a.post("/api/kits").send({ ...body, jd: "FAIL please" }).expect(202)).body;
    const crashed = (await a.post("/api/kits").send({ ...body, jd: "CRASH please" }).expect(202)).body;
    await runner.idle();
    expect((await a.get(`/api/kits/${failed.id}`)).body).toMatchObject({ status: "failed", kit: null, error: { code: "LLM_RATE_LIMITED", message: "All LLM providers are rate limited" } });
    const c = (await a.get(`/api/kits/${crashed.id}`)).body;
    expect(c.error).toEqual({ code: "INTERNAL", message: "Unexpected error while generating the kit" });
    expect((await a.get("/api/kits")).body.kits.map((k: { status: string }) => k.status)).toEqual(["failed", "failed"]);
  });

  it("failed kit → POST again re-queues it (with the new days); /retry re-queues; retrying a done kit → 409", async () => {
    let fail = true;
    const { user, runner } = setup((input, p) => (fail ? Promise.reject(new PipelineError("TIMEOUT", "slow")) : fakeRun(input, p)));
    const a = await user("a@x.test");
    const { id } = (await a.post("/api/kits").send(body).expect(202)).body;
    await runner.idle();
    const again = await a.post("/api/kits").send({ ...body, days: 5 }).expect(202);
    expect(again.body).toEqual({ id, status: "queued", duplicate: true, retried: true });
    await runner.idle();
    expect((await a.get(`/api/kits/${id}`)).body).toMatchObject({ status: "failed", input: { days: 5 } });
    fail = false;
    expect((await a.post(`/api/kits/${id}/retry`).expect(202)).body).toEqual({ id, status: "queued" });
    await runner.idle();
    expect((await a.get(`/api/kits/${id}`)).body).toMatchObject({ status: "done", error: null });
    expect((await a.post(`/api/kits/${id}/retry`).expect(409)).body.error.code).toBe("NOT_RETRYABLE");
  });

  it("invalid bodies → 400 VALIDATION_ERROR with details", async () => {
    const { user } = setup();
    const a = await user("a@x.test");
    const res = await a.post("/api/kits").send({ jd: "   ", company_url: "", days: 0 }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["jd", "company_url", "days"]);
    await a.post("/api/kits").send({ ...body, days: 2.5 }).expect(400);
    await a.post("/api/kits/batch").send({ cases: Array.from({ length: 11 }, () => body) }).expect(400);
  });

  it("batch: per-case results, identical cases dedupe", async () => {
    const { user, runner } = setup();
    const a = await user("a@x.test");
    const res = await a.post("/api/kits/batch").send({ cases: [body, { ...body, company_url: "https://globex.test" }, { ...body, days: 9 }] }).expect(202);
    const [x, y, z] = res.body.results;
    expect([x.duplicate, y.duplicate, z.duplicate]).toEqual([false, false, true]);
    expect(z.id).toBe(x.id);
    await runner.idle();
    expect((await a.get("/api/kits")).body.kits).toHaveLength(2);
  });
});
