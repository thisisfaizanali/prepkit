import { describe, expect, it } from "vitest";
import { deriveSteps } from "./steps";

describe("deriveSteps", () => {
  it("merges, orders and numbers the pipeline's events", () => {
    const steps = deriveSteps([
      { step: "extract_requirements", status: "started" },
      { step: "crawl", status: "started" },
      { step: "extract_requirements", status: "done", ms: 3000, detail: "12 requirements" },
      { step: "crawl", status: "done", ms: 5000 },
      { step: "search", status: "skipped", detail: "no key" },
      { step: "questions:technical", status: "started" },
      { step: "questions:technical", status: "done", ms: 9000 },
      { step: "coverage_check", status: "done", detail: "pass 1: uncovered r3" },
      { step: "gap:technical", status: "started" },
    ]);
    const view = steps.map((s) => `${s.label}=${s.status}`);
    expect(view).toEqual([
      "Extract requirements=done",
      "Crawl company site=done",
      "Search public discussion=skipped",
      "Hiring process=pending",
      "Company brief=pending",
      "Questions: technical=done",
      "Coverage pass 1=done",
      "Coverage pass 1: filling technical gaps=running",
      "Flashcards=pending",
      "Schedule=pending",
    ]);
    expect(steps[0]).toMatchObject({ detail: "12 requirements", ms: 3000 });
  });

  it("shows placeholders before the run starts", () => {
    expect(deriveSteps([]).every((s) => s.status === "pending")).toBe(true);
  });
});
