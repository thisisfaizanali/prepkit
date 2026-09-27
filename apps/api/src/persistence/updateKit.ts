import { validateKit, type BuilderKit, type Kit } from "@prepkit/shared";
import { HttpError, notFound } from "../http/errors.ts";
import type { KitDoc, KitExtra, KitRepo } from "./types.ts";

export const CAS_TRIES = 5;

/**
 * Read-modify-write on a done kit with compare-and-swap on `version`. On a lost race the kit is reloaded and
 * `change` re-applied to the newer state, which is why builder ops and merges are designed to be re-appliable.
 * `change` may throw (e.g. BuilderError) to abort; an invalid result → 400 with the validation errors.
 */
export async function updateKit(
  kits: KitRepo,
  userId: string,
  id: string,
  change: (kit: BuilderKit, doc: KitDoc) => { kit: BuilderKit; extra?: KitExtra },
): Promise<{ kit: BuilderKit; version: number }> {
  for (let attempt = 1; attempt <= CAS_TRIES; attempt++) {
    const doc = await kits.get(userId, id);
    if (!doc) throw notFound("Kit not found");
    if (doc.status !== "done" || !doc.kit) throw new HttpError(409, "NOT_READY", `The kit is ${doc.status}; it can be edited once generation is done`);
    const { kit, extra } = change(doc.kit as BuilderKit, doc);
    const valid = validateKit(kit);
    if (!valid.ok) throw new HttpError(400, "VALIDATION_ERROR", "The change would produce an invalid kit", valid.errors);
    if (await kits.casKit(userId, id, doc.version, kit as Kit, extra)) return { kit, version: doc.version + 1 };
  }
  throw new HttpError(409, "CONFLICT", "The kit kept changing while saving; reload and try again");
}
