import type { Kit, Meta } from "../kit.ts";

/** Next numeric suffix for generated ids. Ids are never reused, even after deletes. */
export type IdSeq = { q: number; f: number };
/** A kit plus the builder's extensions. Other extensions (evidence, research, …) pass through untouched. */
export type BuilderKit = Kit & { id_seq?: IdSeq; schedule_stale?: boolean };

export type BuilderErrorCode = "BRIEF_PROTECTED";
export class BuilderError extends Error {
  constructor(
    public code: BuilderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BuilderError";
  }
}

export const GENERATED_META: Meta = { origin: "generated", edited: false, pinned: false };

/** Missing meta ⇒ generated, unedited, unpinned. */
export const metaOf = (item: { meta?: Meta }): Meta => item.meta ?? GENERATED_META;

/** User-created, edited or pinned: regeneration must never remove or overwrite it. */
export const isProtected = (item: { meta?: Meta }): boolean => {
  const m = metaOf(item);
  return m.origin === "user" || m.edited || m.pinned;
};

const maxSuffix = (ids: string[], prefix: string) =>
  Math.max(0, ...ids.map((id) => new RegExp(`^${prefix}(\\d+)$`).exec(id)).map((m) => (m ? Number(m[1]) : 0)));

/** id_seq, initialised from the highest existing q<n>/f<n> when absent (and never behind them). */
export function idSeqOf(kit: BuilderKit): IdSeq {
  return {
    q: Math.max(kit.id_seq?.q ?? 0, maxSuffix(kit.questions.map((q) => q.id), "q")),
    f: Math.max(kit.id_seq?.f ?? 0, maxSuffix(kit.flashcards.map((f) => f.id), "f")),
  };
}

/** Client-made id for a user-created item ("qu-k3j9x0ab"), so it can be created optimistically. */
export function newUserItemId(kind: "q" | "f"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${kind}u-${[...bytes].map((b) => (b % 36).toString(36)).join("")}`;
}
