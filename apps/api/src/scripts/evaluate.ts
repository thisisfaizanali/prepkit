// Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Kit } from "@prepkit/shared";
import { config } from "../config.ts";
import { createPipelineDeps } from "../pipeline/deps.ts";
import { runBatch } from "../pipeline/runBatch.ts";
import { runPipeline } from "../pipeline/runPipeline.ts";

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

let values: { input?: string; output?: string; concurrency?: string };
try {
  ({ values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, concurrency: { type: "string", default: "2" } } }));
} catch (e) {
  fail(`${e instanceof Error ? e.message : e}\nUsage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]`);
}
if (!values!.input || !values!.output) fail("Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]");
const inputPath = resolve(process.cwd(), values!.input!);
const outputPath = resolve(process.cwd(), values!.output!);
const concurrency = Number(values!.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1) fail(`--concurrency must be a positive integer, got "${values!.concurrency}"`);

let cases: unknown;
try {
  cases = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (e) {
  fail(`Could not read ${inputPath}: ${e instanceof Error ? e.message : e}`);
}
if (!Array.isArray(cases)) fail(`${inputPath} must contain a JSON array of cases`);
const list = cases as unknown[];

// One set of deps (one LLM client) for the whole batch, so every case shares the same pacing windows.
const deps = createPipelineDeps(config, {
  onLLMEvent: (e) => {
    if (e.type !== "rate_limited" || e.waitMs > 5000) console.error(`  [llm] ${e.type} ${JSON.stringify(e).slice(0, 160)}`);
  },
});

const started = Date.now();
const timing = new Map<string, number>();
const write = (data: unknown) => {
  const tmp = `${outputPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, outputPath); // atomic: an interrupted run leaves the last complete output
};

console.error(`Running ${list.length} case(s) with concurrency ${concurrency} → ${outputPath}`);
const output = await runBatch(
  list,
  async (c) => {
    const t0 = Date.now();
    const onProgress = (e: { step: string; status: string; ms?: number; detail?: string }) => {
      if (e.status !== "started") console.error(`[${c.id}] ${e.step} ${e.status}${e.ms !== undefined ? ` ${e.ms}ms` : ""}${e.detail ? `, ${e.detail.slice(0, 140)}` : ""}`);
    };
    try {
      const { kit } = await runPipeline(c, { ...deps, onProgress });
      return kit as Kit;
    } finally {
      timing.set(c.id, (Date.now() - t0) / 1000);
    }
  },
  {
    concurrency,
    onUpdate: (out, done) => {
      write(out);
      console.error(`[${done.id}] ${done.status}${done.error ? ` (${done.error.code}: ${done.error.message.slice(0, 200)})` : ""}`);
    },
  },
);
write(output);

const rows = output.kits.map((r) => {
  const k = r.kit;
  const reqs = k?.role.requirements ?? [];
  return {
    id: r.id,
    status: r.error ? `failed:${r.error.code}` : r.status,
    "reqs (must/nice)": k ? `${reqs.length} (${reqs.filter((x) => x.priority === "must").length}/${reqs.filter((x) => x.priority === "nice").length})` : "-",
    questions: k?.questions.length ?? "-",
    uncovered: k ? k.coverage.uncovered_requirement_ids.length : "-",
    passes: k?.coverage.passes ?? "-",
    days: k?.schedule.days.length ?? "-",
    seconds: timing.get(r.id)?.toFixed(1) ?? "-",
  };
});
const cols = Object.keys(rows[0] ?? { id: "" }) as (keyof (typeof rows)[number])[];
const width = (c: (typeof cols)[number]) => Math.max(c.length, ...rows.map((r) => String(r[c]).length));
console.error(`\n${cols.map((c) => c.padEnd(width(c))).join("  ")}`);
for (const r of rows) console.error(cols.map((c) => String(r[c]).padEnd(width(c))).join("  "));
console.error(`\nTotal: ${((Date.now() - started) / 1000).toFixed(1)}s, ${output.kits.filter((k) => k.status === "ok").length}/${output.kits.length} ok → ${outputPath}`);
