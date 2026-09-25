import type { Question } from "@prepkit/shared";
import { describe, expect, it } from "vitest";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import type { KitRequirement } from "./extractRequirements.ts";
import { generateFlashcards } from "./generateFlashcards.ts";

const req = (id: string, priority: KitRequirement["priority"] = "must"): KitRequirement => ({ id, text: `Skill ${id}`, kind: "technical", priority, evidence: `ev ${id}` });
const questions: Question[] = [{ id: "q1", requirement_ids: ["r2"], category: "technical", prompt: "p", answer_outline: "- outline r2", difficulty: 2 }];

describe("generateFlashcards", () => {
  it("filters ids, drops empties, numbers f1..fN, and code-builds a card for an uncarded must", async () => {
    const llm = fakeLLM({
      flashcards: { cards: [{ requirement_ids: ["r1", "r9"], front: "What is r1?", back: "It is r1." }, { requirement_ids: ["r1"], front: "", back: "x" }] },
    });
    const r = await generateFlashcards([req("r1"), req("r2"), req("r3", "nice")], questions, fakeDeps({ llm }));
    expect(r.flashcards).toEqual([
      { id: "f1", front: "What is r1?", back: "It is r1.", requirement_ids: ["r1"], meta: { origin: "generated", edited: false, pinned: false } },
      expect.objectContaining({ id: "f2", requirement_ids: ["r2"], back: "- outline r2", front: "What should you be ready to show about: Skill r2?" }),
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("one call per 12 requirements", async () => {
    const llm = fakeLLM({ flashcards: { cards: [] } });
    await generateFlashcards(Array.from({ length: 13 }, (_, i) => req(`r${i + 1}`, "nice")), [], fakeDeps({ llm }));
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].user).toContain("r13 [nice]");
    expect(llm.calls[1].user).not.toContain("r12 [nice]");
  });

  it("call fails → every card code-built (evidence when no question covers it) + warning", async () => {
    const failing = { complete: async () => Promise.reject(new Error("down")) };
    const r = await generateFlashcards([req("r1"), req("r2", "nice")], questions, fakeDeps({ llm: failing }));
    expect(r.flashcards.map((c) => [c.id, c.back])).toEqual([["f1", 'The job description asks for: "ev r1"'], ["f2", "- outline r2"]]);
    expect(r.warnings).toEqual(["Could not generate flashcards (INTERNAL); built simple cards from the requirements instead."]);
  });
});
