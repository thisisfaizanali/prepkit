import { randomUUID } from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { hashToken, newSessionToken, parseCookies, SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from "../auth/session.ts";
import { DuplicateKeyError, type Repos, type UserDoc } from "../persistence/types.ts";
import { HttpError, validate } from "./errors.ts";

export type AuthDeps = { repos: Repos; now: () => number; production: boolean; authRateLimit: number };

// Trim + lowercase before the format check, so " Ada@X.com " is accepted as ada@x.com.
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const CredentialsSchema = z.object({
  email: Email,
  password: z.string().min(8, "password must be at least 8 characters").max(200),
});

// Login doesn't re-apply the registration password policy: a wrong password is just "invalid".
const LoginSchema = z.object({ email: Email, password: z.string().min(1).max(200) });

const INVALID = () => new HttpError(401, "INVALID_CREDENTIALS", "invalid email or password");
// Verifying against a dummy hash when the email is unknown keeps login timing the same either way.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

const publicUser = (u: UserDoc) => ({ id: u._id, email: u.email });

/** The authenticated user, set by requireAuth. */
export const currentUser = (res: Response) => res.locals.user as UserDoc;

export function requireAuth({ repos, now, production }: AuthDeps): RequestHandler {
  return async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = token ? await repos.sessions.find(hashToken(token)) : null;
    const expired = session && session.expiresAt.getTime() <= now();
    if (expired) await repos.sessions.delete(session._id);
    const user = session && !expired ? await repos.users.findById(session.userId) : null;
    if (!user) {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions(production));
      throw new HttpError(401, "UNAUTHENTICATED", token ? "Your session has expired; please log in again" : "Please log in");
    }
    res.locals.user = user;
    next();
  };
}

export function authRouter(deps: AuthDeps): Router {
  const { repos, now, production } = deps;
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: deps.authRateLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => void res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts; try again in a minute" } }),
  });

  const startSession = async (res: Response, userId: string) => {
    const token = newSessionToken();
    await repos.sessions.create({ _id: hashToken(token), userId, expiresAt: new Date(now() + SESSION_TTL_MS) });
    res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(production), maxAge: SESSION_TTL_MS });
  };

  router.post("/register", limiter, async (req, res) => {
    const { email, password } = validate(CredentialsSchema, req.body);
    const user: UserDoc = { _id: randomUUID(), email, passwordHash: await hashPassword(password), createdAt: new Date(now()) };
    try {
      await repos.users.create(user);
    } catch (e) {
      if (e instanceof DuplicateKeyError) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists");
      throw e;
    }
    await startSession(res, user._id);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post("/login", limiter, async (req, res) => {
    const { email, password } = validate(LoginSchema, req.body);
    const user = await repos.users.findByEmail(email);
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok) throw INVALID();
    await startSession(res, user._id);
    res.json({ user: publicUser(user) });
  });

  router.post("/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await repos.sessions.delete(hashToken(token));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(production));
    res.status(204).end();
  });

  router.get("/me", requireAuth(deps), (_req, res) => {
    res.json({ user: publicUser(currentUser(res)) });
  });

  return router;
}
