import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostLimiter } from "./fetchPage.ts";
import { closedPort, startFixtureSite, type FixtureSite } from "./fixtureSite.ts";
import { Robots } from "./robots.ts";

let site: FixtureSite;
beforeAll(async () => (site = await startFixtureSite()));
afterAll(() => site.close());

const opts = () => ({ allowPrivate: true, limiter: new HostLimiter(2, 0), sleep: async () => {} });

describe("Robots", () => {
  it("applies disallow rules at the origin root even for a path-scoped start", async () => {
    const robots = new Robots(opts());
    expect(await robots.isAllowed(`${site.base}/acme/`)).toBe(true);
    expect(await robots.isAllowed(`${site.base}/acme/internal/`)).toBe(false);
    expect(site.hits).toContain("/robots.txt");
  });

  it("caches per origin", async () => {
    const robots = new Robots(opts());
    const before = site.hits.filter((h) => h === "/robots.txt").length;
    await robots.isAllowed(`${site.base}/a`);
    await robots.isAllowed(`${site.base}/b`);
    expect(site.hits.filter((h) => h === "/robots.txt").length - before).toBe(1);
  });

  it("unreachable robots.txt → disallow all, with the problem reported", async () => {
    const origin = `http://127.0.0.1:${await closedPort()}`;
    const robots = new Robots(opts());
    expect(await robots.isAllowed(`${origin}/anything`)).toBe(false);
    expect(await robots.problem(origin)).toMatchObject({ code: "UNREACHABLE" });
  });
});
