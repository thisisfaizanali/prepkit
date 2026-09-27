import type { CompanyBrief } from "@prepkit/shared";
import { z } from "zod";
import { MAX_TOKENS } from "../../llm/budgets.ts";
import { generateJson } from "../../llm/json.ts";
import { untrusted, UNTRUSTED_POLICY } from "../../llm/untrusted.ts";
import { llmInfo, plural, traced, type PipelineDeps } from "../trace.ts";
import type { ResearchResult, SitePage } from "./research.ts";

const SITE_CHARS = 8000;
const PER_PAGE_CHARS = 3500;
const MIN_USABLE_CHARS = 200;
const PARAGRAPH_CHARS = 1500;
const PAGE_ORDER: SitePage["kind"][] = ["home", "about", "careers", "engineering"];
const META = { origin: "generated", edited: false, pinned: false } as const;
const NOT_AVAILABLE = "Not available, no information could be retrieved.";

const ABOUT_HEADING = /^#*\s*(about\s+(us|the company|[\p{L}\p{N} .&'-]{1,40})|who we are|our company|the company|company overview)\s*:?\s*$/iu;
const NOT_ABOUT_COMPANY = /^#*\s*about\s+(the\s+)?(role|job|position|team|you|this role|the opportunity)\b/i;
const looksLikeHeading = (line: string) => {
  const t = line.trim();
  return t.length > 0 && t.length <= 60 && (t.endsWith(":") || t.startsWith("#") || (!/[.!?,;]$/.test(t) && t.split(/\s+/).length <= 5));
};

/** The JD's own "About us" / "Who we are" section, if it has one. */
export function findCompanyParagraph(jd: string): string | undefined {
  const lines = jd.split(/\r?\n/);
  const start = lines.findIndex((l) => ABOUT_HEADING.test(l.trim()) && !NOT_ABOUT_COMPANY.test(l.trim()));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (body.length && looksLikeHeading(line)) break;
    if (line.trim()) body.push(line.trim());
  }
  const text = body.join("\n").slice(0, PARAGRAPH_CHARS);
  return text.length >= 40 ? text : undefined;
}

const BriefSchema = z.object({ summary: z.string(), what_they_do: z.string() });
const WhatTheyDoSchema = z.object({ what_they_do: z.string() });

const SYSTEM = `You write a short company brief for a candidate preparing for an interview.

Return a JSON object: { "summary": string, "what_they_do": string }
- summary: 2-4 sentences on who the company is (mission, size, stage, culture) as stated in the text.
- what_they_do: 1-3 sentences on the product/service and who it is for.

Rules:
- Use ONLY the provided text. Do not use outside knowledge, even if you recognise the company.
- If the text doesn't say something, say so plainly (e.g. "The provided pages don't describe the product.") rather than guessing.
- No marketing superlatives unless quoted as the company's own claim.

${UNTRUSTED_POLICY}`;

const JD_ONLY_SYSTEM = `From the company description inside a job description, state what the company does.

Return a JSON object: { "what_they_do": string }, 1-3 sentences, using ONLY that text. Start with
"According to the job description, ". If the text doesn't say what the company does, return
"The job description doesn't say what the company does."

${UNTRUSTED_POLICY}`;

export async function companyBrief(
  input: { research: Pick<ResearchResult, "pages" | "reachable" | "crawlError" | "companyName" | "siteMismatch">; jd: string; companyUrl: string },
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
): Promise<CompanyBrief> {
  const { research, jd, companyUrl } = input;
  const jdParagraph = findCompanyParagraph(jd);

  // Pick site pages in priority order within the budget.
  let budget = SITE_CHARS;
  const used: { page: SitePage; text: string }[] = [];
  for (const kind of PAGE_ORDER) {
    for (const page of research.pages.filter((p) => p.kind === kind)) {
      const text = [page.title, page.description, page.text].filter(Boolean).join("\n").slice(0, Math.min(PER_PAGE_CHARS, budget));
      if (text.trim().length < 40 || budget <= 0) continue;
      used.push({ page, text });
      budget -= text.length;
    }
  }
  const usable = used.reduce((n, u) => n + u.text.trim().length, 0) >= MIN_USABLE_CHARS;

  if (usable) {
    return traced(
      deps,
      "company_brief",
      async () => {
        const label = "company_brief";
        const user = [
          `Write a brief about ${research.companyName}.`,
          ...used.map((u) => untrusted(`${u.page.kind} page: ${u.page.url}`, u.text, PER_PAGE_CHARS)),
          ...(jdParagraph ? [untrusted("job description: company paragraph", jdParagraph, PARAGRAPH_CHARS)] : []),
        ].join("\n\n");
        const res = await generateJson(deps.llm, { label, system: SYSTEM, user, schema: BriefSchema, temperature: 0.2, maxTokens: MAX_TOKENS.brief });
        const sources = [...used.map((u) => u.page.url), ...(jdParagraph ? ["job description"] : [])];
        return { brief: { ...res.data, sources, meta: { ...META } }, llm: llmInfo(label, res) };
      },
      (r) => ({ detail: `from ${plural(r.brief.sources.length, "source")}`, llm: r.llm }),
    ).then((r) => r.brief);
  }

  // No usable site text: say so honestly, built in code. Nothing is guessed.
  const summary = research.siteMismatch
    ? `The website (${companyUrl}) appears to belong to ${research.siteMismatch.siteName}, not ${research.siteMismatch.jdCompany}, so this brief is not based on it. Nothing here is guessed.`
    : research.reachable
    ? `The company website (${companyUrl}) was reachable but had no descriptive content that could be used, so this brief does not summarise it. Nothing here is guessed.`
    : `The company website (${companyUrl}) could not be retrieved (${research.crawlError?.code ?? "UNKNOWN"}: ${research.crawlError?.message ?? "no details"}), so this brief is not based on it. Nothing here is guessed.`;

  if (!jdParagraph) {
    deps.onProgress({ step: "company_brief", status: "skipped", detail: "no usable site text and no company description in the job description" });
    return { summary, what_they_do: NOT_AVAILABLE, sources: [], meta: { ...META } };
  }
  return traced(
    deps,
    "company_brief",
    async () => {
      const label = "company_brief_from_jd";
      const res = await generateJson(deps.llm, {
        label,
        system: JD_ONLY_SYSTEM,
        user: untrusted("job description: company paragraph", jdParagraph, PARAGRAPH_CHARS),
        schema: WhatTheyDoSchema,
        temperature: 0.2,
        maxTokens: MAX_TOKENS.brief,
      });
      return { brief: { summary, what_they_do: res.data.what_they_do, sources: ["job description"], meta: { ...META } }, llm: llmInfo(label, res) };
    },
    (r) => ({ detail: "site unusable; what_they_do from the job description only", llm: r.llm }),
  ).then((r) => r.brief);
}
