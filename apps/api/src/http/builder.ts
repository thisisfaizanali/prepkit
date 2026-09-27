import { applyOps, applySchedule, buildSchedule, OpSchema, QUESTION_CATEGORIES } from "@prepkit/shared";
import { Router } from "express";
import { z } from "zod";
import type { Regenerator } from "../jobs/regenerate.ts";
import type { KitRepo } from "../persistence/types.ts";
import { updateKit } from "../persistence/updateKit.ts";
import { currentUser } from "./auth.ts";
import { notFound, validate } from "./errors.ts";

const OpsBody = z.object({ ops: z.array(OpSchema).min(1).max(200) });
const IdParam = z.object({ id: z.string().min(1).max(100) });
const RegenerateBody = z
  .object({
    section: z.enum(["schedule", "brief", "questions", "gaps"]),
    category: z.enum(QUESTION_CATEGORIES).optional(),
    days: z.number().int().min(1).max(90).optional(),
    force: z.boolean().optional(),
  })
  .refine((b) => b.section !== "questions" || b.category, { message: "category is required for section \"questions\"", path: ["category"] });

// Card ids become Mongo field-path segments: no dots or $.
const PracticeBody = z.object({ flashcardId: z.string().regex(/^[\w-]{1,100}$/), confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]) });
const DayBody = z.object({ day: z.number().int().min(1).max(90), done: z.boolean() });

/** Builder endpoints, mounted behind requireAuth: operation-based edits and section regeneration. */
export function builderRouter({ kits, regen, now }: { kits: KitRepo; regen: Regenerator; now: () => number }): Router {
  const router = Router();

  router.patch("/:id/ops", async (req, res) => {
    const { id } = validate(IdParam, req.params);
    const { ops } = validate(OpsBody, req.body);
    res.json(await updateKit(kits, currentUser(res)._id, id, (kit) => ({ kit: applyOps(kit, ops) })));
  });

  // schedule: synchronous rebuild from the current questions. brief/questions/gaps: background job → 202, poll GET /:id.
  router.post("/:id/regenerate", async (req, res) => {
    const { id } = validate(IdParam, req.params);
    const b = validate(RegenerateBody, req.body);
    const userId = currentUser(res)._id;
    if (b.section === "schedule") {
      res.json(
        await updateKit(kits, userId, id, (kit) => ({
          kit: applySchedule(kit, buildSchedule(kit.role.requirements, kit.questions, b.days ?? kit.schedule.days_available)),
          extra: { schedule_progress: {} },
        })),
      );
      return;
    }
    const regeneration = await regen.start(
      userId,
      id,
      b.section === "brief" ? { section: "brief", force: b.force } : b.section === "gaps" ? { section: "gaps" } : { section: "questions", category: b.category! },
    );
    res.status(202).json({ id, regeneration });
  });

  // Practice and day progress live beside the kit (not in it): atomic updates, no compare-and-swap, no op conflicts.
  router.post("/:id/practice", async (req, res) => {
    const { id } = validate(IdParam, req.params);
    const { flashcardId, confidence } = validate(PracticeBody, req.body);
    const entry = await kits.recordPractice(currentUser(res)._id, id, flashcardId, confidence, new Date(now()));
    if (!entry) throw notFound("Kit or flashcard not found");
    res.json(entry);
  });

  router.post("/:id/schedule-progress", async (req, res) => {
    const { id } = validate(IdParam, req.params);
    const { day, done } = validate(DayBody, req.body);
    const progress = await kits.setScheduleDay(currentUser(res)._id, id, day, done, new Date(now()));
    if (!progress) throw notFound("Kit or schedule day not found");
    res.json({ schedule_progress: progress });
  });

  return router;
}
