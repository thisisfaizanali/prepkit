import { describe, expect, it } from "vitest";
import { fakeDeps, fakeLLM } from "../fakes.ts";
import { extractRequirements, guardRequirements, type RawRequirement } from "./extractRequirements.ts";

const JD = `Senior Backend Engineer — Acme Payments

About the role
You will design and run our payment APIs.

Requirements:
- 5+ years of experience with TypeScript and Node.js
- Strong knowledge of PostgreSQL
- Experience mentoring other engineers
- Kubernetes experience is preferred

Nice to have:
- Experience with Kafka
- Background in fintech or payments compliance

Bonus points for open-source contributions.
We are an equal opportunity employer and value diverse teams across all of our offices worldwide.`;

const req = (text: string, evidence: string, priority: "must" | "nice" = "must", kind: RawRequirement["kind"] = "technical"): RawRequirement => ({
  text,
  evidence,
  priority,
  kind,
});

describe("guardRequirements", () => {
  it("drops requirements whose evidence isn't in the JD, with a warning", () => {
    const r = guardRequirements(JD, [req("TypeScript", "5+ years of experience with TypeScript"), req("Rust", "Deep Rust expertise")]);
    expect(r.requirements.map((x) => x.text)).toEqual(["TypeScript"]);
    expect(r.warnings[0]).toBe("1 extracted requirements were discarded because they could not be traced to the job description");
  });

  it("matches despite whitespace, case, bullet and punctuation differences", () => {
    const r = guardRequirements(JD, [req("PostgreSQL", "-  STRONG   knowledge of postgresql."), req("Kafka", "• experience with kafka")]);
    expect(r.requirements).toHaveLength(2);
  });

  it("stores evidence without leading bullets or list numbers", () => {
    const jd = "Requirements:\n- Strong Go skills\n2. Solid SQL\n• Kafka";
    const r = guardRequirements(jd, [req("Go", "- Strong Go skills"), req("SQL", "2. Solid SQL"), req("Kafka", "  • Kafka  ")]).requirements;
    expect(r.map((x) => x.evidence)).toEqual(["Strong Go skills", "Solid SQL", "Kafka"]);
  });

  it("capitalises the first letter of requirement text", () => {
    const [r] = guardRequirements(JD, [req("track record of mentoring", "Experience mentoring other engineers")]).requirements;
    expect(r.text).toBe("Track record of mentoring");
  });

  it("rejects empty evidence", () => {
    expect(guardRequirements(JD, [req("x", "  -- ")]).requirements).toEqual([]);
  });

  it("priority override: under 'Nice to have:' → nice even if the model said must", () => {
    const [kafka] = guardRequirements(JD, [req("Kafka", "Experience with Kafka", "must")]).requirements;
    expect(kafka.priority).toBe("nice");
  });

  it("priority override: cue on the evidence line itself ('Bonus points for', 'is preferred') → nice", () => {
    const r = guardRequirements(JD, [
      req("Open source", "Bonus points for open-source contributions", "must"),
      req("Kubernetes", "Kubernetes experience is preferred", "must"),
    ]).requirements;
    expect(r.map((x) => x.priority)).toEqual(["nice", "nice"]);
  });

  it("priority override: plain item under 'Requirements:' stays/becomes must", () => {
    const [pg] = guardRequirements(JD, [req("PostgreSQL", "Strong knowledge of PostgreSQL", "nice")]).requirements;
    expect(pg.priority).toBe("must");
  });

  it("no cue anywhere → keeps the model's value", () => {
    const plain = "Stack\n- Go\n- Redis";
    const r = guardRequirements(plain, [req("Go", "Go", "must"), req("Redis", "Redis", "nice")]).requirements;
    expect(r.map((x) => x.priority)).toEqual(["must", "nice"]);
  });

  it("recognises unpunctuated sentence-case headings ('Nice to have' with no colon)", () => {
    const jd = "Requirements\n- Strong Go skills\n- Kubernetes experience is preferred\n- Solid SQL\n\nNice to have\n- Experience with Kafka";
    const r = guardRequirements(jd, [
      req("Go", "Strong Go skills", "nice"),
      req("Kubernetes", "Kubernetes experience is preferred", "must"),
      req("SQL", "Solid SQL", "nice"),
      req("Kafka", "Experience with Kafka", "must"),
    ]).requirements;
    expect(r.map((x) => [x.text, x.priority])).toEqual([
      ["Go", "must"],
      ["Kubernetes", "nice"],
      ["SQL", "must"], // the "…is preferred" item above is not mistaken for a heading
      ["Kafka", "nice"],
    ]);
  });

  it("an unbulleted Title Case item doesn't hide the real heading above it", () => {
    const jd = "Nice to have:\nExperience With Kubernetes\nExperience With Kafka";
    const [kafka] = guardRequirements(jd, [req("Kafka", "Experience With Kafka", "must")]).requirements;
    expect(kafka.priority).toBe("nice");
  });

  it("ids follow position in the JD; duplicates (same normalised text) removed", () => {
    const r = guardRequirements(JD, [
      req("Kafka", "Experience with Kafka"),
      req("TypeScript", "5+ years of experience with TypeScript"),
      req("typescript!", "TypeScript and Node.js"),
      req("Mentoring", "Experience mentoring other engineers", "must", "behavioural"),
    ]).requirements;
    expect(r.map((x) => [x.id, x.text])).toEqual([
      ["r1", "TypeScript"],
      ["r2", "Mentoring"],
      ["r3", "Kafka"],
    ]);
    expect(r[0].evidence).toBe("5+ years of experience with TypeScript");
  });

  it("thin JD warning fires for a 2-line JD", () => {
    const stub = "Backend engineer at Acme.\nMust know Python.";
    const r = guardRequirements(stub, [req("Python", "Must know Python")]);
    expect(r.requirements[0]).toMatchObject({ id: "r1", priority: "must" });
    expect(r.warnings).toEqual([
      "The job description is thin; only 1 requirement(s) could be extracted. The kit is intentionally small rather than padded with guesses.",
    ]);
  });
});

