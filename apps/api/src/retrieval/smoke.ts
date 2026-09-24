// Usage: npm run research:smoke -w @prepkit/api -- <url> [--company "Name"] [--role "Title"]
import { parseArgs } from "node:util";
import { crawlCompany } from "./crawl.ts";
import { searchInterviewDiscussion } from "./search.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { company: { type: "string" }, role: { type: "string" } },
});
const url = positionals[0];
if (!url) {
  console.log('Usage: research:smoke -- <url> [--company "Name"] [--role "Title"]');
  process.exit(1);
}

const started = Date.now();
const crawl = await crawlCompany(url);
console.log(`crawl ${crawl.startUrl} — reachable: ${crawl.reachable} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
if (crawl.error) console.log(`  error: ${crawl.error.code} ${crawl.error.message}`);
for (const p of crawl.pages) {
  console.log(`  [${p.kind}] ${p.url}  link=${p.linkScore} content=${p.contentScore}`);
  console.log(`      ${p.text.slice(0, 120).replace(/\s+/g, " ")}`);
}
console.log(`sitemaps (${crawl.sitemaps.length}):`);
for (const s of crawl.sitemaps) {
  const children = s.children !== undefined ? ` index→${s.children} children` : "";
  console.log(`  [${s.source}] ${s.url}  urls=${s.urls}${children}${s.error ? `  (${s.error})` : ""}`);
}
console.log(`skipped (${crawl.skipped.length}):`);
for (const s of crawl.skipped) console.log(`  ${s.reason}  ${s.url}`);
console.log(`hiringPageFound: ${crawl.hiringPageFound}  aboutPageFound: ${crawl.aboutPageFound}`);

const search = await searchInterviewDiscussion({ companyName: values.company ?? "", companyUrl: url, roleTitle: values.role });
console.log(`search queries: ${JSON.stringify(search.queries)}${search.skipped ? `  skipped: ${search.skipped}` : ""}`);
for (const r of search.results) console.log(`  ${r.url}  — ${r.title}`);
