import type { Config } from "../config.ts";

export type Provider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  tpm: number;
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
  | { type: "fallback"; from: string; to: string; reason: string; label: string };

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

export function providersFromConfig(config: Config, only?: string): Provider[] {
  const all: Provider[] = [];
  if (config.GROQ_API_KEY) {
    all.push({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: config.GROQ_API_KEY,
      model: config.GROQ_MODEL,
      tpm: config.GROQ_TPM,
      reasoningEffort: effort(config.GROQ_REASONING_EFFORT),
    });
  }
  if (config.GEMINI_API_KEY) {
    all.push({
      name: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
      tpm: config.GEMINI_TPM,
      reasoningEffort: effort(config.GEMINI_REASONING_EFFORT),
    });
  }
  return only ? all.filter((p) => p.name === only) : all;
}

type Failure = { code: LLMErrorCode; reason: string };

export class LLMClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly windows = new Map<string, { at: number; tokens: number }[]>();

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
    let last: Failure | undefined;
    for (const [i, provider] of providers.entries()) {
      const outcome = await this.tryProvider(provider, req);
      if ("text" in outcome) return outcome;
      last = outcome;
      const next = providers[i + 1];
      if (next) this.emit({ type: "fallback", from: provider.name, to: next.name, reason: outcome.reason, label: req.label });
    }
    const messages: Record<LLMErrorCode, string> = {
      LLM_RATE_LIMITED: "All LLM providers are rate limited or out of quota",
      LLM_UNAVAILABLE: "All LLM providers are unavailable",
      LLM_BAD_REQUEST: "The LLM request was rejected",
      LLM_INVALID_OUTPUT: "The LLM returned invalid output",
    };
    throw new LLMError(last!.code, `${messages[last!.code]} (${req.label}): ${last!.reason}`);
  }

  private async tryProvider(provider: Provider, req: CompleteRequest): Promise<CompleteResult | Failure> {
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    const estimate = Math.ceil((req.system.length + req.user.length) / 4) + maxTokens;
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
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.pace(provider, estimate, req.label);

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
          this.record(provider, total);
          return { text, provider: provider.name, model: provider.model, usage: { total_tokens: total } };
        }
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        const reason = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
        if (!RETRYABLE.has(res.status)) return { code: "LLM_BAD_REQUEST", reason };
        rateLimited = res.status === 429;
        failure = { code: rateLimited ? "LLM_RATE_LIMITED" : "LLM_UNAVAILABLE", reason };
        waitMs = headerWaitMs(res.headers) ?? this.backoff(attempt);
      } catch (err) {
        // Network error, timeout, or malformed success body.
        failure = { code: "LLM_UNAVAILABLE", reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        waitMs = this.backoff(attempt);
      }

      if (waitMs > MAX_WAIT_MS) return { ...failure, reason: `${failure.reason} (wait ${waitMs}ms exceeds limit)` };
      if (attempt === MAX_ATTEMPTS) break;
      this.emit(
        rateLimited
          ? { type: "rate_limited", provider: provider.name, waitMs, label: req.label }
          : { type: "retry", provider: provider.name, attempt, reason: failure.reason, waitMs, label: req.label },
      );
      await this.sleep(waitMs);
    }
    return failure;
  }

  private backoff(attempt: number): number {
    return Math.min(BACKOFF_CAP_MS, 1000 * 2 ** (attempt - 1) + Math.floor(this.random() * 1000));
  }

  /** Sleep until the provider's 60s token window has room for `estimate`. */
  private async pace(provider: Provider, estimate: number, label: string): Promise<void> {
    const window = this.windowFor(provider);
    for (;;) {
      const now = this.now();
      while (window.length && window[0].at <= now - WINDOW_MS) window.shift();
      const used = window.reduce((sum, e) => sum + e.tokens, 0);
      if (window.length === 0 || used + estimate <= provider.tpm) return;
      const waitMs = window[0].at + WINDOW_MS - now;
      this.emit({ type: "rate_limited", provider: provider.name, waitMs, label });
      await this.sleep(waitMs);
    }
  }

  private record(provider: Provider, tokens: number): void {
    this.windowFor(provider).push({ at: this.now(), tokens });
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
