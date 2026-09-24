import { describe, expect, it } from "vitest";
import { extractContent } from "./clean.ts";

describe("extractContent", () => {
  const html = `<html><head><title> Acme  Careers </title><meta property="og:description" content="Join Acme"></head><body>
    <nav>Main navigation <a href="about/">About</a></nav>
    <header>Site header</header>
    <main><h1>Jobs</h1><p>We are   hiring.</p><p>Second paragraph.</p>
      <a href="jobs/1#apply">Backend engineer</a>
      <a href="jobs/1"></a>
      <a href="#top">Top</a>
      <a href="mailto:jobs@acme.test">Email</a><a href="tel:123">Call</a><a href="javascript:void(0)">JS</a>
      <a href="ftp://acme.test/file">FTP</a>
      <a href="https://other.test/x" aria-label="Other site"></a>
      <script>var tracking = 1;</script>
    </main>
    <footer>Footer text <a href="/legal">Legal</a></footer></body></html>`;
  const out = extractContent(html, "https://acme.test/careers/");

  it("title and description", () => {
    expect(out.title).toBe("Acme Careers");
    expect(out.description).toBe("Join Acme");
  });

  it("resolves relative links, strips fragments, drops non-http, dedupes keeping first text", () => {
    expect(out.links).toEqual([
      { url: "https://acme.test/careers/about/", text: "About" },
      { url: "https://acme.test/careers/jobs/1", text: "Backend engineer" },
      { url: "https://acme.test/careers/", text: "Top" },
      { url: "https://other.test/x", text: "Other site" },
      { url: "https://acme.test/legal", text: "Legal" },
    ]);
  });

  it("text comes from <main>, without nav/header/footer/script, with paragraph breaks", () => {
    expect(out.text).toContain("Jobs\nWe are hiring.\nSecond paragraph.");
    for (const noise of ["Main navigation", "Site header", "Footer text", "tracking"]) expect(out.text).not.toContain(noise);
  });

  it("honours <base href>", () => {
    const r = extractContent('<html><head><base href="https://cdn.acme.test/root/"></head><body><a href="page">P</a></body></html>', "https://acme.test/x/");
    expect(r.links).toEqual([{ url: "https://cdn.acme.test/root/page", text: "P" }]);
  });

  it("caps text at 20,000 chars", () => {
    expect(extractContent(`<body><p>${"a ".repeat(30_000)}</p></body>`, "https://a.test/").text.length).toBe(20_000);
  });
});
