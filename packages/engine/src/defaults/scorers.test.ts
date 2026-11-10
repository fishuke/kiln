import { describe, expect, it } from "vitest";
import { DEFAULT_SCORERS, scorerFile } from "./scorers";

const LABELS: Record<string, [string, number][]> = {
  verbosity: [["proportionate", 1], ["verbose", 0.2], ["terse", 0.1]],
  "task-compliance": [["fully_compliant", 1], ["mostly_compliant", 0.8], ["insufficient_evidence", 0.5], ["noncompliant", 0.2]],
  "procedure-compliance": [["fully_compliant", 1], ["mostly_compliant", 0.8], ["noncompliant", 0.2]],
  efficiency: [["highly_efficient", 1], ["mostly_efficient", 0.8], ["mostly_inefficient", 0.4], ["highly_inefficient", 0.2]],
  "code-quality": [["approve", 1], ["insufficient_evidence", 0.5], ["block", 0.2]],
};

describe("default scorers", () => {
  const everyday = DEFAULT_SCORERS.filter((d) => d.kind !== "benchmark_task_correctness");

  it("ships the five everyday scorers with their labels and scores", () => {
    expect(everyday.map((d) => d.slug)).toEqual(Object.keys(LABELS));
    for (const d of everyday) expect(d.labels.map((l) => [l.value, l.score])).toEqual(LABELS[d.slug]);
  });

  it("passes at 0.5, samples 10% and has a passing and a failing label", () => {
    for (const d of everyday) {
      expect(d.passingScore).toBe(0.5);
      expect(d.samplingRate).toBe(10);
      expect(d.labels.some((l) => l.score >= d.passingScore)).toBe(true);
      expect(d.labels.some((l) => l.score < d.passingScore)).toBe(true);
    }
  });

  it("writes a full rubric with a reason format", () => {
    for (const d of everyday) {
      expect(d.rubric.startsWith("**Rubric**")).toBe(true);
      expect(d.rubric).toContain("**Assess:**");
      expect(d.rubric).toContain("**Reason**");
      expect(d.rubric.length).toBeGreaterThan(1500);
    }
  });

  it("grades code quality for implementers only and the rest for every role", () => {
    for (const d of everyday) expect(d.roles).toEqual(d.slug === "code-quality" ? ["implement"] : "all");
  });

  it("keeps self-improvement on for compliance and code quality", () => {
    const on = everyday.filter((d) => d.selfImprovement).map((d) => d.slug);
    expect(on).toEqual(["task-compliance", "procedure-compliance", "code-quality"]);
  });

  it("renders a scorer.md whose rubric is the body", () => {
    const d = everyday[0]!;
    const md = scorerFile(d, ["foreman"], "claude-haiku-5-5");
    expect(md).toContain("samplingRate: 10");
    expect(md.endsWith(`${d.rubric}\n`)).toBe(true);
  });
});
