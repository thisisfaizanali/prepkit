// Test-only: an app on in-memory repos with one registered user and one finished kit.
import { Agent, type Server } from "node:http";
import type { BuilderKit } from "@prepkit/shared";
import request from "supertest";
import { afterAll } from "vitest";
import { body, fakeRun } from "../jobs/fakes.ts";
import { Regenerator, type GenerationDeps } from "../jobs/regenerate.ts";
import { JobRunner, type RunFn } from "../jobs/runner.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import type { Regeneration } from "../persistence/types.ts";
import { createApp } from "./app.ts";

/**
 * Tests talk to one listening server per app over reused keep-alive connections, all torn down once after the
 * file. supertest's default (a new server and TCP connection per request, closed right after) churns loopback
 * sockets fast enough to abort the worker on Windows (silent 0xC0000409 from libuv socket teardown).
 */
const keepAlive = new Agent({ keepAlive: true });
const servers: Server[] = [];
export function serve(app: ReturnType<typeof createApp>): Server {
  const server = app.listen(0);
  servers.push(server);
  return server;
}
afterAll(async () => {
  keepAlive.destroy(); // client side first, so the server has no live connections left to close
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
/** A cookie-keeping client on `server` (use a fresh one for "no session"). */
export const client = (server: Server) => request.agent(server).use((req: request.Test) => void req.agent(keepAlive));

/** `llm` backs section regeneration (e.g. scriptedLLM); omitted → regeneration's LLM is unavailable. */
export async function setupBuilder({ run = fakeRun, llm }: { run?: RunFn; llm?: GenerationDeps["llm"] } = {}) {
  const repos = createMemoryRepos();
  const runner = new JobRunner(repos.kits, run);
  const regen = llm ? new Regenerator(repos.kits, { llm, now: Date.now }) : undefined;
  const app = serve(createApp({ repos, jobs: runner, regen, authRateLimit: 100 }));
  const user = async (email: string) => {
    const agent = client(app);
    await agent.post("/api/auth/register").send({ email, password: "password123" }).expect(201);
    return agent;
  };
  const a = await user("a@x.test");
  const { id } = (await a.post("/api/kits").send(body).expect(202)).body;
  await runner.idle();
  const kit = async () => (await a.get(`/api/kits/${id}`).expect(200)).body as { kit: BuilderKit; version: number; regeneration: Regeneration | null };
  return { app, repos, runner, regen, user, a, id, kit };
}
