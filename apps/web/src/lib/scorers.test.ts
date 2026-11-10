import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/frontmatter";
import { canSelfImprove, DEFAULT_SCORERS, newScorerSlug, parseScorer, scorerProblems, serializeScorer } from "./scorers";

const MD = `---
name: Task Compliance
description: Did the agent do its job?
agents:
  - implement
  - { name: foreman, includeDescendants: true }
labels:
  - { value: compliant, score: 1, description: Did it all }
  - { value: partial, score: 0.5 }
  - { value: non_compliant, score: 0 }
passingScore: 0.5
samplingRate: 25
model: claude-haiku-5-5
selfImprovement: true
runner: default
output: classification
---
**Rubric**

Check the directives.
`;

describe("scorer.md", () => {
  it("parses agents with includeDescendants and labels", () => {
    const s = parseScorer("task-compliance", MD);
    expect(s.agents).toEqual([
      { name: "implement", includeDescendants: false },
      { name: "foreman", includeDescendants: true },
    ]);
    expect(s.labels[0]).toEqual({ value: "compliant", score: 1, description: "Did it all" });
    expect(s.rubric).toBe("**Rubric**\n\nCheck the directives.");
    expect(s.runner).toBe("default");
    expect(s.extra).toEqual({ output: "classification" });
  });

  it("round-trips", () => {
    const s = parseScorer("task-compliance", MD);
    const out = serializeScorer(s);
    expect(parseFrontmatter(out).data).toEqual(parseFrontmatter(MD).data);
    expect(parseScorer("task-compliance", out)).toEqual(s);
  });

  it("rounds scores to two decimals", () => {
    const s = parseScorer("x", MD);
    s.passingScore = 0.333333;
    s.samplingRate = 12.3456;
    const data = parseFrontmatter(serializeScorer(s)).data;
    expect(data.passingScore).toBe(0.33);
    expect(data.samplingRate).toBe(12.35);
  });

  it("validates", () => {
    const s = parseScorer("x", MD);
    expect(scorerProblems(s)).toEqual({});
    expect(scorerProblems({ ...s, name: "", agents: [], labels: [] })).toMatchObject({ name: expect.any(String), agents: expect.any(String), labels: expect.any(String) });
    expect(scorerProblems({ ...s, labels: [s.labels[0]!, s.labels[0]!] }).labels).toMatch(/unique/);
  });

  it("needs a failing label for self-improvement", () => {
    expect(canSelfImprove({ passingScore: 0.5, labels: [{ value: "a", score: 1 }] })).toBe(false);
    expect(canSelfImprove({ passingScore: 0.5, labels: [{ value: "a", score: 0.2 }] })).toBe(true);
  });

  it("makes unique slugs", () => {
    expect(newScorerSlug("Code Quality", ["code-quality"])).toBe("code-quality-2");
    expect(newScorerSlug("!!", [])).toBe("scorer");
  });

  it("ships five defaults that each pass and fail", () => {
    expect(DEFAULT_SCORERS.map((d) => d.name)).toEqual(["Verbosity", "Task Compliance", "Procedure Compliance", "Efficiency", "Code Quality"]);
    for (const d of DEFAULT_SCORERS) expect(canSelfImprove(d)).toBe(true);
  });

  it("uses the classifications, thresholds and rubrics of the engine defaults", () => {
    const labels = Object.fromEntries(DEFAULT_SCORERS.map((d) => [d.slug, d.labels.map((l) => `${l.value}:${l.score}`).join(",")]));
    expect(labels).toEqual({
      verbosity: "proportionate:1,verbose:0.2,terse:0.1",
      "task-compliance": "fully_compliant:1,mostly_compliant:0.8,insufficient_evidence:0.5,noncompliant:0.2",
      "procedure-compliance": "fully_compliant:1,mostly_compliant:0.8,noncompliant:0.2",
      efficiency: "highly_efficient:1,mostly_efficient:0.8,mostly_inefficient:0.4,highly_inefficient:0.2",
      "code-quality": "approve:1,insufficient_evidence:0.5,block:0.2",
    });
    for (const d of DEFAULT_SCORERS) {
      expect([d.passingScore, d.samplingRate]).toEqual([0.5, 10]);
      expect(d.rubric).toContain("**Assess:**");
      expect(d.rubric).toContain("**Reason**");
      expect(d.rubric.length).toBeGreaterThan(1500);
    }
    expect(DEFAULT_SCORERS.filter((d) => d.selfImprovement).map((d) => d.slug)).toEqual(["task-compliance", "procedure-compliance", "code-quality"]);
  });
});
