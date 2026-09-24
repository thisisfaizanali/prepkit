// Test-only: a small company site served under /acme/ on 127.0.0.1.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="${title} description"></head>` +
  `<body><nav><a href="/acme/">Home</a> Navigation menu</nav>${body}<footer>Footer boilerplate © Acme</footer></body></html>`;

const pages: Record<string, string> = {
  "/acme/": page(
    "Acme",
    `<main><h1>Acme builds anvils</h1><p>We make the best anvils.</p>
      <a href="about/">About us</a>
      <a href="company/life/">Life at Acme</a>
      <a href="legal/privacy">Privacy</a>
      <a href="join/">Careers</a>
      <a href="/globex/">Our friends at Globex careers</a>
      <a href="team/">Meet the team</a>
      <a href="internal/">Internal team wiki</a>
      <a href="docs/brochure.pdf">About brochure</a>
    </main>`,
  ),
  "/acme/about/": page("About Acme", "<main><p>Acme was founded in 1949. Our mission is anvils for everyone.</p></main>"),
  "/acme/company/life/": page(
    "Life at Acme",
    `<main><p>Our interview process has four stages. After a recruiter screen you get a take-home exercise,
      then a technical interview and a system design interview during the onsite.</p></main>`,
  ),
  "/acme/legal/privacy": page("Privacy", "<main><p>We respect your privacy.</p></main>"),
  "/acme/join/": page("Careers at Acme", "<main><p>Open roles: Backend Engineer.</p></main>"),
  "/acme/internal/": page("Internal", "<main><p>Secret.</p></main>"),
  "/acme/handbook/hiring/": page("Hiring handbook", "<main><p>How we hire at Acme: the hiring process, step by step.</p></main>"),
  "/globex/": page("Globex", "<main><p>Globex careers</p></main>"),
};

export type FixtureSite = { base: string; hits: string[]; close: () => Promise<void> };

export async function startFixtureSite(): Promise<FixtureSite> {
  const hits: string[] = [];
  let flaky = 0;
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url!, "http://x").pathname;
    hits.push(path);
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    if (pages[path]) return send(200, "text/html; charset=utf-8", pages[path]);
    switch (path) {
      case "/robots.txt":
        return send(200, "text/plain", "User-agent: *\nDisallow: /acme/internal/\n");
      case "/acme/sitemap.xml":
        return send(
          200,
          "application/xml",
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>http://${req.headers.host}/acme/about/</loc></url>
            <url><loc>http://${req.headers.host}/acme/handbook/hiring/</loc></url></urlset>`,
        );
      case "/acme/huge": {
        res.writeHead(200, { "content-type": "text/html" }); // chunked, no content-length
        const chunk = "x".repeat(64 * 1024);
        for (let i = 0; i < 48; i++) res.write(chunk); // 3 MB
        return res.end();
      }
      case "/acme/binary":
        return send(200, "application/octet-stream", "\u0000\u0001");
      case "/acme/r":
        return send(302, "text/plain", "", { location: "http://169.254.169.254/latest/meta-data" });
      case "/acme/go":
        return send(301, "text/plain", "", { location: "about/" });
      case "/acme/flaky":
        return ++flaky <= 2 ? send(503, "text/plain", "busy") : send(200, "text/html", page("Flaky", "<p>ok now</p>"));
      default:
        return send(404, "text/html", page("Not found", "<p>404</p>"));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A port that was open a moment ago and is now closed. */
export async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
