import { describe, expect, it } from "vitest";
import { LLMClient, LLMError, parseDuration, type LLMEvent, type Provider } from "./client.ts";

const groq: Provider = { name: "groq", baseUrl: "https://groq.test", apiKey: "k1", model: "m1", tpm: 100_000 };
const gemini: Provider = { name: "gemini", baseUrl: "https://gemini.test", apiKey: "k2", model: "m2", tpm: 100_000 };

const ok = (text = "hi", total_tokens = 10) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens } }), { status: 200 });
const err = (status: number, headers: Record<string, string> = {}) => new Response("nope", { status, headers });

/** Fake fetch: hands out queued responses per provider baseUrl and logs calls. */
function setup(queues: Record<string, (Response | Error)[]>, providers = [groq, gemini]) {
  let clock = 0;
  const sleeps: number[] = [];
  const events: LLMEvent[] = [];
  const calls: { url: string; body: any }[] = [];
  const client = new LLMClient({
    providers,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0,
    onEvent: (e) => events.push(e),
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const next = queues[new URL(String(url)).origin].shift();
      if (!next) throw new Error(`no queued response for ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, sleeps, events, calls, advance: (ms: number) => (clock += ms) };
}

const req = { system: "sys", user: "user", label: "test" };

describe("parseDuration", () => {
  it.each([
    ["7.66s", 7660],
    ["1m2.5s", 62_500],
    ["450ms", 450],
    ["2", 2000],
  ])("%s → %i ms", (input, ms) => expect(parseDuration(input)).toBe(ms));

  it("rejects garbage", () => expect(parseDuration("soon")).toBeUndefined());
});

describe("LLMClient", () => {
  it("returns text, provider, model and usage; json sets response_format", async () => {
    const t = setup({ "https://groq.test": [ok("{}", 42)] });
    expect(await t.client.complete({ ...req, json: true })).toEqual({
      text: "{}", provider: "groq", model: "m1", usage: { total_tokens: 42 },
    });
    expect(t.calls[0].url).toBe("https://groq.test/chat/completions");
    expect(t.calls[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("sends reasoning_effort only when the provider sets it", async () => {
    const t = setup({ "https://groq.test": [ok()], "https://gemini.test": [ok()] }, [{ ...groq, reasoningEffort: "low" }]);
    await t.client.complete(req);
    expect(t.calls[0].body.reasoning_effort).toBe("low");
    const u = setup({ "https://groq.test": [ok()] }, [groq]);
    await u.client.complete(req);
    expect(u.calls[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("429 with retry-after: 2 → waits 2000ms then succeeds", async () => {
    const t = setup({ "https://groq.test": [err(429, { "retry-after": "2" }), ok()] });
    expect((await t.client.complete(req)).provider).toBe("groq");
    expect(t.sleeps).toEqual([2000]);
    expect(t.events).toContainEqual(expect.objectContaining({ type: "rate_limited", provider: "groq", waitMs: 2000 }));
  });

  it("uses Groq reset headers when there is no retry-after", async () => {
    const t = setup({ "https://groq.test": [err(429, { "x-ratelimit-reset-tokens": "7.66s" }), ok()] });
    await t.client.complete(req);
    expect(t.sleeps).toEqual([7660]);
  });

  it("503 ×5 on groq → falls back to gemini with a fallback event", async () => {
    const t = setup({ "https://groq.test": Array.from({ length: 5 }, () => err(503)), "https://gemini.test": [ok()] });
    expect((await t.client.complete(req)).provider).toBe("gemini");
    expect(t.calls.filter((c) => c.url.startsWith("https://groq.test"))).toHaveLength(5);
    expect(t.sleeps).toEqual([1000, 2000, 4000, 8000]); // backoff, no sleep after the last attempt
    expect(t.events).toContainEqual(expect.objectContaining({ type: "fallback", from: "groq", to: "gemini" }));
  });

  it("network errors are retried", async () => {
    const t = setup({ "https://groq.test": [new TypeError("fetch failed"), ok()] });
    expect((await t.client.complete(req)).provider).toBe("groq");
    expect(t.sleeps).toEqual([1000]);
  });

  it("429 with retry-after 3600 → falls back immediately without sleeping", async () => {
    const t = setup({ "https://groq.test": [err(429, { "retry-after": "3600" })], "https://gemini.test": [ok()] });
    expect((await t.client.complete(req)).provider).toBe("gemini");
    expect(t.sleeps).toEqual([]);
  });

  it("400 → no retry on that provider", async () => {
    const t = setup({ "https://groq.test": [err(400)], "https://gemini.test": [ok()] });
    expect((await t.client.complete(req)).provider).toBe("gemini");
    expect(t.calls.filter((c) => c.url.startsWith("https://groq.test"))).toHaveLength(1);
    expect(t.sleeps).toEqual([]);
  });

  it.each([
    [[429, 429], "LLM_RATE_LIMITED"],
    [[400, 401], "LLM_BAD_REQUEST"],
    [[503, 503], "LLM_UNAVAILABLE"],
  ])("all providers exhausted (%j) → %s", async ([a, b], code) => {
    const many = (s: number) => Array.from({ length: 5 }, () => err(s, s === 429 ? { "retry-after": "3600" } : {}));
    const t = setup({ "https://groq.test": many(a), "https://gemini.test": many(b) });
    const e = await t.client.complete(req).catch((x) => x);
    expect(e).toBeInstanceOf(LLMError);
    expect(e.code).toBe(code);
  });

  it("no providers → clear LLM_UNAVAILABLE error at call time", async () => {
    const e = await setup({}, []).client.complete(req).catch((x) => x);
    expect(e).toMatchObject({ code: "LLM_UNAVAILABLE" });
    expect(e.message).toContain("GROQ_API_KEY");
  });

  it("pacer: tpm 1000, 900 tokens used → a 200-token call waits for the window to free", async () => {
    const small = { ...groq, tpm: 1000 };
    const t = setup({ "https://groq.test": [ok("a", 900), ok("b", 200)] }, [small]);
    await t.client.complete({ system: "", user: "", maxTokens: 900, label: "first" });
    t.advance(15_000);
    await t.client.complete({ system: "", user: "", maxTokens: 200, label: "second" });
    expect(t.sleeps).toEqual([45_000]);
  });
});
