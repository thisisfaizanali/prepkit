import { applyOps, OpSchema } from "@prepkit/shared";
import { Router } from "express";
import { z } from "zod";
import type { KitRepo } from "../persistence/types.ts";
import { updateKit } from "../persistence/updateKit.ts";
import { currentUser } from "./auth.ts";
import { validate } from "./errors.ts";

const OpsBody = z.object({ ops: z.array(OpSchema).min(1).max(200) });
const IdParam = z.object({ id: z.string().min(1).max(100) });

/** Builder endpoints, mounted behind requireAuth: operation-based edits and section regeneration. */
export function builderRouter({ kits }: { kits: KitRepo }): Router {
  const router = Router();

  router.patch("/:id/ops", async (req, res) => {
    const { id } = validate(IdParam, req.params);
    const { ops } = validate(OpsBody, req.body);
    res.json(await updateKit(kits, currentUser(res)._id, id, (kit) => ({ kit: applyOps(kit, ops) })));
  });

  return router;
}
