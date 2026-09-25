// Usage: npm run pipeline:smoke -w @prepkit/api -- --jd <file.txt> --url <companyUrl>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { LLMClient, providersFromConfig } from "../llm/client.ts";
import { crawlCompany } from "../retrieval/crawl.ts";
import { fetchPage } from "../retrieval/fetchPage.ts";
import { searchInterviewDiscussion } from "../retrieval/search.ts";
import { companyBrief } from "./steps/companyBrief.ts";
import { extractAndResearch } from "./steps/research.ts";
import { summarizeHiringProcess } from "./steps/summarizeHiringProcess.ts";
import { createTrace, type PipelineDeps } from "./trace.ts";

const { values } = parseArgs({ options: { jd: { type: "string" }, url: { type: "string" } } });
if (!values.jd || !values.url) {
  console.log("Usage: pipeline:smoke -- --jd <file.txt> --url <companyUrl>");
  process.exit(1);
}
// npm runs workspace scripts from apps/api; resolve the JD path from where npm was invoked.
const jd = readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), values.jd), "utf8");
const companyUrl = values.url;

const providers = providersFromConfig(config);
if (providers.length === 0) {
  console.log("No LLM provider configured: set GROQ_API_KEY and/or GEMINI_API_KEY in .env.");
  process.exit(0);
}

const started = Date.now();
const { trace, onProgress } = createTrace();
const deps: PipelineDeps = {
  llm: new LLMClient({
    providers,
    timeoutMs: config.LLM_TIMEOUT_MS,
    onEvent: (e) => console.log(`  llm event: ${JSON.stringify(e).slice(0, 200)}`),
  }),
  crawl: crawlCompany,
  search: searchInterviewDiscussion,
  fetchPage,
  now: Date.now,
  onProgress,
};

const { extraction, research } = await extractAndResearch({ jd, companyUrl }, deps);
const [hiring, brief] = await Promise.all([
  summarizeHiringProcess(research, deps),
  companyBrief({ research, jd, companyUrl }, deps),
]);

const x = extraction.extraction;
console.log(`\n== ROLE: ${x.title} | seniority: ${x.seniority || "-"} | location: ${x.location || "-"} | company in JD: ${x.company ?? "-"}`);
console.log(`== COMPANY: ${research.companyName} (from ${research.companyNameSource}) | reachable: ${research.reachable}`);
console.log(`\n== REQUIREMENTS (${extraction.requirements.length})`);
for (const r of extraction.requirements) {
  console.log(`  ${r.id.padEnd(4)} ${r.priority.padEnd(5)} ${r.kind.padEnd(12)} ${r.text}`);
  console.log(`       evidence: "${r.evidence}"`);
}
console.log(`\n== WARNINGS`);
for (const w of [...extraction.warnings, ...research.warnings]) console.log(`  - ${w}`);
console.log(`\n== HIRING PAGES: ${research.hiringPages.map((p) => `${p.url} (${p.origin}, content=${p.contentScore})`).join(", ") || "none"}`);
console.log(`== DISCUSSION: ${research.discussion.length} third-party result(s)`);
for (const d of research.discussion) {
  console.log(`  [${d.attribution}${d.usedForSummary ? "" : ", NOT used for summary"}] ${d.url}`);
}
if (hiring) {
  const on = Object.entries(hiring.signals).filter(([, v]) => v).map(([k]) => k);
  console.log(`== HIRING PROCESS: signals: ${on.join(", ") || "none"}`);
  for (const s of hiring.stages) console.log(`  - ${s.name}: ${s.description}`);
  if (hiring.notes) console.log(`  notes: ${hiring.notes}`);
  console.log(`  sources: ${hiring.sources.join(", ")}`);
} else {
  console.log("== HIRING PROCESS: none (no sources)");
}
console.log(`\n== BRIEF\n  summary: ${brief.summary}\n  what_they_do: ${brief.what_they_do}\n  sources: ${JSON.stringify(brief.sources)}`);
console.log(`\n== TRACE (${((Date.now() - started) / 1000).toFixed(1)}s total)`);
for (const e of trace) {
  if (e.status === "started") continue;
  const llm = e.llm ? `  [${e.llm.provider}/${e.llm.model}, ${e.llm.tokens} tok${e.llm.repaired ? ", repaired" : ""}]` : "";
  console.log(`  ${e.step.padEnd(26)} ${e.status.padEnd(8)} ${e.ms !== undefined ? `${e.ms}ms`.padStart(7) : "       "}  ${e.detail ?? ""}${llm}`);
}
