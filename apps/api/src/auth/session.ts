import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions } from "express";

export const SESSION_COOKIE = "prepkit_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const newSessionToken = () => randomBytes(32).toString("base64url");
/** Only this hash is stored: a leaked sessions collection can't be replayed as cookies. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const sessionCookieOptions = (production: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
});

/** Minimal Cookie header parser: "a=1; b=2" → { a: "1", b: "2" }. First occurrence wins. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    const raw = part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}
