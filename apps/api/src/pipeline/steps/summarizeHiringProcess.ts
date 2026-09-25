import { z } from "zod";
import { generateJson } from "../../llm/json.ts";
import { untrusted, UNTRUSTED_POLICY } from "../../llm/untrusted.ts";
import { llmInfo, traced, type PipelineDeps } from "../trace.ts";
import type { ResearchResult } from "./research.ts";

const HIRING_PAGES_CHARS = 6000;
const DISCUSSION_CHARS = 3000;

const flag = z.boolean().default(false);
const SummarySchema = z.object({
  stages: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  signals: z
    .object({
      take_home: flag,
      system_design: flag,
      pair_programming: flag,
      live_coding: flag,
      behavioural: flag,
      culture_values: flag,
    })
    .default({ take_home: false, system_design: false, pair_programming: false, live_coding: false, behavioural: false, culture_values: false }),
  notes: z.string().default(""),
});

export type HiringProcessSummary = z.infer<typeof SummarySchema> & {
  /** Every source URL whose text was given to the model (set in code, never model-written). */
  sources: string[];
};

const SYSTEM = `You summarise a company's hiring / interview process for a candidate preparing to interview.

You are given numbered sources. "official" sources are the company's own pages; "third_party" sources are
public posts by candidates (anecdotal, possibly outdated).

Return a JSON object:
{
  "stages": [{ "name": string, "description": string }],   // interview stages in order, as described
  "signals": {                                              // true ONLY if the sources say so
    "take_home": boolean, "system_design": boolean, "pair_programming": boolean,
    "live_coding": boolean, "behavioural": boolean, "culture_values": boolean
  },
  "notes": string           // other useful facts stated in the sources (timeline, format, tips); "" if none
}

Rules:
- Use ONLY what the sources state. Do not add stages or signals that are typical for the industry but not mentioned.
- Unknown means false (signals) or empty (stages, notes).
- If stages come only from third_party sources, say so in notes.

${UNTRUSTED_POLICY}`;

export async function summarizeHiringProcess(
  research: Pick<ResearchResult, "hiringPages" | "discussion" | "companyName">,
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
): Promise<HiringProcessSummary | null> {
  const { hiringPages } = research;
  const discussion = research.discussion.filter((d) => d.usedForSummary);
  if (hiringPages.length === 0 && discussion.length === 0) {
    deps.onProgress({ step: "summarize_hiring_process", status: "skipped", detail: "no hiring pages or usable public discussion" });
    return null;
  }

  const sources = [
    ...hiringPages.map((p) => ({ url: p.url, kind: "official", text: `${p.title}\n\n${p.text}`, cap: Math.floor(HIRING_PAGES_CHARS / hiringPages.length) })),
    ...discussion.map((d) => ({ url: d.url, kind: "third_party", text: `${d.title}\n\n${d.content}`, cap: Math.floor(DISCUSSION_CHARS / discussion.length) })),
  ];
  const user = [
    `Summarise the hiring process at ${research.companyName}.`,
    ...sources.map((s, i) => untrusted(`source ${i + 1} (${s.kind}): ${s.url}`, s.text, s.cap)),
  ].join("\n\n");

  return traced(
    deps,
    "summarize_hiring_process",
    async () => {
      const label = "summarize_hiring_process";
      const res = await generateJson(deps.llm, { label, system: SYSTEM, user, schema: SummarySchema, temperature: 0.2, maxTokens: 2500 });
      return { summary: { ...res.data, sources: sources.map((s) => s.url) }, llm: llmInfo(label, res) };
    },
    (r) => ({ detail: `${r.summary.stages.length} stages from ${sources.length} sources`, llm: r.llm }),
  ).then((r) => r.summary);
}
