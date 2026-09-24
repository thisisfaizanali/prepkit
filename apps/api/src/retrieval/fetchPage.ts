import { config } from "../config.ts";
import { RetrievalError } from "./errors.ts";
import { assertFetchable } from "./urlGuard.ts";

export const USER_AGENT = "PrepkitBot/1.0 (interview prep research)";

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Per-host politeness: ≤ maxConcurrent in flight, ≥ gap between request starts (robots crawl-delay, capped). */
export class HostLimiter {
  private hosts = new Map<string, { active: number; nextStart: number; waiters: (() => void)[] }>();
  private delays = new Map<string, number>();

  constructor(
    private maxConcurrent = 2,
    private minGapMs = 500,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = sleepReal,
  ) {}

  setCrawlDelay(host: string, ms: number): void {
    this.delays.set(host, Math.min(ms, 5000));
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    let h = this.hosts.get(host);
    if (!h) this.hosts.set(host, (h = { active: 0, nextStart: 0, waiters: [] }));
    while (h.active >= this.maxConcurrent) await new Promise<void>((r) => h.waiters.push(r));
    h.active++;
    try {
      const start = Math.max(this.now(), h.nextStart);
      h.nextStart = start + Math.max(this.minGapMs, this.delays.get(host) ?? 0);
      const wait = start - this.now();
      if (wait > 0) await this.sleep(wait);
      return await fn();
    } finally {
      h.active--;
      h.waiters.shift()?.();
    }
  }

  reset(): void {
    this.hosts.clear();
    this.delays.clear();
  }
}

export const hostLimiter = new HostLimiter();

export type FetchOptions = {
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** Also accept application/xml and text/xml (sitemaps). */
  allowXml?: boolean;
  /** Body cap; reading stops here and the page is returned truncated. Default 2 MB, or 5 MB with allowXml. */
  maxBytes?: number;
  /** Checks every hop, including redirects. Defaults to assertFetchable with allowPrivate. */
  guard?: (url: URL) => Promise<void>;
  limiter?: HostLimiter;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type FetchedPage = { url: string; status: number; contentType: string; body: string; truncated: boolean };

const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const XML_MAX_BYTES = 5 * 1024 * 1024; // sitemaps are legitimately bigger than pages
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const HTML_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];
const XML_TYPES = ["application/xml", "text/xml"];

class Retryable extends Error {
  constructor(
    public inner: RetrievalError,
    public retryAfterMs?: number,
  ) {
    super(inner.message);
  }
}

export async function fetchPage(input: string | URL, opts: FetchOptions = {}): Promise<FetchedPage> {
  const url = new URL(input);
  const sleep = opts.sleep ?? sleepReal;
  const random = opts.random ?? Math.random;
  let last: RetrievalError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce(url, opts);
    } catch (e) {
      if (!(e instanceof Retryable)) throw e;
      last = e.inner;
      if (attempt === MAX_ATTEMPTS) break;
      const backoff = 500 * 2 ** (attempt - 1) + Math.floor(random() * 250);
      await sleep(e.retryAfterMs !== undefined && e.retryAfterMs <= MAX_RETRY_AFTER_MS ? e.retryAfterMs : backoff);
    }
  }
  throw new RetrievalError("UNREACHABLE", `Gave up after ${MAX_ATTEMPTS} attempts: ${last!.message}`, url.href);
}

async function fetchOnce(start: URL, opts: FetchOptions): Promise<FetchedPage> {
  const guard = opts.guard ?? ((u: URL) => assertFetchable(u, { allowPrivate: opts.allowPrivate ?? config.ALLOW_PRIVATE_URLS }));
  const limiter = opts.limiter ?? hostLimiter;
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await guard(current);
    const result = await limiter.run(current.host, () => request(current, opts));
    if ("redirect" in result) {
      current = result.redirect;
      continue;
    }
    return result;
  }
  throw new RetrievalError("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects`, start.href);
}

async function request(url: URL, opts: FetchOptions): Promise<FetchedPage | { redirect: URL }> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    throw new Retryable(
      new RetrievalError(timedOut ? "TIMEOUT" : "NETWORK", `${err.message}${err.cause ? ` (${(err.cause as Error).message})` : ""}`, url.href),
    );
  }

  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    await res.body?.cancel();
    return { redirect: new URL(location, url) };
  }
  if (res.status === 429 || res.status >= 500) {
    await res.body?.cancel();
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new Retryable(
      new RetrievalError(`HTTP_${res.status}`, `HTTP ${res.status}`, url.href),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }
  if (res.status >= 400) {
    await res.body?.cancel();
    throw new RetrievalError(`HTTP_${res.status}`, `HTTP ${res.status}`, url.href);
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const allowed = opts.allowXml ? [...HTML_TYPES, ...XML_TYPES] : HTML_TYPES;
  if (!allowed.includes(contentType)) {
    await res.body?.cancel();
    throw new RetrievalError("UNSUPPORTED_CONTENT_TYPE", `Unsupported content type "${contentType || "none"}"`, url.href);
  }

  const { body, truncated } = await readCapped(res, opts.maxBytes ?? (opts.allowXml ? XML_MAX_BYTES : PAGE_MAX_BYTES));
  return { url: url.href, status: res.status, contentType, body, truncated };
}

/** Read the body stream up to maxBytes, then stop and return what we have (content-length is not trusted). */
async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { body: body + decoder.decode(), truncated: false };
    const room = maxBytes - total;
    if (value.byteLength > room) {
      body += decoder.decode(value.subarray(0, room)); // final decode drops a split multi-byte char
      await reader.cancel();
      return { body, truncated: true };
    }
    total += value.byteLength;
    body += decoder.decode(value, { stream: true });
  }
}
