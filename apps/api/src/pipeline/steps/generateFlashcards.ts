import type { Flashcard, Question } from "@prepkit/shared";
import { z } from "zod";
import { MAX_TOKENS } from "../../llm/budgets.ts";
import { generateJson } from "../../llm/json.ts";
import { untrusted, UNTRUSTED_POLICY } from "../../llm/untrusted.ts";
import { llmInfo, plural, traced, type PipelineDeps } from "../trace.ts";
import type { KitRequirement } from "./extractRequirements.ts";
import { errorCode, QUESTION_META } from "./generateQuestions.ts";

const BATCH_SIZE = 12;

const CardsSchema = z.object({
  cards: z.array(z.object({ requirement_ids: z.array(z.string()).default([]), front: z.string().default(""), back: z.string().default("") })),
});

const SYSTEM = `You write study flashcards for a candidate preparing for a specific role.

Return a JSON object: { "cards": [{ "requirement_ids": string[], "front": string, "back": string }] }
- For each listed requirement write 1 card, or 2 cards if it is marked "must". Each card's requirement_ids holds that requirement's id.
- front: a concise prompt or term to recall (one line).
- back: a crisp, correct answer of at most 60 words.
- Ground cards in the requirement and its evidence quote; no trivia unrelated to the role.

${UNTRUSTED_POLICY}`;

type DraftCard = Omit<Flashcard, "id">;

/** Code-built card: the requirement as a question, answered by a covering question's outline (else the JD quote). */
function codeCard(r: KitRequirement, questions: Question[]): DraftCard {
  const q = questions.find((x) => x.requirement_ids.includes(r.id) && x.answer_outline.trim());
  return {
    front: `What should you be ready to show about: ${r.text}?`,
    back: q ? q.answer_outline : `The job description asks for: "${r.evidence}"`,
    requirement_ids: [r.id],
    meta: { ...QUESTION_META },
  };
}

async function batchCards(batch: KitRequirement[], deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">): Promise<DraftCard[]> {
  const label = "flashcards";
  const lines = batch.map((r) => `${r.id} [${r.priority}] ${r.text}, evidence: "${r.evidence}"`).join("\n");
  return traced(
    deps,
    label,
    async () => {
      const res = await generateJson(deps.llm, {
        label,
        system: SYSTEM,
        user: `Requirements:\n${untrusted("requirements", lines, 6000)}\n\nWrite the flashcards.`,
        schema: CardsSchema,
        temperature: 0.3,
        maxTokens: MAX_TOKENS.flashcards,
      });
      const allowed = new Set(batch.map((r) => r.id));
      const cards = res.data.cards
        .map((c) => ({ front: c.front.trim(), back: c.back.trim(), requirement_ids: [...new Set(c.requirement_ids.filter((id) => allowed.has(id)))], meta: { ...QUESTION_META } }))
        .filter((c) => c.front && c.back);
      return { cards, llm: llmInfo(label, res) };
    },
    (r) => ({ detail: `${plural(r.cards.length, "card")} for ${plural(batch.length, "requirement")}`, llm: r.llm }),
  ).then((r) => r.cards);
}

/** One call per ≤12 requirements; every must-have requirement is guaranteed at least one card. */
export async function generateFlashcards(
  requirements: KitRequirement[],
  questions: Question[],
  deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">,
): Promise<{ flashcards: Flashcard[]; warnings: string[] }> {
  const warnings: string[] = [];
  const batches = Array.from({ length: Math.ceil(requirements.length / BATCH_SIZE) }, (_, i) => requirements.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));
  const drafts = (
    await Promise.all(
      batches.map((batch) =>
        batchCards(batch, deps).catch((e) => {
          warnings.push(`Could not generate flashcards (${errorCode(e)}); built simple cards from the requirements instead.`);
          return batch.map((r) => codeCard(r, questions));
        }),
      ),
    )
  ).flat();

  const carded = new Set(drafts.flatMap((c) => c.requirement_ids));
  const missing = requirements.filter((r) => r.priority === "must" && !carded.has(r.id));
  drafts.push(...missing.map((r) => codeCard(r, questions)));
  return { flashcards: drafts.map((c, i) => ({ id: `f${i + 1}`, ...c })), warnings };
}
