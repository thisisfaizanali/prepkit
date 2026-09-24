import { PRIORITIES, REQUIREMENT_KINDS, type Requirement } from "@prepkit/shared";
import { z } from "zod";
import { generateJson } from "../../llm/json.ts";
import { untrusted, UNTRUSTED_POLICY } from "../../llm/untrusted.ts";
import { llmInfo, traced, type LLMCallInfo, type PipelineDeps } from "../trace.ts";

const MAX_JD_CHARS = 20_000;
const THIN_JD_CHARS = 400;
const THIN_JD_REQUIREMENTS = 3;

const RawRequirementSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
  evidence: z.string(),
});
export type RawRequirement = z.infer<typeof RawRequirementSchema>;

export const ExtractionSchema = z.object({
  company: z.string().nullable().default(null),
  title: z.string().default(""),
  seniority: z.string().default(""),
  location: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(RawRequirementSchema),
});

export type KitRequirement = Requirement & { evidence: string };
export type Extraction = Omit<z.infer<typeof ExtractionSchema>, "requirements">;
export type ExtractionResult = {
  extraction: Extraction;
  requirements: KitRequirement[];
  warnings: string[];
  llm: LLMCallInfo;
};

const SYSTEM = `You extract hiring requirements from a job description for an interview-prep tool.

Return a JSON object:
{
  "company": string | null,        // the hiring company's name ONLY if the job description names it, else null
  "title": string,                 // job title as written
  "seniority": string,             // e.g. "senior", "mid", "junior", "staff"; "" if not stated or implied by the title
  "location": string,              // as written (e.g. "Remote (EU)"); "" if not stated
  "responsibilities": string[],    // what the person will DO in the role
  "requirements": [{
    "text": string,                // short statement of one skill or experience, e.g. "3+ years of TypeScript"
    "kind": "technical" | "behavioural" | "domain",
    "priority": "must" | "nice",
    "evidence": string             // an EXACT verbatim quote from the job description supporting it
  }]
}

Rules:
1. Extract ONLY requirements the text actually states. Never add skills that are typical, implied, or "usually expected" for the role. A short job description yields few requirements; that is correct, do not pad.
2. "evidence" must be copied character-for-character from the job description: a phrase or a whole line. Do not paraphrase, summarise, fix typos, or combine separate lines.
3. One requirement per distinct skill or experience. Split a compound line (e.g. "React and Node.js") only when it names clearly separate skills; each split requirement may reuse the same evidence quote.
4. kind:
   - technical: tools, languages, frameworks, engineering practices and skills
   - behavioural: collaboration, mentoring, communication, leadership, ownership
   - domain: industry or business knowledge (fintech, healthcare, compliance, ...)
5. priority:
   - "must" when stated as required / must / minimum / "you have" / "you will need", or listed under a requirements or qualifications heading with no softener. A plain list with no qualifier is "must".
   - "nice" when softened: "bonus", "nice to have", "preferred", "a plus", "plus", "ideally", "familiarity with ... is a plus", "desirable", "optional".
6. Responsibilities are what the person will DO; requirements are what they must HAVE. Do not list the same thing in both.

${UNTRUSTED_POLICY}`;

/** Lowercase, strip bullets/punctuation, collapse whitespace. */
export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const hasCue = (text: string, cues: string[]) => {
  const hay = ` ${normalizeText(text)} `;
  return cues.some((c) => hay.includes(` ${c} `));
};
const NICE_CUES = ["nice to have", "bonus", "preferred", "a plus", "plus", "ideally", "desirable", "optional"];
const MUST_CUES = ["required", "must", "minimum", "requirements", "qualifications", "you have", "you will need"];
const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with", "we", "you"]);

