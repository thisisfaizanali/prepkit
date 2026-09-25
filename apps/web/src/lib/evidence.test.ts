import { describe, expect, it } from "vitest";
import { findSpan, indexJd, segmentJd } from "./evidence";

describe("evidence spans", () => {
  const jd = "Requirements\n- Strong proficiency in Python   or Go!\n- Hands-on Kafka";

  it("finds evidence despite case, bullets, punctuation and spacing, mapped to original offsets", () => {
    const span = findSpan(indexJd(jd), jd, "strong proficiency in python or go");
    expect(span && jd.slice(...span)).toBe("Strong proficiency in Python   or Go");
    const kafka = findSpan(indexJd(jd), jd, "- hands on Kafka");
    expect(kafka && jd.slice(...kafka)).toBe("Hands-on Kafka");
  });

  it("returns null when the evidence isn't there", () => {
    expect(findSpan(indexJd(jd), jd, "Rust")).toBeNull();
  });

  it("segments overlapping spans", () => {
    const segs = segmentJd("abcdef", [{ id: "r1", span: [0, 4] }, { id: "r2", span: [2, 6] }]);
    expect(segs.map((s) => [s.text, s.ids.join()])).toEqual([["ab", "r1"], ["cd", "r1,r2"], ["ef", "r2"]]);
  });
});
