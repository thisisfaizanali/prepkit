// Serves the fake companies in this folder on http://localhost:8099 (like the grader's local fixture sites).
// Usage: npm run fixtures   → http://localhost:8099/acme/  and  http://localhost:8099/globex/
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.FIXTURES_PORT ?? 8099);

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = normalize(join(ROOT, path, path.endsWith("/") ? "index.html" : ""));
  if (!file.startsWith(ROOT) || !file.endsWith(".html") || file.split(sep).includes("..")) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  } else {
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  }
  console.log(`${res.statusCode} ${req.method} ${req.url}`);
}).listen(PORT, () => console.log(`Fixture companies on http://localhost:${PORT}/acme/ and http://localhost:${PORT}/globex/`));
