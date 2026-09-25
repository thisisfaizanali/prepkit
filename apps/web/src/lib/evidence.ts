/**
 * Locating requirement evidence in the original JD, with the same normalisation the backend uses to accept it
 * (lowercase; every run of non-letter/digit characters becomes one space; trimmed), mapped back to the original text.
 */
const WORD = /[\p{L}\p{N}]/u;

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Normalised JD plus, for each normalised character, the index of the original character it came from. */
export function indexJd(jd: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < jd.length; ) {
    const ch = String.fromCodePoint(jd.codePointAt(i)!);
    if (WORD.test(ch)) {
      for (const c of ch.toLowerCase()) (norm += c), map.push(i);
    } else if (norm && !norm.endsWith(" ")) (norm += " "), map.push(i);
    i += ch.length;
  }
  if (norm.endsWith(" ")) (norm = norm.slice(0, -1)), map.pop();
  return { norm, map };
}

/** [start, end) of the evidence in the original JD, or null when it can't be found. */
export function findSpan(index: { norm: string; map: number[] }, jd: string, evidence: string): [number, number] | null {
  const needle = normalizeText(evidence);
  if (!needle) return null;
  const at = index.norm.indexOf(needle);
  if (at < 0) return null;
  const last = index.map[at + needle.length - 1];
  const end = last + String.fromCodePoint(jd.codePointAt(last)!).length;
  return [index.map[at], end];
}

export type Segment = { text: string; start: number; ids: string[] };

/** Splits the JD at every span boundary; each segment lists the requirement ids whose evidence covers it. */
export function segmentJd(jd: string, spans: { id: string; span: [number, number] }[]): Segment[] {
  const cuts = [...new Set([0, jd.length, ...spans.flatMap((s) => s.span)])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    out.push({ text: jd.slice(a, b), start: a, ids: spans.filter((s) => s.span[0] <= a && s.span[1] >= b).map((s) => s.id) });
  }
  return out;
}
