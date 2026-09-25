import type { Kit } from "@prepkit/shared";
import type { ProgressEvent } from "../pipeline/trace.ts";

export type UserDoc = { _id: string; email: string; passwordHash: string; createdAt: Date };
/** _id is sha256(token): the raw token only ever lives in the cookie. */
export type SessionDoc = { _id: string; userId: string; expiresAt: Date };

export const KIT_STATUSES = ["queued", "running", "done", "failed"] as const;
export type KitStatus = (typeof KIT_STATUSES)[number];
export type KitInput = { jd: string; company_url: string; days: number };
export type ResearchCache = { pages: { url: string; kind: string; text: string }[] };

export type Regeneration = {
  section: "brief" | "questions" | "gaps";
  category?: string;
  status: "running" | "done" | "failed";
  startedAt: Date;
  finishedAt?: Date;
  error?: { code: string; message: string };
  summary?: unknown;
};

export type KitDoc = {
  _id: string;
  userId: string;
  status: KitStatus;
  input: KitInput;
  inputHash: string;
  progress: ProgressEvent[];
  /** The kit plus its extensions (evidence, research, pipeline_trace). */
  kit: Kit | null;
  error: { code: string; message: string } | null;
  researchCache: ResearchCache | null;
  /** Bumped on every kit change; builder writes compare-and-swap on it. */
  version: number;
  /** The latest background section regeneration (absent on kits never regenerated). */
  regeneration?: Regeneration | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Unique index violated (email, or userId + inputHash). */
export class DuplicateKeyError extends Error {
  constructor(message = "duplicate key") {
    super(message);
    this.name = "DuplicateKeyError";
  }
}

export interface UserRepo {
  /** Throws DuplicateKeyError when the email is taken. */
  create(user: UserDoc): Promise<void>;
  findByEmail(email: string): Promise<UserDoc | null>;
  findById(id: string): Promise<UserDoc | null>;
}

export interface SessionRepo {
  create(session: SessionDoc): Promise<void>;
  find(id: string): Promise<SessionDoc | null>;
  delete(id: string): Promise<void>;
}

export interface KitRepo {
  /** Throws DuplicateKeyError when the user already has a kit with this inputHash. */
  insert(kit: KitDoc): Promise<void>;
  /** Owned lookup: another user's kit is simply not found. */
  get(userId: string, id: string): Promise<KitDoc | null>;
  /** Unscoped lookup, for the job runner only. */
  getById(id: string): Promise<KitDoc | null>;
  findByInputHash(userId: string, inputHash: string): Promise<KitDoc | null>;
  /** Newest first, without progress and researchCache. */
  list(userId: string): Promise<Omit<KitDoc, "progress" | "researchCache">[]>;
  /** Sets updatedAt. A missing kit (e.g. deleted mid-run) is a no-op. */
  update(id: string, patch: Partial<Omit<KitDoc, "_id" | "userId">>): Promise<void>;
  /**
   * Compare-and-swap: replace the kit (plus `extra` fields) and bump the version, only if the stored version is still
   * `expectedVersion`. False means someone else wrote first: reload and retry.
   */
  casKit(userId: string, id: string, expectedVersion: number, kit: KitDoc["kit"], extra?: Partial<Pick<KitDoc, "regeneration">>): Promise<boolean>;
  delete(userId: string, id: string): Promise<boolean>;
  findByStatus(statuses: KitStatus[]): Promise<KitDoc[]>;
}

export type Repos = { users: UserRepo; sessions: SessionRepo; kits: KitRepo };