/**
 * Short line that reads as a section heading: "Nice to have:", "## Requirements", "REQUIREMENTS", or Title Case
 * ("Bonus Points"). Title Case alone is weak (an unbulleted item like "Experience with Kubernetes" looks the same),
 * so a Title Case line only counts when it carries a priority cue; otherwise it would hide the real heading above.
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60 || /^[-*•·‣◦]/.test(t)) return false;
  if (t.endsWith(":") || t.startsWith("#")) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length > 2 && letters === letters.toUpperCase()) return true;
  const words = t.replace(/[^\p{L}\p{N}' ]/gu, "").split(/\s+/).filter(Boolean);
  const titleCase =
    words.length > 0 && words.length <= 6 && !/[.!?]$/.test(t) && words.every((w) => /^[\p{Lu}\p{N}]/u.test(w) || SMALL_WORDS.has(w));
  if (titleCase && (hasCue(t, NICE_CUES) || hasCue(t, MUST_CUES))) return true;
  // Unpunctuated sentence-case heading that starts with a cue: "Nice to have", "Preferred qualifications".
  // ("Kubernetes experience is preferred" doesn't start with its cue, so it stays an item.)
  const norm = normalizeText(t);
  return words.length <= 4 && !/[.!?]$/.test(t) && [...NICE_CUES, ...MUST_CUES].some((c) => norm === c || norm.startsWith(`${c} `));
}

/**
 * The anti-hallucination guard. Pure and deterministic:
 * a) drop requirements whose evidence isn't in the JD, b) correct priority from the JD's own wording,
 * c) dedupe, d) id by position in the JD, e) warn when the JD is thin.
 */
export function guardRequirements(jd: string, raw: RawRequirement[]): { requirements: KitRequirement[]; warnings: string[] } {
  // Normalised JD, line by line, remembering where each line starts in the joined string.
  const lines = jd.split(/\r?\n/);
  const lineStarts: { start: number; index: number }[] = [];
  let normJd = "";
  lines.forEach((line, index) => {
    const n = normalizeText(line);
    if (!n) return;
    if (normJd) normJd += " ";
    lineStarts.push({ start: normJd.length, index });
    normJd += n;
  });

  const kept: (KitRequirement & { pos: number; order: number })[] = [];
  let dropped = 0;
  raw.forEach((r, order) => {
    const evidence = normalizeText(r.evidence);
    const pos = evidence ? normJd.indexOf(evidence) : -1;
    if (pos < 0) {
      dropped++;
      return;
    }
    const lineIndex = lineStarts.filter((l) => l.start <= pos).at(-1)!.index;
    let heading = "";
    for (let i = lineIndex - 1; i >= 0; i--) {
      if (isHeading(lines[i])) {
        heading = lines[i];
        break;
      }
    }
    const own = lines[lineIndex];
    const priority =
      hasCue(own, NICE_CUES) || hasCue(heading, NICE_CUES)
        ? "nice"
        : hasCue(own, MUST_CUES) || hasCue(heading, MUST_CUES)
          ? "must"
          : r.priority;
    kept.push({ id: "", text: r.text.trim(), kind: r.kind, priority, evidence: r.evidence.trim(), pos, order });
  });

  kept.sort((a, b) => a.pos - b.pos || a.order - b.order);
  const seen = new Set<string>();
  const requirements: KitRequirement[] = [];
  for (const { pos: _pos, order: _order, ...r } of kept) {
    const key = normalizeText(r.text);
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({ ...r, id: `r${requirements.length + 1}` });
  }

  const warnings: string[] = [];
  if (dropped > 0) {
    warnings.push(`${dropped} extracted requirements were discarded because they could not be traced to the job description`);
  }
  if (jd.trim().length < THIN_JD_CHARS || requirements.length < THIN_JD_REQUIREMENTS) {
    warnings.push(
      `The job description is thin; only ${requirements.length} requirement(s) could be extracted. The kit is intentionally small rather than padded with guesses.`,
    );
  }
  return { requirements, warnings };
}

export async function extractRequirements(jd: string, deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">): Promise<ExtractionResult> {
  return traced(
    deps,
    "extract_requirements",
    async () => {
      const label = "extract_requirements";
      const res = await generateJson(deps.llm, {
        label,
        system: SYSTEM,
        user: `Extract the requirements from this job description.\n\n${untrusted("job_description", jd, MAX_JD_CHARS)}`,
        schema: ExtractionSchema,
        temperature: 0.2,
        maxTokens: 4000,
      });
      const { requirements: raw, ...extraction } = res.data;
      const guarded = guardRequirements(jd, raw);
      return { extraction, ...guarded, llm: llmInfo(label, res), raw: raw.length };
    },
    (r) => ({ detail: `${r.requirements.length} kept of ${r.raw} extracted`, llm: r.llm }),
  ).then(({ raw: _raw, ...result }) => result);
}
