import { describe, expect, it } from "vitest";
import { groupResults, parseSuite, parseTask, recommend, serializeSuite, serializeTask, suitesInTree, summarize, uniqueSlug, type Result } from "./benchmarks";

const r = (configuration: string, task: string, success: boolean, costUsd: number, at = "2026-10-20T10:00:00Z"): Result => ({ configuration, task, runId: `${configuration}-${task}-${at}`, success, score: success ? 1 : 0, costUsd, durationMs: 1000, at });

describe("benchmark files", () => {
  it("round-trips suite and task yaml", () => {
    const suite = parseSuite("core", "name: Core\nagent: implement\nconfigurations:\n  - name: Sonnet\n    agents: [{ agent: implement, model: claude-sonnet-5-5 }]\ntasks: [a, b]\nextraKey: 1\n");
    expect(parseSuite("core", serializeSuite(suite))).toEqual(suite);
    const task = parseTask("a", `title: Fix\nprompt: Do it\nsuccessCriteria: [works]\nstartingRepoRefs: ["github.com:o/r@${"a".repeat(40)}"]\ntags: [bug]\n`);
    expect(parseTask("a", serializeTask(task))).toEqual(task);
  });

  it("reads object repo refs", () => {
    const t = parseTask("x", `title: t\nprompt: p\nsuccessCriteria: [c]\nstartingRepoRefs: [{ codeForge: GITHUB, owner: o, repo: r, ref: ${"b".repeat(40)} }]\n`);
    expect(t.startingRepoRefs).toEqual([`github.com:o/r@${"b".repeat(40)}`]);
  });

  it("finds suites with ordered tasks", () => {
    const tree = { "benchmarks/s/suite.yaml": "name: S\nagent: a\nconfigurations: [{ name: c }]\ntasks: [two, one]\n", "benchmarks/s/tasks/one.yaml": "title: One\nprompt: p\nsuccessCriteria: [x]\nstartingRepoRefs: []\n", "benchmarks/s/tasks/two.yaml": "title: Two\nprompt: p\nsuccessCriteria: [x]\nstartingRepoRefs: []\n" };
    expect(suitesInTree(tree)[0]!.tasks.map((t) => t.slug)).toEqual(["two", "one"]);
  });

  it("makes unique slugs", () => {
    expect(uniqueSlug("Fix login", ["fix-login"])).toBe("fix-login-2");
  });
});

describe("results", () => {
  const results = [r("A", "t1", true, 1), r("A", "t2", true, 1), r("B", "t1", true, 0.2), r("B", "t2", false, 0.2), r("C", "t1", false, 2), r("C", "t2", false, 2)];
  it("summarizes and marks the Pareto frontier", () => {
    const rows = summarize(results);
    expect(rows.map((x) => [x.configuration, x.successRate, x.pareto])).toEqual([
      ["A", 1, true],
      ["B", 0.5, true],
      ["C", 0, false],
    ]);
  });
  it("recommends quality, efficiency and cost", () => {
    const recs = recommend(summarize(results));
    expect(recs.map((x) => [x.kind, x.configuration])).toEqual([
      ["overall", "A"],
      ["efficient", "B"],
    ]);
    expect(recommend(summarize([r("A", "t", true, 1)]))).toEqual([]);
  });
  it("groups configuration > task > repetition", () => {
    const g = groupResults([...results, r("A", "t1", false, 1, "2026-10-21T00:00:00Z")]);
    expect(g[0]!.tasks[0]!.reps.map((x) => x.success)).toEqual([true, false]);
  });
});
