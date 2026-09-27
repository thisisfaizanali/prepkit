import type { Response } from "supertest";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { parseCookies, SESSION_TTL_MS } from "../auth/session.ts";
import { createMemoryRepos } from "../persistence/memory.ts";
import { createApp } from "./app.ts";
import { client, serve } from "./testApp.ts";

const noJobs = { enqueue: () => {} };

function setup() {
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const repos = createMemoryRepos(() => clock);
  const app = serve(createApp({ repos, jobs: noJobs, now: () => clock, authRateLimit: 100 }));
  return { app, repos, agent: client(app), advance: (ms: number) => (clock += ms) };
}
const creds = { email: "Ada@Example.test", password: "correct horse" };
const setCookie = (res: Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []).join("\n");

describe("password + cookie helpers", () => {
  it("scrypt hash round-trips, rejects wrong passwords and garbage", async () => {
    const h = await hashPassword("s3cret-pass");
    expect(h).toMatch(/^scrypt\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("s3cret-pass", h)).toBe(true);
    expect(await verifyPassword("wrong-pass", h)).toBe(false);
    expect(await verifyPassword("x", "bcrypt$nope")).toBe(false);
    expect(await hashPassword("s3cret-pass")).not.toBe(h); // random salt
  });

  it("parses cookie headers", () => {
    expect(parseCookies("a=1; prepkit_session=abc%3D; a=2; bad")).toEqual({ a: "1", prepkit_session: "abc=" });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("auth routes", () => {
  it("register → me → logout → me 401", async () => {
    const { agent, repos } = setup();
    const reg = await agent.post("/api/auth/register").send(creds).expect(201);
    expect(reg.body.user.email).toBe("ada@example.test");
    expect(setCookie(reg)).toMatch(/prepkit_session=[^;]+; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax/);
    const token = /prepkit_session=([^;]+)/.exec(setCookie(reg))![1];
    expect(await repos.sessions.find(token)).toBeNull(); // only the hash is stored
    expect((await agent.get("/api/auth/me").expect(200)).body.user.email).toBe("ada@example.test");
    await agent.post("/api/auth/logout").expect(204);
    const me = await agent.get("/api/auth/me").expect(401);
    expect(me.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("login: right password → cookie; wrong password or unknown email → the same generic 401", async () => {
    const { app } = setup();
    await client(app).post("/api/auth/register").send(creds).expect(201);
    const ok = await client(app).post("/api/auth/login").send({ ...creds, email: " ADA@example.test " }).expect(200);
    expect(setCookie(ok)).toContain("prepkit_session=");
    const wrong = await client(app).post("/api/auth/login").send({ ...creds, password: "wrong password" }).expect(401);
    const unknown = await client(app).post("/api/auth/login").send({ ...creds, email: "nobody@example.test" }).expect(401);
    expect(wrong.body).toEqual({ error: { code: "INVALID_CREDENTIALS", message: "invalid email or password" } });
    expect(unknown.body).toEqual(wrong.body);
  });

  it("duplicate email → 409", async () => {
    const { app } = setup();
    await client(app).post("/api/auth/register").send(creds).expect(201);
    const dup = await client(app).post("/api/auth/register").send({ ...creds, email: "ada@example.TEST" }).expect(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("expired session → 401 and the cookie is cleared", async () => {
    const { agent, advance } = setup();
    await agent.post("/api/auth/register").send(creds).expect(201);
    advance(SESSION_TTL_MS + 1);
    const res = await agent.get("/api/auth/me").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(setCookie(res)).toMatch(/prepkit_session=; Path=\/; Expires=Thu, 01 Jan 1970/);
  });

  it("invalid body → 400 VALIDATION_ERROR with details; bad JSON → 400; unknown route → 404", async () => {
    const { app } = setup();
    const res = await client(app).post("/api/auth/register").send({ email: "not-an-email", password: "short" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["email", "password"]);
    const bad = await client(app).post("/api/auth/login").set("content-type", "application/json").send("{nope").expect(400);
    expect(bad.body.error).toEqual({ code: "VALIDATION_ERROR", message: "Request body is not valid JSON" });
    expect((await client(app).get("/api/nope").expect(404)).body.error.code).toBe("NOT_FOUND");
  });

  it("rate limits login/register per IP", async () => {
    const app = serve(createApp({ jobs: noJobs, repos: createMemoryRepos(), authRateLimit: 2 }));
    for (let i = 0; i < 2; i++) await client(app).post("/api/auth/login").send(creds).expect(401);
    const limited = await client(app).post("/api/auth/login").send(creds).expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("health is public; secure cookie in production", async () => {
    await client(serve(createApp({ jobs: noJobs, repos: createMemoryRepos() }))).get("/api/health").expect(200, { ok: true });
    const prod = serve(createApp({ jobs: noJobs, repos: createMemoryRepos(), production: true }));
    expect(setCookie(await client(prod).post("/api/auth/register").send(creds).expect(201))).toContain("; Secure");
  });
});
