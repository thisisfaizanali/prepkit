import { MAX_BATCH } from "@prepkit/shared";
import { parseCsv } from "./csv";

/** A form row as typed (days is a string until submit). */
export type Draft = { jd: string; company_url: string; days: string };
export const emptyDraft = (): Draft => ({ jd: "", company_url: "", days: "7" });

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const toDraft = (o: Record<string, unknown>): Draft => ({
  jd: str(o.jd),
  company_url: str(o.company_url),
  days: o.days == null || o.days === "" ? "7" : str(o.days),
});

/**
 * JSON: an array of { jd, company_url, days? } (the grader's case shape with `id` works too).
 * CSV: header row with jd, company_url and optionally days, in any order.
 * Throws with a plain-language message when the file can't be read at all; per-row problems are left to validation.
 */
export function parseImport(fileName: string, text: string): Draft[] {
  let drafts: Draft[];
  if (/\.json$/i.test(fileName)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("This JSON file isn't valid JSON.");
    }
    if (!Array.isArray(data)) throw new Error("The JSON file must contain an array of roles, like [{ \"jd\": …, \"company_url\": …, \"days\": 7 }].");
    drafts = data.map((d) => toDraft(d && typeof d === "object" ? (d as Record<string, unknown>) : {}));
  } else if (/\.csv$/i.test(fileName)) {
    const [header, ...rows] = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ""));
    const cols = (header ?? []).map((h) => h.trim().toLowerCase());
    if (!cols.includes("jd") || !cols.includes("company_url")) throw new Error("The CSV file needs a header row with jd, company_url and days columns.");
    drafts = rows.map((r) => toDraft(Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ""]))));
  } else {
    throw new Error("Upload a .json or .csv file.");
  }
  if (drafts.length === 0) throw new Error("The file has no roles in it.");
  if (drafts.length > MAX_BATCH) throw new Error(`The file has ${drafts.length} roles; the limit is ${MAX_BATCH} at a time.`);
  return drafts;
}
