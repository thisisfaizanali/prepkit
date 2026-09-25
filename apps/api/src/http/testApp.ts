// Test-only: an app on in-memory repos with one registered user and one finished kit.
import type { BuilderKit } from "@prepkit/shared";
import request from "supertest";
import { body, fakeRun } from "../jobs/fakes.ts";
import { JobRunner, type RunFn } from "../jobs/runner.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import { createApp, type AppDeps } from "./app.ts";

export async function setupBuilder(run: RunFn = fakeRun) {
  const repos = createMemoryRepos();
  const runner = new JobRunner(repos.kits, run);
  const app = createApp({ repos, jobs: runner, authRateLimit: 100 });
  const user = async (email: string) => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123" }).expect(201);
    return agent;
  };
  const a = await user("a@x.test");
  const { id } = (await a.post("/api/kits").send(body).expect(202)).body;
  await runner.idle();
  const kit = async () => (await a.get(`/api/kits/${id}`).expect(200)).body as { kit: BuilderKit; version: number; regeneration: unknown };
  return { app, repos, runner, user, a, id, kit };
}
