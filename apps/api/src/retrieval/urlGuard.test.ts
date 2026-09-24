import { describe, expect, it } from "vitest";
import { assertFetchable, normalizeCompanyUrl } from "./urlGuard.ts";

const guard = (url: string, addresses?: string[]) =>
  assertFetchable(new URL(url), {
    allowPrivate: false,
    lookup: async () => (addresses ?? []).map((address) => ({ address })),
  });

describe("normalizeCompanyUrl", () => {
  it("adds https to bare hosts", () => expect(normalizeCompanyUrl(" example.com ").href).toBe("https://example.com/"));
  it("rejects ftp", () => expect(() => normalizeCompanyUrl("ftp://x")).toThrow(expect.objectContaining({ code: "INVALID_URL" })));
  it("rejects credentials", () =>
    expect(() => normalizeCompanyUrl("https://u:p@example.com")).toThrow(expect.objectContaining({ code: "INVALID_URL" })));
  it("rejects garbage", () => expect(() => normalizeCompanyUrl("http://")).toThrow(expect.objectContaining({ code: "INVALID_URL" })));
});

describe("assertFetchable", () => {
  it.each([
    "http://10.0.0.1/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[fe80::1]/",
  ])("blocks literal %s", async (url) => {
    await expect(guard(url)).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("allows a public IP", async () => {
    await expect(guard("http://93.184.216.34/")).resolves.toBeUndefined();
  });

  it("blocks a hostname if ANY resolved address is private", async () => {
    await expect(guard("http://sneaky.example/", ["93.184.216.34", "10.1.2.3"])).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("allows a hostname resolving only to public addresses", async () => {
    await expect(guard("http://ok.example/", ["93.184.216.34", "2606:2800:220:1::1"])).resolves.toBeUndefined();
  });

  it("allowPrivate skips the check", async () => {
    await expect(assertFetchable(new URL("http://127.0.0.1/"), { allowPrivate: true })).resolves.toBeUndefined();
  });
});
