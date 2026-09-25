import type { Config } from "../config.ts";

export type Provider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  tpm: number;
  /** Requests per minute budget. */
  rpm: number;
  /** Sent as `reasoning_effort` when set. */
  reasoningEffort?: string;
};

export type LLMErrorCode = "LLM_RATE_LIMITED" | "LLM_UNAVAILABLE" | "LLM_BAD_REQUEST" | "LLM_INVALID_OUTPUT";

export class LLMError extends Error {
  constructor(
    public code: LLMErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export type LLMEvent =
  | { type: "rate_limited"; provider: string; waitMs: number; label: string }
  | { type: "retry"; provider: string; attempt: number; reason: string; waitMs: number; label: string }
  | { type: "fallback"; from: string; to: string; reason: string; label: string }
  | { type: "spillover"; from: string; to: string; reason: "pacing" | "cooldown"; waitMs: number; label: string }
  | { type: "cooldown"; provider: string; ms: number; reason: string; label: string };

export type CompleteRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  label: string;
};

export type CompleteResult = { text: string; provider: string; model: string; usage: { total_tokens: number } };

export type ClientDeps = {
  providers: Provider[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onEvent?: (e: LLMEvent) => void;
  timeoutMs?: number;
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_WAIT_MS = 60_000; // longer than this = quota exhausted, move to next provider
const SPILLOVER_WAIT_MS = 5_000; // primary would pace-wait longer than this → use the next provider instead
const COOLDOWN_MS = 60_000; // skip a provider this long after it exhausts retries or is overloaded
const OVERLOADED_STRIKES = 2; // consecutive 503s that put a provider on cooldown
const FAST_FAILOVER_ATTEMPTS = 2; // attempts before failing over while a healthy alternative exists
const BACKOFF_CAP_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Parse Groq-style durations: "7.66s", "1m2.5s", "450ms", "2h", or a bare number of seconds. */
export function parseDuration(value: string): number | undefined {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const units: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };
  const parts = [...v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (parts.length === 0 || parts.map((p) => p[0]).join("") !== v) return undefined;
  return Math.round(parts.reduce((sum, [, n, unit]) => sum + Number(n) * units[unit], 0));
}

/** Wait requested by the server: retry-after first, else the larger of Groq's reset headers. */
function headerWaitMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim())) return Math.round(Number(retryAfter) * 1000);
  const resets = ["x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"]
    .map((h) => headers.get(h))
    .map((v) => (v ? parseDuration(v) : undefined))
    .filter((v): v is number => v !== undefined);
  return resets.length ? Math.max(...resets) : undefined;
}

const effort = (v: string) => (v === "off" ? undefined : v);

/** Order: groq primary → groq secondary → gemini. */
export function providersFromConfig(config: Config, only?: string): Provider[] {
  const all: Provider[] = [];
  if (config.GROQ_API_KEY) {
    all.push({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: config.GROQ_API_KEY,
      model: config.GROQ_MODEL,
      tpm: config.GROQ_TPM,
      rpm: config.GROQ_RPM,
      reasoningEffort: effort(config.GROQ_REASONING_EFFORT),
    });
    if (config.GROQ_SECONDARY_MODEL !== "off") {
      all.push({
        name: "groq-secondary",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_SECONDARY_MODEL,
        tpm: config.GROQ_SECONDARY_TPM,
        rpm: config.GROQ_SECONDARY_RPM,
        reasoningEffort: effort(config.GROQ_REASONING_EFFORT),
      });
    }
  }
  if (config.GEMINI_API_KEY) {
    all.push({
      name: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
      tpm: config.GEMINI_TPM,
      rpm: config.GEMINI_RPM,
      reasoningEffort: effort(config.GEMINI_REASONING_EFFORT),
    });
  }
  return only ? all.filter((p) => p.name === only) : all;
}

type Failure = { code: LLMErrorCode; reason: string };

const estimateTokens = (req: CompleteRequest) =>
  Math.ceil((req.system.length + req.user.length) / 4) + (req.maxTokens ?? DEFAULT_MAX_TOKENS);

