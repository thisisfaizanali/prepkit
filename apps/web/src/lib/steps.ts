import type { ProgressEvent } from "@prepkit/shared";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Step = { key: string; label: string; status: StepStatus; detail?: string; ms?: number };

const HEAD: [string, string][] = [
  ["extract_requirements", "Extract requirements"],
  ["crawl", "Crawl company site"],
  ["search", "Search public discussion"],
  ["summarize_hiring_process", "Hiring process"],
  ["company_brief", "Company brief"],
];
const TAIL: [string, string][] = [
  ["flashcards", "Flashcards"],
  ["schedule", "Schedule"],
];
const CATEGORY: Record<string, string> = {
  technical: "technical",
  behavioural: "behavioural",
  "system-design": "system design",
  "company-fit": "company fit",
};
const cat = (c: string) => CATEGORY[c] ?? c;

function statusOf(events: ProgressEvent[]): StepStatus {
  const count = (s: ProgressEvent["status"]) => events.filter((e) => e.status === s).length;
  if (count("failed")) return "failed";
  if (count("started") > count("done") + count("failed")) return "running";
  if (count("done")) return "done";
  if (count("skipped")) return "skipped";
  return "pending";
}

/**
 * Turns the pipeline's raw progress events into a fixed checklist. Question and coverage rows appear as the run
 * reaches them (their number depends on the job description); until then a pending placeholder stands in.
 */
export function deriveSteps(progress: ProgressEvent[]): Step[] {
  const groups = new Map<string, { label: string; events: ProgressEvent[] }>();
  let pass = 0;
  const add = (key: string, label: string, e: ProgressEvent) => {
    const g = groups.get(key) ?? { label, events: [] };
    g.events.push(e);
    groups.set(key, g);
  };
  for (const e of progress) {
    const [kind, arg] = e.step.split(":");
    if (e.step === "search_hiring_discovery") add("search", "", e);
    else if (kind === "questions") add(e.step, `Questions: ${cat(arg)}`, e);
    else if (kind === "gap") add(`cov:${e.step}:${pass}`, `Coverage pass ${pass}: filling ${cat(arg)} gaps`, e);
    else if (e.step === "coverage_check") add(`cov:check:${++pass}`, `Coverage pass ${pass}`, e);
    else add(e.step, "", e);
  }

  const row = (key: string, label: string): Step => {
    const g = groups.get(key);
    const events = g?.events ?? [];
    const last = [...events].reverse().find((e) => e.detail);
    const ms = Math.max(0, ...events.map((e) => e.ms ?? 0));
    return { key, label: g?.label || label, status: statusOf(events), detail: last?.detail, ms: ms || undefined };
  };
  const dynamic = (prefix: string, placeholder: string) => {
    const keys = [...groups.keys()].filter((k) => k.startsWith(prefix));
    return keys.length ? keys.map((k) => row(k, "")) : [row(`${prefix}pending`, placeholder)];
  };

  return [
    ...HEAD.map(([k, l]) => row(k, l)),
    ...dynamic("questions:", "Questions per category"),
    ...dynamic("cov:", "Coverage pass"),
    ...TAIL.map(([k, l]) => row(k, l)),
  ];
}