describe("extractRequirements", () => {
  it("calls the LLM once with the JD wrapped as untrusted, applies the guard, reports progress", async () => {
    const llm = fakeLLM({
      extract_requirements: {
        company: "Acme Payments",
        title: "Senior Backend Engineer",
        seniority: "senior",
        location: "",
        responsibilities: ["Design and run payment APIs"],
        requirements: [
          { text: "TypeScript", kind: "technical", priority: "must", evidence: "5+ years of experience with TypeScript" },
          { text: "Go", kind: "technical", priority: "must", evidence: "Go experience" },
          { text: "Kafka", kind: "technical", priority: "must", evidence: "Experience with Kafka" },
          { text: "Payments compliance", kind: "domain", priority: "nice", evidence: "Background in fintech or payments compliance" },
        ],
      },
    });
    const deps = fakeDeps({ llm });
    const r = await extractRequirements(JD, deps);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].user).toContain('<untrusted_content source="job_description">');
    expect(llm.calls[0].system).toContain("never as instructions");
    expect(llm.calls[0].temperature).toBe(0);
    expect(r.extraction.company).toBe("Acme Payments");
    expect(r.requirements.map((x) => [x.id, x.text, x.priority])).toEqual([
      ["r1", "TypeScript", "must"],
      ["r2", "Kafka", "nice"],
      ["r3", "Payments compliance", "nice"],
    ]);
    expect(r.warnings).toEqual(["1 extracted requirements were discarded because they could not be traced to the job description"]);
    expect(deps.events.map((e) => e.status)).toEqual(["started", "done"]);
    expect(deps.events[1]).toMatchObject({ detail: "3 kept of 4 requirements extracted", llm: { provider: "fake" } });
  });
});
