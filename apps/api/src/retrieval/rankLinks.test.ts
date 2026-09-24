import { describe, expect, it } from "vitest";
import { HIRING_CONTENT_THRESHOLD, scoreLink, scorePageContent } from "./rankLinks.ts";

const s = (url: string, text = "") => scoreLink({ url, text });

describe("scoreLink", () => {
  it('orders "How we hire" > "Careers" > "About" > "Privacy"', () => {
    const scores = [
      s("https://a.test/how-we-hire", "How we hire"),
      s("https://a.test/careers", "Careers"),
      s("https://a.test/about", "About"),
      s("https://a.test/privacy", "Privacy"),
    ].map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scores[3]).toBeLessThanOrEqual(0);
  });

  it("classifies kinds", () => {
    expect(s("https://a.test/x", "Interview process").kind).toBe("hiring");
    expect(s("https://a.test/jobs").kind).toBe("careers");
    expect(s("https://a.test/company/mission").kind).toBe("about");
    expect(s("https://a.test/engineering").kind).toBe("engineering");
    expect(s("https://a.test/pricing").kind).toBe("other");
  });

  it("a link matching several categories no longer beats a genuine 'How we hire' link", () => {
    const multi = scoreLink({ url: "https://a.test/teams/engineering-culture", text: "Engineering team culture" });
    const hire = s("https://a.test/how-we-hire", "How we hire");
    expect(hire.score).toBeGreaterThan(multi.score);
    expect(multi.score).toBe(12); // best single category (about: anchor 8 + path 4), not about + engineering (21)
  });

  it("strong hiring path segments; 'people' and 'interview' in a path are weak", () => {
    expect(s("https://a.test/handbook/people/hiring-process").kind).toBe("hiring");
    expect(s("https://a.test/handbook/people/share-options").kind).toBe("about");
    expect(s("https://a.test/blog/interview-with-our-ceo").score).toBeLessThan(s("https://a.test/interviewing").score);
  });

  it("reports the best non-hiring category as fallbackKind", () => {
    expect(s("https://a.test/careers/how-we-hire", "How we hire")).toMatchObject({ kind: "hiring", fallbackKind: "careers" });
    expect(s("https://a.test/x", "Interview")).toMatchObject({ kind: "hiring", fallbackKind: "other" });
  });

  it("anchor text weighs more than path", () => {
    expect(s("https://a.test/x", "Careers").score).toBeGreaterThan(s("https://a.test/careers", "Go").score);
  });

  it("penalises files, queries, dated posts, locales and deep paths", () => {
    const base = s("https://a.test/careers").score;
    expect(s("https://a.test/careers.pdf").score).toBeLessThan(base);
    expect(s("https://a.test/careers?ref=x").score).toBeLessThan(base);
    expect(s("https://a.test/2023/04/careers").score).toBeLessThan(base);
    expect(s("https://a.test/fr/careers").score).toBeLessThan(base);
    expect(scoreLink({ url: "https://a.test/fr/careers", text: "" }, { startLocalised: true }).score).toBe(base);
    expect(s("https://a.test/a/b/c/d/e/careers").score).toBeLessThan(base);
  });
});

describe("scorePageContent", () => {
  it("counts distinct hiring-process phrases", () => {
    const text = "Our interview process: a recruiter screen, a take-home, then the onsite.";
    expect(scorePageContent(text)).toBeGreaterThanOrEqual(HIRING_CONTENT_THRESHOLD);
    expect(scorePageContent("We sell anvils.")).toBe(0);
  });
});
