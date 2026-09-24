import robotsParser from "robots-parser";
import { RetrievalError } from "./errors.ts";
import { fetchPage, hostLimiter, USER_AGENT, type FetchOptions } from "./fetchPage.ts";

type Entry = {
  robot?: ReturnType<typeof robotsParser>;
  /** RFC 9309: robots.txt unreachable (5xx, network) → treat the whole origin as disallowed. */
  disallowAll: boolean;
  /** Why robots.txt couldn't be used, if it couldn't. */
  error?: RetrievalError;
};

const UA_TOKEN = USER_AGENT.split("/")[0];

/** robots.txt rules per origin, fetched once per instance. */
export class Robots {
  private cache = new Map<string, Promise<Entry>>();

  constructor(private fetchOpts: FetchOptions = {}) {}

  private load(origin: string): Promise<Entry> {
    let entry = this.cache.get(origin);
    if (!entry) this.cache.set(origin, (entry = this.fetchRules(origin)));
    return entry;
  }

  private async fetchRules(origin: string): Promise<Entry> {
    const url = `${origin}/robots.txt`;
    try {
      const page = await fetchPage(url, this.fetchOpts);
      const robot = robotsParser(url, page.body);
      const delay = robot.getCrawlDelay(UA_TOKEN);
      if (delay) (this.fetchOpts.limiter ?? hostLimiter).setCrawlDelay(new URL(origin).host, delay * 1000);
      return { robot, disallowAll: false };
    } catch (e) {
      const err = e instanceof RetrievalError ? e : new RetrievalError("NETWORK", String(e), url);
      // 4xx (no robots.txt) or a non-text/oversized file → no usable rules → allow all.
      const allowAll = /^HTTP_4\d\d$/.test(err.code) || err.code === "UNSUPPORTED_CONTENT_TYPE" || err.code === "TOO_LARGE";
      return { disallowAll: !allowAll, error: err };
    }
  }

  async isAllowed(url: string): Promise<boolean> {
    const entry = await this.load(new URL(url).origin);
    if (entry.disallowAll) return false;
    return entry.robot?.isAllowed(url, UA_TOKEN) ?? true;
  }

  /** Crawl delay in ms, if robots.txt sets one for us. */
  async crawlDelay(origin: string): Promise<number | undefined> {
    const delay = (await this.load(origin)).robot?.getCrawlDelay(UA_TOKEN);
    return delay ? delay * 1000 : undefined;
  }

  async sitemaps(origin: string): Promise<string[]> {
    return (await this.load(origin)).robot?.getSitemaps() ?? [];
  }

  /** The error that made robots.txt unusable for this origin, if any (for reporting). */
  async problem(origin: string): Promise<RetrievalError | undefined> {
    return (await this.load(origin)).error;
  }
}
