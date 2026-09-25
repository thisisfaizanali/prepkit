import { appendGenerated, isProtected, mergeBrief, mergeQuestionCategory, type BuilderKit, type Question } from "@prepkit/shared";
import { HttpError, notFound } from "../http/errors.ts";
import { LLMError } from "../llm/client.ts";
import type { KitDoc, KitRepo, Regeneration } from "../persistence/types.ts";
import { updateKit } from "../persistence/updateKit.ts";
import { companyBrief } from "../pipeline/steps/companyBrief.ts";
import { coverageLoop } from "../pipeline/steps/coverageLoop.ts";
import type { KitRequirement } from "../pipeline/steps/extractRequirements.ts";
import { generateQuestions, type QuestionContext } from "../pipeline/steps/generateQuestions.ts";
import { planQuestionJobs, type QuestionJob } from "../pipeline/steps/planQuestions.ts";
import type { SitePage } from "../pipeline/steps/research.ts";
import type { HiringProcessSummary } from "../pipeline/steps/summarizeHiringProcess.ts";
import type { PipelineDeps } from "../pipeline/trace.ts";

export type RegenerateRequest = { section: "brief"; force?: boolean } | { section: "questions"; category: Question["category"] };
export type GenerationDeps = Pick<PipelineDeps, "llm" | "now">;

type StoredResearch = { hiring_process?: Pick<HiringProcessSummary, "stages" | "signals" | "notes"> | null };
const SITE_KINDS: SitePage["kind"][] = ["home", "about", "careers", "engineering"];

const NOTHING_REASONS: Record<Question["category"], string> = {
  technical: "The role has no technical or domain requirements.",
  "system-design": "The hiring process has no system design round and the role isn't senior.",
  behavioural: "The role has no behavioural requirements and the hiring process has no behavioural round.",
  "company-fit": "The company is unknown (the brief isn't based on any source), so company-fit questions would be guesses.",
};

/** Question-generation context rebuilt from the stored kit only: no re-crawl, no re-extraction. */
export function storedContext(kit: BuilderKit): { ctx: QuestionContext; hiring: StoredResearch["hiring_process"] } {
  const hiring = (kit as BuilderKit & { research?: StoredResearch }).research?.hiring_process ?? null;
  const requirements = kit.role.requirements.map((r) => ({ ...r, evidence: (r as Partial<KitRequirement>).evidence ?? r.text }));
  return {
    hiring,
    ctx: {
      requirements,
      role: { title: kit.role.title, seniority: kit.role.seniority },
      hiring,
      brief: kit.company_brief,
      companyName: kit.source.company === "Unknown" ? "" : kit.source.company,
    },
  };
}

export function planCategory(kit: BuilderKit, category: Question["category"]): QuestionJob[] {
  const { ctx, hiring } = storedContext(kit);
  const briefIsReal = kit.company_brief.sources.length > 0;
  return planQuestionJobs(ctx.requirements, hiring ?? null, kit.role.seniority || kit.role.title, briefIsReal).filter((j) => j.category === category);
}

const codeOf = (e: unknown) =>
  e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : "INTERNAL";

/**
 * Background section regeneration. One at a time per kit (claimed atomically in the DB). Work uses only stored
 * context; results are merged into the LATEST kit with compare-and-swap, so edits made meanwhile survive.
 */
export class Regenerator {
  private readonly inflight = new Set<Promise<void>>();
  private readonly deps: Pick<PipelineDeps, "llm" | "now" | "onProgress">;

  constructor(
    private readonly kits: KitRepo,
    deps: GenerationDeps,
  ) {
    this.deps = { ...deps, onProgress: () => {} };
  }

