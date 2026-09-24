import * as cheerio from "cheerio";

export type ExtractedLink = { url: string; text: string };
export type ExtractedContent = { title: string; description: string; text: string; links: ExtractedLink[] };

const MAX_TEXT = 20_000;
const NOISE = "script, style, noscript, svg, iframe, form, nav, header, footer, aside, [aria-hidden=true]";
const BLOCKS = "p, div, section, article, li, h1, h2, h3, h4, h5, h6, tr, br, blockquote, pre, dt, dd";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function resolveHttp(href: string, base: string): string | undefined {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined; // mailto:, tel:, javascript:, ...
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}

export function extractContent(html: string, pageUrl: string): ExtractedContent {
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").first().attr("href");
  const base = (baseHref && resolveHttp(baseHref, pageUrl)) || pageUrl;

  // Links first: nav and footer hold the careers/about links we want.
  const links = new Map<string, string>();
  $("a[href]").each((_, el) => {
    const url = resolveHttp($(el).attr("href")!, base);
    if (!url) return;
    const text = squash($(el).text()) || squash($(el).attr("aria-label") ?? "") || squash($(el).attr("title") ?? "");
    if (!links.has(url) || (!links.get(url) && text)) links.set(url, text);
  });

  const title = squash($("title").first().text()) || squash($("h1").first().text());
  const description = squash(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
  );

  $(NOISE).remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  root.find(BLOCKS).append("\n");
  const text = root
    .text()
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

  return { title, description, text, links: [...links].map(([url, text]) => ({ url, text })) };
}
