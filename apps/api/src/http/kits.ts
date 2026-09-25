import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { JobQueue } from "../jobs/runner.ts";
import { DuplicateKeyError, type KitDoc, type KitInput, type KitRepo } from "../persistence/types.ts";
import { normalizeCompanyUrl } from "../retrieval/urlGuard.ts";
import { currentUser } from "./auth.ts";
import { HttpError, notFound, validate } from "./errors.ts";

export const KitInputSchema = z.object({
  jd: z.string().trim().min(1, "jd is empty").max(50_000),
  company_url: z.string().trim().min(1, "company_url is empty").max(2000),
  days: z.number().int().min(1).max(90),
});
const BatchSchema = z.object({ cases: z.array(KitInputSchema).min(1).max(10) });
const IdParam = z.object({ id: z.string().min(1).max(100) });

/** sha256(userId + normalised JD + normalised URL). Days are left out: the schedule can be rebuilt for other days. */
export function inputHash(userId: string, jd: string, companyUrl: string): string {
  let url = companyUrl.trim().toLowerCase();
  try {
    url = normalizeCompanyUrl(companyUrl).href;
  } catch {
    // unparseable: compare as typed
  }
  return createHash("sha256").update(`${userId}\n${jd.trim().replace(/\s+/g, " ")}\n${url}`).digest("hex");
}

type SubmitResult = { httpStatus: 200 | 202; body: { id: string; status: KitDoc["status"]; duplicate: boolean; retried?: boolean } };

export function kitService(kits: KitRepo, queue: JobQueue, now: () => number) {
  const requeue = async (doc: KitDoc, input: KitInput = doc.input) => {
    await kits.update(doc._id, { status: "queued", input, error: null, progress: [], kit: null });
    queue.enqueue(doc._id);
  };

  /** Existing kit: reuse it, unless it failed, in which case it's re-run (with the new days). */
  const reuse = async (doc: KitDoc, input: KitInput): Promise<SubmitResult> => {
    if (doc.status !== "failed") return { httpStatus: 200, body: { id: doc._id, status: doc.status, duplicate: true } };
    await requeue(doc, input);
    return { httpStatus: 202, body: { id: doc._id, status: "queued", duplicate: true, retried: true } };
  };

  const submit = async (userId: string, input: KitInput): Promise<SubmitResult> => {
    const hash = inputHash(userId, input.jd, input.company_url);
    const existing = await kits.findByInputHash(userId, hash);
    if (existing) return reuse(existing, input);
    const at = new Date(now());
    const doc: KitDoc = {
      _id: randomUUID(), userId, status: "queued", input, inputHash: hash, progress: [], kit: null, error: null,
      researchCache: null, version: 0, createdAt: at, updatedAt: at,
    };
    try {
      await kits.insert(doc);
    } catch (e) {
      // Lost a race with an identical request: the unique index kept one kit, so return that one.
      if (!(e instanceof DuplicateKeyError)) throw e;
      const winner = await kits.findByInputHash(userId, hash);
      if (!winner) throw e;
      return reuse(winner, input);
    }
    queue.enqueue(doc._id);
    return { httpStatus: 202, body: { id: doc._id, status: "queued", duplicate: false } };
  };

  return { submit, requeue };
}

const summary = (k: Omit<KitDoc, "progress" | "researchCache">) => ({
  id: k._id,
  status: k.status,
  company: k.kit?.source.company ?? null,
  role: k.kit?.source.role ?? null,
  company_url: k.input.company_url,
  days: k.input.days,
  createdAt: k.createdAt,
  updatedAt: k.updatedAt,
  counts: k.kit
    ? { requirements: k.kit.role.requirements.length, questions: k.kit.questions.length, flashcards: k.kit.flashcards.length }
    : null,
  error: k.error,
});

export function kitsRouter({ kits, queue, now, requireAuth }: { kits: KitRepo; queue: JobQueue; now: () => number; requireAuth: RequestHandler }): Router {
  const router = Router();
  const service = kitService(kits, queue, now);
  router.use(requireAuth);

  router.post("/", async (req, res) => {
    const r = await service.submit(currentUser(res)._id, validate(KitInputSchema, req.body));
    res.status(r.httpStatus).json(r.body);
  });

  // Cases run one after another so identical cases in one batch dedupe against each other.
  router.post("/batch", async (req, res) => {
    const { cases } = validate(BatchSchema, req.body);
    const results = [];
    for (const c of cases) results.push((await service.submit(currentUser(res)._id, c)).body);
    res.status(202).json({ results });
  });

  router.get("/", async (_req, res) => {
    res.json({ kits: (await kits.list(currentUser(res)._id)).map(summary) });
  });

  router.get("/:id", async (req, res) => {
    const doc = await kits.get(currentUser(res)._id, validate(IdParam, req.params).id);
    if (!doc) throw notFound("Kit not found");
    const { _id, researchCache: _cache, ...rest } = doc;
    res.json({ id: _id, ...rest });
  });

  router.delete("/:id", async (req, res) => {
    if (!(await kits.delete(currentUser(res)._id, validate(IdParam, req.params).id))) throw notFound("Kit not found");
    res.status(204).end();
  });

  router.post("/:id/retry", async (req, res) => {
    const doc = await kits.get(currentUser(res)._id, validate(IdParam, req.params).id);
    if (!doc) throw notFound("Kit not found");
    if (doc.status !== "failed") throw new HttpError(409, "NOT_RETRYABLE", `Only failed kits can be retried (this one is ${doc.status})`);
    await service.requeue(doc);
    res.status(202).json({ id: doc._id, status: "queued" });
  });

  return router;
}