  /** Checks preconditions, claims the kit, starts the work and returns the running regeneration. Throws HttpError. */
  async start(userId: string, id: string, req: RegenerateRequest): Promise<Regeneration> {
    const doc = await this.kits.get(userId, id);
    if (!doc) throw notFound("Kit not found");
    if (doc.status !== "done" || !doc.kit) throw new HttpError(409, "NOT_READY", `The kit is ${doc.status}; it can be regenerated once generation is done`);
    const kit = doc.kit as BuilderKit;
    if (req.section === "brief" && isProtected(kit.company_brief) && !req.force) {
      throw new HttpError(409, "BRIEF_PROTECTED", "The company brief was edited or pinned; regenerate with force to replace it");
    }
    if (req.section === "questions" && planCategory(kit, req.category).length === 0) {
      throw new HttpError(422, "NOTHING_TO_GENERATE", NOTHING_REASONS[req.category]);
    }

    const regeneration: Regeneration = {
      section: req.section,
      ...(req.section === "questions" ? { category: req.category } : {}),
      status: "running",
      startedAt: new Date(this.deps.now()),
    };
    if (!(await this.kits.claimRegeneration(userId, id, regeneration))) {
      throw new HttpError(409, "REGENERATION_IN_PROGRESS", "A regeneration is already running for this kit; wait for it to finish");
    }

    const work = this.run(userId, doc, req, regeneration).catch(async (e) => {
      const code = codeOf(e);
      if (code === "INTERNAL") console.error(`regeneration ${id}: unexpected failure`, e);
      const message = code === "INTERNAL" ? "Unexpected error while regenerating" : e instanceof Error ? e.message : String(e);
      await this.kits.update(id, { regeneration: { ...regeneration, status: "failed", finishedAt: new Date(this.deps.now()), error: { code, message } } });
    });
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
    return regeneration;
  }

  /** Resolves when no regeneration is running (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  private done(regeneration: Regeneration, summary: unknown): Regeneration {
    return { ...regeneration, status: "done", finishedAt: new Date(this.deps.now()), summary };
  }

  private async run(userId: string, doc: KitDoc, req: RegenerateRequest, regeneration: Regeneration): Promise<void> {
    if (req.section === "brief") return this.brief(userId, doc, req.force ?? false, regeneration);
    return this.questions(userId, doc, req.category, regeneration);
  }

  /** Brief from the stored page texts (honest code-built brief when there are none). */
  private async brief(userId: string, doc: KitDoc, force: boolean, regeneration: Regeneration): Promise<void> {
    const kit = doc.kit as BuilderKit;
    const pages: SitePage[] = (doc.researchCache?.pages ?? [])
      .filter((p): p is typeof p & { kind: SitePage["kind"] } => SITE_KINDS.includes(p.kind as SitePage["kind"]))
      .map((p) => ({ url: p.url, title: "", description: "", text: p.text, kind: p.kind }));
    const research = {
      pages,
      reachable: pages.length > 0,
      ...(pages.length ? {} : { crawlError: { code: "NO_STORED_PAGES", message: "no website text was stored with this kit" } }),
      companyName: kit.source.company,
    };
    const brief = await companyBrief({ research, jd: doc.input.jd, companyUrl: doc.input.company_url }, this.deps);
    await updateKit(this.kits, userId, doc._id, (latest) => {
      const merged = mergeBrief(latest, brief, { force });
      const urls = brief.sources.filter((s) => /^https?:\/\//.test(s));
      merged.source = { ...merged.source, pages_used: [...new Set([...merged.source.pages_used, ...urls])] };
      return { kit: merged, extra: { regeneration: this.done(regeneration, { sources: brief.sources }) } };
    });
  }

  /**
   * Replace a category's unprotected questions, then run the coverage loop on the merged kit so must-have
   * coverage stays guaranteed. Nothing is merged if generation fails or yields nothing.
   */
  private async questions(userId: string, doc: KitDoc, category: Question["category"], regeneration: Regeneration): Promise<void> {
    const kit = doc.kit as BuilderKit;
    const { ctx } = storedContext(kit);
    const kept = kit.questions.filter((q) => q.category === category && isProtected(q));
    const avoid = kept.map((q) => q.prompt);
    const drafts = (await Promise.all(planCategory(kit, category).map((job) => generateQuestions(job, ctx, this.deps, { avoid })))).flat();
    if (drafts.length === 0) throw new LLMError("LLM_INVALID_OUTPUT", `The model returned no ${category} questions; the kit was left unchanged`);

    const latest = await this.kits.get(userId, doc._id);
    if (!latest?.kit) throw notFound("Kit not found");
    const preview = mergeQuestionCategory(latest.kit as BuilderKit, category, drafts);
    const coverage = await coverageLoop(preview.questions, storedContext(preview).ctx, this.deps);

    await updateKit(this.kits, userId, doc._id, (current) => {
      const merged = appendGenerated(mergeQuestionCategory(current, category, drafts), coverage.added);
      merged.coverage = { ...merged.coverage, passes: coverage.passes.length };
      const summary = { generated: drafts.length, kept: kept.length, coverage_added: coverage.added.length, passes: coverage.passes, warnings: coverage.warnings };
      return { kit: merged, extra: { regeneration: this.done(regeneration, summary) } };
    });
  }
}
