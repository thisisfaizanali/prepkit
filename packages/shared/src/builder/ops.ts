import { z } from "zod";
import { FlashcardSchema, QUESTION_CATEGORIES, QuestionSchema, type Flashcard, type Meta, type Question } from "../kit.ts";
import { categorySlot } from "./merge.ts";
import { normalizeKit } from "./normalize.ts";
import { idSeqOf, metaOf, type BuilderKit } from "./state.ts";

const QuestionPatchSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    answer_outline: z.string().max(5000),
    difficulty: z.number().int().min(1).max(3),
    requirement_ids: z.array(z.string()).max(50),
  })
  .partial()
  .strict();
const FlashcardPatchSchema = z
  .object({ front: z.string().trim().min(1).max(1000), back: z.string().max(2000), requirement_ids: z.array(z.string()).max(50) })
  .partial()
  .strict();
const BriefPatchSchema = z.object({ summary: z.string().max(5000), what_they_do: z.string().max(5000) }).partial().strict();

const Id = z.string().min(1).max(100);
const UserQuestionId = z.string().regex(/^qu-[a-z0-9]{8}$/, 'user-created question ids look like "qu-" + 8 base36 chars');
const UserFlashcardId = z.string().regex(/^fu-[a-z0-9]{8}$/, 'user-created flashcard ids look like "fu-" + 8 base36 chars');

/**
 * Every op can be re-applied to a newer kit (compare-and-swap retries): update/move carry a snapshot of the item,
 * so an edit to an item a concurrent regeneration removed re-inserts it instead of being lost; add is a no-op when
 * the id already exists; delete/pin of a missing id is a no-op.
 */
export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("question.update"), id: Id, patch: QuestionPatchSchema, snapshot: QuestionSchema }),
  z.object({ op: z.literal("question.add"), question: QuestionSchema.extend({ id: UserQuestionId }) }),
  z.object({ op: z.literal("question.delete"), id: Id }),
  z.object({ op: z.literal("question.move"), id: Id, category: z.enum(QUESTION_CATEGORIES).optional(), beforeId: Id.nullable(), snapshot: QuestionSchema }),
  z.object({ op: z.literal("question.pin"), id: Id, pinned: z.boolean() }),
  z.object({ op: z.literal("flashcard.update"), id: Id, patch: FlashcardPatchSchema, snapshot: FlashcardSchema }),
  z.object({ op: z.literal("flashcard.add"), flashcard: FlashcardSchema.extend({ id: UserFlashcardId }) }),
  z.object({ op: z.literal("flashcard.delete"), id: Id }),
  z.object({ op: z.literal("flashcard.move"), id: Id, beforeId: Id.nullable(), snapshot: FlashcardSchema }),
  z.object({ op: z.literal("flashcard.pin"), id: Id, pinned: z.boolean() }),
  z.object({ op: z.literal("brief.update"), patch: BriefPatchSchema }),
  z.object({ op: z.literal("brief.pin"), pinned: z.boolean() }),
]);
export type Op = z.infer<typeof OpSchema>;

const touched = (item: { meta?: Meta }, change: Partial<Meta>): Meta => ({ ...metaOf(item), ...change });

/** Remove `id` (or fall back to the snapshot when it's gone) and return the item to re-insert. */
function take<T extends { id: string }>(list: T[], id: string, snapshot: T): T {
  const i = list.findIndex((x) => x.id === id);
  return i >= 0 ? list.splice(i, 1)[0] : { ...structuredClone(snapshot), id };
}

function applyOne(kit: BuilderKit, op: Op): void {
  const qs = kit.questions;
  const fs = kit.flashcards;
  switch (op.op) {
    case "question.update": {
      const i = qs.findIndex((x) => x.id === op.id);
      if (i >= 0) {
        qs[i] = { ...qs[i], ...op.patch, meta: touched(qs[i], { edited: true }) };
      } else {
        const q: Question = { ...structuredClone(op.snapshot), ...op.patch, id: op.id };
        q.meta = touched(q, { edited: true });
        qs.splice(categorySlot(qs, q.category), 0, q);
      }
      return;
    }
    case "question.add":
      if (!qs.some((x) => x.id === op.question.id)) {
        const q: Question = { ...op.question, meta: { origin: "user", edited: false, pinned: op.question.meta?.pinned ?? false } };
        qs.splice(categorySlot(qs, q.category), 0, q);
      }
      return;
    case "question.delete":
      kit.questions = qs.filter((x) => x.id !== op.id);
      return;
    case "question.move": {
      const q = take(qs, op.id, op.snapshot);
      if (op.category) q.category = op.category;
      q.meta = touched(q, { edited: true });
      const before = op.beforeId ? qs.findIndex((x) => x.id === op.beforeId) : -1;
      qs.splice(before >= 0 ? before : categorySlot(qs, q.category), 0, q);
      return;
    }
    case "question.pin": {
      const q = qs.find((x) => x.id === op.id);
      if (q) q.meta = touched(q, { pinned: op.pinned });
      return;
    }
    case "flashcard.update": {
      const i = fs.findIndex((x) => x.id === op.id);
      if (i >= 0) {
        fs[i] = { ...fs[i], ...op.patch, meta: touched(fs[i], { edited: true }) };
      } else {
        const f: Flashcard = { ...structuredClone(op.snapshot), ...op.patch, id: op.id };
        f.meta = touched(f, { edited: true });
        fs.push(f);
      }
      return;
    }
    case "flashcard.add":
      if (!fs.some((x) => x.id === op.flashcard.id)) fs.push({ ...op.flashcard, meta: { origin: "user", edited: false, pinned: op.flashcard.meta?.pinned ?? false } });
      return;
    case "flashcard.delete":
      kit.flashcards = fs.filter((x) => x.id !== op.id);
      return;
    case "flashcard.move": {
      const f = take(fs, op.id, op.snapshot);
      f.meta = touched(f, { edited: true });
      const before = op.beforeId ? fs.findIndex((x) => x.id === op.beforeId) : -1;
      fs.splice(before >= 0 ? before : fs.length, 0, f);
      return;
    }
    case "flashcard.pin": {
      const f = fs.find((x) => x.id === op.id);
      if (f) f.meta = touched(f, { pinned: op.pinned });
      return;
    }
    case "brief.update":
      kit.company_brief = { ...kit.company_brief, ...op.patch, meta: touched(kit.company_brief, { edited: true }) };
      return;
    case "brief.pin":
      kit.company_brief = { ...kit.company_brief, meta: touched(kit.company_brief, { pinned: op.pinned }) };
      return;
  }
}

/** Pure: applies `ops` in order to a copy of the kit, then normalises it. */
export function applyOps<K extends BuilderKit>(input: K, ops: Op[]): K {
  const kit = structuredClone(input);
  kit.id_seq = idSeqOf(kit); // seed before any delete, so deleted generated ids are never reused
  for (const op of ops) applyOne(kit, op);
  return normalizeKit(kit);
}
