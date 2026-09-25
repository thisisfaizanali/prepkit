import { describe, expect, it } from "vitest";
import { LLMError } from "../../llm/client.ts";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { generateAllQuestions, generateQuestions, type QuestionContext } from "./generateQuestions.ts";
import type { QuestionJob } from "./planQuestions.ts";

const ctx: QuestionContext = {
  requirements: [
    { id: "r1", text: "TypeScript", kind: "technical", priority: "must", evidence: "TypeScript" },
    { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must", evidence: "mentoring" },
  ],
  role: { title: "Backend Engineer", seniority: "senior" },
  hiring: { stages: [{ name: "Take-home", description: "4h task" }], notes: "" },
  brief: { summary: "Acme makes anvils.", what_they_do: "Anvils for coyotes." },
  companyName: "Acme",
};
const job = (category: QuestionJob["category"], requirementIds: string[], target = 2): QuestionJob => ({ category, requirementIds, target, guidance: [] });
const q = (prompt: string, requirement_ids: string[] = ["r1"], difficulty: unknown = 2) => ({ prompt, requirement_ids, answer_outline: "- a", difficulty });

describe("generateQuestions", () => {
  it("post-processes: code sets category, unknown ids dropped, empty prompts dropped, difficulty clamped, meta set", async () => {
    const llm = fakeLLM({
      "questions:technical": { questions: [{ ...q("Explain the event loop", ["r1", "r9", "r2"], 7), category: "behavioural" }, q("  "), q("Generics?", ["r1"], "0")] },
    });
    const out = await generateQuestions(job("technical", ["r1"]), ctx, fakeDeps({ llm }));
    expect(out).toEqual([
      { requirement_ids: ["r1"], category: "technical", prompt: "Explain the event loop", answer_outline: "- a", difficulty: 3, meta: { origin: "generated", edited: false, pinned: false } },
      expect.objectContaining({ prompt: "Generics?", difficulty: 1 }),
    ]);
  });

  it("an outline returned as a list becomes bullet lines", async () => {
    const llm = fakeLLM({ "questions:behavioural": { questions: [{ prompt: "Tell me about a time…", requirement_ids: ["r2"], answer_outline: ["Situation: x", "Task: y"], difficulty: 2 }] } });
    const [out] = await generateQuestions(job("behavioural", ["r2"]), ctx, fakeDeps({ llm }));
    expect(out.answer_outline).toBe("- Situation: x\n- Task: y");
  });

  it("company-fit sees the brief; technical does not; requirements and hiring are wrapped as untrusted", async () => {
    const llm = fakeLLM({ "questions:technical": { questions: [] }, "questions:company-fit": { questions: [] } });
    await generateQuestions(job("technical", ["r1"]), ctx, fakeDeps({ llm }));
    await generateQuestions(job("company-fit", ["r2"]), ctx, fakeDeps({ llm }));
    expect(llm.calls[0].user).not.toContain("Acme makes anvils");
    expect(llm.calls[1].user).toContain('<untrusted_content source="company_brief">');
    expect(llm.calls[0].user).toContain('<untrusted_content source="requirements">');
    expect(llm.calls[0].user).toContain('<untrusted_content source="hiring_process">');
    expect(llm.calls[0].system).not.toBe(llm.calls[1].system);
  });
});

describe("generateAllQuestions", () => {
  it("numbers by category order then model order; a failed job → warning, others kept", async () => {
    const llm = fakeLLM({
      "questions:behavioural": { questions: [q("B1", ["r2"])] },
      "questions:technical": { questions: [q("T1"), q("T2")] },
    });
    const failing = {
      complete: async (req: Parameters<typeof llm.complete>[0]) => {
        if (req.label === "questions:company-fit") throw new LLMError("LLM_RATE_LIMITED", "busy");
        return llm.complete(req);
      },
    };
    const r = await generateAllQuestions([job("behavioural", ["r2"]), job("company-fit", ["r2"]), job("technical", ["r1"])], ctx, fakeDeps({ llm: failing }));
    expect(r.questions.map((x) => [x.id, x.prompt])).toEqual([["q1", "T1"], ["q2", "T2"], ["q3", "B1"]]);
    expect(r.warnings).toEqual(["Could not generate company-fit questions: LLM_RATE_LIMITED"]);
  });
});
