import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CompleteRequest } from "./client.ts";
import { generateJson } from "./json.ts";

const schema = z.object({ ok: z.boolean(), echo: z.string() });

/** Stub client that returns queued texts and records requests. */
function stub(...texts: string[]) {
  const requests: CompleteRequest[] = [];
  return {
    requests,
    client: {
      complete: async (r: CompleteRequest) => {
        requests.push(r);
        return { text: texts.shift()!, provider: "groq", model: "m", usage: { total_tokens: 5 } };
      },
    },
  };
}
const req = { system: "sys", user: "say hi", schema, label: "t" };

describe("generateJson", () => {
  it("valid first time → no repair", async () => {
    const s = stub('{"ok":true,"echo":"hi"}');
    expect(await generateJson(s.client, req)).toMatchObject({ data: { ok: true, echo: "hi" }, repaired: false });
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0].json).toBe(true);
  });

  it("parses fenced JSON", async () => {
    const s = stub('```json\n{"ok":false,"echo":"x"}\n```');
    expect((await generateJson(s.client, req)).data).toEqual({ ok: false, echo: "x" });
  });

  it("invalid then repaired → one repair call with the bad output and errors", async () => {
    const s = stub('{"ok":"yes"}', '{"ok":true,"echo":"fixed"}');
    const r = await generateJson(s.client, req);
    expect(r).toMatchObject({ data: { ok: true, echo: "fixed" }, repaired: true, usage: { total_tokens: 10 } });
    expect(s.requests).toHaveLength(2);
    expect(s.requests[1].user).toContain('{"ok":"yes"}');
    expect(s.requests[1].user).toMatch(/- ok: /);
    expect(s.requests[1].user).toMatch(/- echo: /);
  });

  it("invalid twice → LLM_INVALID_OUTPUT with the errors", async () => {
    const s = stub("not json", '{"ok":1}');
    const e = await generateJson(s.client, req).catch((x) => x);
    expect(e).toMatchObject({ code: "LLM_INVALID_OUTPUT" });
    expect(e.message).toContain("ok:");
    expect(s.requests).toHaveLength(2);
  });
});
