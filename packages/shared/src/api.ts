import type { Kit, Requirement } from "./kit.ts";

/** Response shapes of the HTTP API, shared with the web app. Dates arrive as ISO strings. */

export type KitStatus = "queued" | "running" | "done" | "failed";
export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
export type PublicUser = { id: string; email: string };

export type ProgressEvent = {
  step: string;
  status: "started" | "done" | "skipped" | "failed";
  detail?: string;
  ms?: number;
};

/** Extensions the pipeline adds on top of the graded kit shape. All optional: older or edited kits may lack them. */
export type KitRequirementView = Requirement & { evidence?: string };
export type KitResearch = {
  hiring_page_found: boolean;
  hiring_process: {
    stages: { name: string; description: string }[];
    signals: Record<string, boolean>;
    notes: string;
  } | null;
  discussion: { url: string; title: string; attribution: "domain" | "name" }[];
  skipped: { source: string; reason: string }[];
};
export type KitView = Omit<Kit, "role"> & {
  role: Omit<Kit["role"], "requirements"> & { requirements: KitRequirementView[] };
  research?: KitResearch;
  schedule_stale?: boolean;
};

export type Regeneration = {
  section: "brief" | "questions" | "gaps";
  category?: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: { code: string; message: string };
};

export type KitResponse = {
  id: string;
  userId: string;
  status: KitStatus;
  input: { jd: string; company_url: string; days: number };
  progress: ProgressEvent[];
  kit: KitView | null;
  error: { code: string; message: string } | null;
  regeneration: Regeneration | null;
  version: number;
  startedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KitSummary = {
  id: string;
  status: KitStatus;
  company: string | null;
  role: string | null;
  company_url: string;
  days: number;
  createdAt: string;
  updatedAt: string;
  counts: { requirements: number; questions: number; flashcards: number } | null;
  error: { code: string; message: string } | null;
};

export type SubmitResponse = { id: string; status: KitStatus; duplicate: boolean; retried?: boolean };
export type BatchSubmitResponse = { results: SubmitResponse[] };
