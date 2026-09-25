import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { Regenerator } from "../jobs/regenerate.ts";
import type { JobQueue } from "../jobs/runner.ts";
import { LLMError } from "../llm/client.ts";
import type { Repos } from "../persistence/types.ts";
import { authRouter, requireAuth, type AuthDeps } from "./auth.ts";
import { errorHandler, notFound } from "./errors.ts";
import { builderRouter } from "./builder.ts";
import { kitsRouter } from "./kits.ts";

export type AppDeps = {
  repos: Repos;
  /** Where new and retried kits are sent for generation. */
  jobs: JobQueue;
  /** Section regeneration worker. Defaults to one whose LLM is unavailable (enough for tests that don't regenerate). */
  regen?: Regenerator;
  now?: () => number;
  production?: boolean;
  /** Enables CORS (with credentials) for this origin only. */
  webOrigin?: string;
  /** Login/register attempts per minute per IP. */
  authRateLimit?: number;
};

/** CORS for one trusted origin; skipped entirely when WEB_ORIGIN isn't set (same-origin via Next rewrites). */
const cors = (origin: string): RequestHandler => (req, res, next) => {
  if (req.headers.origin === origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.status(204).end();
      return;
    }
  }
  next();
};

export function createApp(deps: AppDeps): Express {
  const auth: AuthDeps = {
    repos: deps.repos,
    now: deps.now ?? Date.now,
    production: deps.production ?? process.env.NODE_ENV === "production",
    authRateLimit: deps.authRateLimit ?? 10,
  };
  const app = express();
  app.set("trust proxy", 1); // Render terminates TLS in front of us: req.ip and secure cookies need X-Forwarded-*
  app.disable("x-powered-by");
  app.use(helmet());
  if (deps.webOrigin) app.use(cors(deps.webOrigin));
  app.use(express.json({ limit: "300kb" }));

  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  app.use("/api/auth", authRouter(auth));
  const regen =
    deps.regen ??
    new Regenerator(deps.repos.kits, {
      llm: { complete: () => Promise.reject(new LLMError("LLM_UNAVAILABLE", "No LLM configured for regeneration")) },
      now: auth.now,
    });
  app.use("/api/kits", requireAuth(auth), builderRouter({ kits: deps.repos.kits, regen }), kitsRouter({ kits: deps.repos.kits, queue: deps.jobs, now: auth.now }));

  app.use(() => {
    throw notFound("No such endpoint");
  });
  app.use(errorHandler);
  return app;
}
