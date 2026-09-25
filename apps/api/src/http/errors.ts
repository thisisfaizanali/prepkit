import type { ErrorRequestHandler } from "express";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, "NOT_FOUND", what);

/** Parse or throw 400 VALIDATION_ERROR with per-field details. */
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new HttpError(400, "VALIDATION_ERROR", details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; "), details);
}

/** Structured { error: { code, message } } for everything; never a stack trace. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  // body-parser errors
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" } });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};
