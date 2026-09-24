import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "../kit.ts";
import { checkCoverage } from "./coverage.ts";

const req = (id: string, priority: "must" | "nice"): Requirement => ({ id, text: id, kind: "technical", priority });
const q = (id: string, requirement_ids: string[], prompt = "Why?"): Question => ({
  id, requirement_ids, prompt, category: "technical", answer_outline: "", difficulty: 1,
});
const reqs = [req("r1", "must"), req("r2", "nice"), req("r3", "must")];

describe("checkCoverage", () => {
  it("all covered → empty", () => {
    expect(checkCoverage(reqs, [q("q1", ["r1", "r2"]), q("q2", ["r3"])])).toEqual({
      uncovered_requirement_ids: [], uncovered_must_ids: [],
    });
  });

  it("splits uncovered must vs nice, in requirement order", () => {
    expect(checkCoverage(reqs, [q("q1", ["r1"])])).toEqual({
      uncovered_requirement_ids: ["r2", "r3"], uncovered_must_ids: ["r3"],
    });
  });

  it("blank prompt does not count", () => {
    expect(checkCoverage(reqs, [q("q1", ["r1", "r2", "r3"], "   ")]).uncovered_requirement_ids).toEqual(["r1", "r2", "r3"]);
  });

  it("ignores unknown requirement ids", () => {
    expect(checkCoverage(reqs, [q("q1", ["r1", "r2", "r3", "nope"])]).uncovered_requirement_ids).toEqual([]);
  });

  it("zero questions → everything uncovered", () => {
    expect(checkCoverage(reqs, [])).toEqual({ uncovered_requirement_ids: ["r1", "r2", "r3"], uncovered_must_ids: ["r1", "r3"] });
  });

  it("zero requirements → empty", () => {
    expect(checkCoverage([], [q("q1", ["r1"])])).toEqual({ uncovered_requirement_ids: [], uncovered_must_ids: [] });
  });
});
