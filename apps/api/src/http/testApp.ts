// Test-only: an app on in-memory repos with one registered user and one finished kit.
import type { BuilderKit } from "@prepkit/shared";
import request from "supertest";
import { body, fakeRun } from "../jobs/fakes.ts";
import { Regenerator, type GenerationDeps } from "../jobs/regenerate.ts";
import { JobRunner, type RunFn } from "../jobs/runner.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import type { Regeneration } from "../persistence/types.ts";
import { createApp } from "./app.ts";

/** `llm` backs section regeneration (e.g. scriptedLLM); omitted → regeneration's LLM is unavailable. */
export async function setupBuilder({ run = fakeRun, llm }: { run?: RunFn; llm?: GenerationDeps["llm"] } = {}) {
  const repos = createMemoryRepos();
  const runner = new JobRunner(repos.kits, run);
  const regen = llm ? new Regenerator(repos.kits, { llm, now: Date.now }) : undefined;
  const app = createApp({ repos, jobs: runner, regen, authRateLimit: 100 });
  const user = async (email: string) => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123" }).expect(201);
    return agent;
  };
  const a = await user("a@x.test");
  const { id } = (await a.post("/api/kits").send(body).expect(202)).body;
  await runner.idle();
  const kit = async () => (await a.get(`/api/kits/${id}`).expect(200)).body as { kit: BuilderKit; version: number; regeneration: Regeneration | null };
  return { app, repos, runner, regen, user, a, id, kit };
}