export class LLMClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  /** Per provider: requests started in the last 60s and the tokens each used (estimate until the real count is known). */
  private readonly windows = new Map<string, { at: number; tokens: number }[]>();
  /** Provider name → time its cooldown ends. */
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly deps: ClientDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.timeoutMs = deps.timeoutMs ?? 60_000;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const { providers } = this.deps;
    if (providers.length === 0) {
      throw new LLMError("LLM_UNAVAILABLE", "No LLM provider configured: set GROQ_API_KEY (and optionally GEMINI_API_KEY) in .env");
    }
    const ordered = this.spillover(providers, req);
    const seen = new Set<LLMErrorCode>(); // every failure kind hit on any attempt, any provider
    const reasons: string[] = [];
    for (const [i, provider] of ordered.entries()) {
      // Fail over fast while a healthy alternative remains; the last available provider gets the full budget.
      const hasAlternative = ordered.slice(i + 1).some((p) => !this.cooling(p));
      const outcome = await this.tryProvider(provider, req, seen, hasAlternative ? FAST_FAILOVER_ATTEMPTS : MAX_ATTEMPTS);
      if ("text" in outcome) return outcome;
      reasons.push(`${provider.name}: ${outcome.reason}`);
      const next = ordered[i + 1];
      if (next) this.emit({ type: "fallback", from: provider.name, to: next.name, reason: outcome.reason, label: req.label });
    }
    const messages: Record<LLMErrorCode, string> = {
      LLM_RATE_LIMITED: "All LLM providers are rate limited or out of quota",
      LLM_UNAVAILABLE: "All LLM providers are unavailable",
      LLM_BAD_REQUEST: "The LLM request was rejected",
      LLM_INVALID_OUTPUT: "The LLM returned invalid output",
    };
    // Most meaningful first: rate limits (wait and retry later) > outages > our request being rejected.
    const code = (["LLM_RATE_LIMITED", "LLM_UNAVAILABLE"] as const).find((c) => seen.has(c)) ?? "LLM_BAD_REQUEST";
    throw new LLMError(code, `${messages[code]} (${req.label}): ${reasons.join("; ")}`);
  }

  private async tryProvider(
    provider: Provider,
    req: CompleteRequest,
    seen: Set<LLMErrorCode>,
    maxAttempts: number,
  ): Promise<CompleteResult | Failure> {
    const estimate = estimateTokens(req);
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    const body = JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      temperature: req.temperature ?? 0.2,
      max_tokens: maxTokens,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
    });

    let failure: Failure = { code: "LLM_UNAVAILABLE", reason: "no attempt made" };
    let overloadedInARow = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.pace(provider, estimate, req.label);
      const slot = { at: this.now(), tokens: estimate };
      this.windowFor(provider).push(slot);

      let waitMs: number;
      let rateLimited = false;
      try {
        const res = await this.fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string | null } }[];
            usage?: { total_tokens?: number };
          };
          const text = data.choices?.[0]?.message?.content;
          if (typeof text !== "string") throw new Error("response had no message content");
          const total = data.usage?.total_tokens ?? estimate;
          slot.tokens = total;
          return { text, provider: provider.name, model: provider.model, usage: { total_tokens: total } };
        }
        slot.tokens = 0; // a rejected request still counts against RPM, but used no tokens
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        const reason = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
        if (!RETRYABLE.has(res.status)) {
          seen.add("LLM_BAD_REQUEST");
          return { code: "LLM_BAD_REQUEST", reason };
        }
        rateLimited = res.status === 429;
        failure = { code: rateLimited ? "LLM_RATE_LIMITED" : "LLM_UNAVAILABLE", reason };
        seen.add(failure.code);
        waitMs = headerWaitMs(res.headers) ?? this.backoff(attempt);
        overloadedInARow = res.status === 503 ? overloadedInARow + 1 : 0;
        if (overloadedInARow === OVERLOADED_STRIKES) {
          this.coolDown(provider, `${OVERLOADED_STRIKES} consecutive 503s`, req.label);
          // Leave now if someone else can take the call; the last available provider keeps retrying.
          if (maxAttempts < MAX_ATTEMPTS) return failure;
        }
      } catch (err) {
        // Network error, timeout, or malformed success body.
        slot.tokens = 0;
        overloadedInARow = 0;
        failure = { code: "LLM_UNAVAILABLE", reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        seen.add(failure.code);
        waitMs = this.backoff(attempt);
      }

      if (waitMs > MAX_WAIT_MS) return { ...failure, reason: `${failure.reason} (wait ${waitMs}ms exceeds limit)` };
      if (attempt === maxAttempts) break;
      this.emit(
        rateLimited
          ? { type: "rate_limited", provider: provider.name, waitMs, label: req.label }
          : { type: "retry", provider: provider.name, attempt, reason: failure.reason, waitMs, label: req.label },
      );
      await this.sleep(waitMs);
    }
    if (!this.cooling(provider)) this.coolDown(provider, `retries exhausted (${failure.reason.slice(0, 80)})`, req.label);
    return failure;
  }

  private cooling(provider: Provider): boolean {
    return (this.cooldowns.get(provider.name) ?? 0) > this.now();
  }

  private coolDown(provider: Provider, reason: string, label: string): void {
    this.cooldowns.set(provider.name, this.now() + COOLDOWN_MS);
    this.emit({ type: "cooldown", provider: provider.name, ms: COOLDOWN_MS, reason, label });
  }

  private backoff(attempt: number): number {
    return Math.min(BACKOFF_CAP_MS, 1000 * 2 ** (attempt - 1) + Math.floor(this.random() * 1000));
  }

  /**
   * Put the provider that can serve now first: the first non-cooling one (in configured order) whose pacing wait is ≤ 5s,
   * else the one with the smallest wait. Error fallback then continues through the rest in order.
   */
  private spillover(providers: Provider[], req: CompleteRequest): Provider[] {
    // Cooled-down providers are skipped (kept last, for error fallback) unless all are cooling:
    // then the one whose cooldown ends first goes first.
    const active = providers.filter((p) => !this.cooling(p));
    const cooling = providers.filter((p) => this.cooling(p)).sort((a, b) => this.cooldowns.get(a.name)! - this.cooldowns.get(b.name)!);
    let ordered: Provider[];
    if (active.length === 0) {
      ordered = cooling;
    } else {
      const estimate = estimateTokens(req);
      const waits = active.map((p) => this.waitMs(p, estimate));
      let chosen = waits.findIndex((w) => w <= SPILLOVER_WAIT_MS);
      if (chosen < 0) chosen = waits.indexOf(Math.min(...waits));
      ordered = [active[chosen], ...active.filter((_, i) => i !== chosen), ...cooling];
    }
    if (ordered[0] !== providers[0]) {
      const reason = this.cooling(providers[0]) ? "cooldown" : "pacing";
      const waitMs = this.waitMs(providers[0], estimateTokens(req));
      this.emit({ type: "spillover", from: providers[0].name, to: ordered[0].name, reason, waitMs, label: req.label });
    }
    return ordered;
  }

  /** How long until the provider's 60s window has room for one more request of `estimate` tokens. */
  private waitMs(provider: Provider, estimate: number): number {
    const now = this.now();
    const window = this.windowFor(provider);
    while (window.length && window[0].at <= now - WINDOW_MS) window.shift();
    const expiry = (i: number) => window[i].at + WINDOW_MS - now;

    let rpmWait = 0;
    if (window.length >= provider.rpm) rpmWait = expiry(window.length - provider.rpm);

    let tokenWait = 0;
    let used = window.reduce((sum, e) => sum + e.tokens, 0);
    // Oldest entries age out first; wait until enough have gone (an estimate > tpm just waits for an empty window).
    for (let i = 0; i < window.length && used + estimate > provider.tpm; i++) {
      used -= window[i].tokens;
      tokenWait = expiry(i);
    }
    return Math.max(rpmWait, tokenWait, 0);
  }

  /** Sleep until the provider's window has room (tokens and requests). */
  private async pace(provider: Provider, estimate: number, label: string): Promise<void> {
    for (let waitMs = this.waitMs(provider, estimate); waitMs > 0; waitMs = this.waitMs(provider, estimate)) {
      this.emit({ type: "rate_limited", provider: provider.name, waitMs, label });
      await this.sleep(waitMs);
    }
  }

  private windowFor(provider: Provider) {
    let w = this.windows.get(provider.name);
    if (!w) this.windows.set(provider.name, (w = []));
    return w;
  }

  private emit(e: LLMEvent): void {
    this.deps.onEvent?.(e);
  }
}
