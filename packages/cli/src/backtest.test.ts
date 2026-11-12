import { fileURLToPath } from "node:url";
import { loadTree, validateTree } from "@kiln/definitions";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { backtestSuite, FakePullRequestSource, type PullRequest } from "./backtest";

const SHA = "3f2c1a9e5b7d4c6a8e0f1b2c3d4e5f6a7b8c9d0e";
const pr = (over: Partial<PullRequest>): PullRequest => ({
  number: 41,
  title: "Add date range filter to reports",
  body: "",
  url: "https://github.com/acme/web/pull/41",
  baseSha: SHA,
  author: "priya",
  additions: 40,
  deletions: 5,
  closingIssue: undefined,
  ...over,
});

describe("backtestSuite", () => {
  it("pins each task to the PR base commit, hides criteria from the agent and links the reference PR", () => {
    const { files } = backtestSuite("acme/web", [pr({})]);
    const task = parse(files["benchmarks/backtest/tasks/pr-41.yaml"]!);
    expect(task.startingRepoRefs).toEqual([`github.com:acme/web@${SHA}`]);
    expect(task.criteriaVisibility).toBe("judge");
    expect(task.referencePr).toBe("https://github.com/acme/web/pull/41");
    expect(task.tags).toEqual(["s"]);
    const suite = parse(files["benchmarks/backtest/suite.yaml"]!);
    expect(suite).toMatchObject({ name: "backtest", agent: "implement", tasks: ["pr-41"] });
  });

  it("takes success criteria from an acceptance criteria section or checklist", () => {
    const body =
      "Reports need filtering.\n\n## Acceptance criteria\n- Filter by start and end date\n- Empty range shows all reports\n\n## Notes\nUsed date-fns.";
    const task = parse(backtestSuite("acme/web", [pr({ body })]).files["benchmarks/backtest/tasks/pr-41.yaml"]!);
    expect(task.successCriteria).toEqual(["Filter by start and end date", "Empty range shows all reports"]);
    const list = parse(backtestSuite("acme/web", [pr({ body: "- [x] Works on Safari\n- [ ] Has a test" })]).files["benchmarks/backtest/tasks/pr-41.yaml"]!);
    expect(list.successCriteria).toEqual(["Works on Safari", "Has a test"]);
  });

  it("falls back to one criterion and prefers the linked issue as the prompt", () => {
    const task = parse(
      backtestSuite("acme/web", [
        pr({ body: "Fixes #12", closingIssue: { number: 12, title: "Reports can't be filtered", body: "Customers want a date range." } }),
      ]).files["benchmarks/backtest/tasks/pr-41.yaml"]!,
    );
    expect(task.successCriteria).toHaveLength(1);
    expect(task.successCriteria[0]).toContain("Add date range filter to reports");
    expect(task.prompt).toContain("Reports can't be filtered");
    expect(task.prompt).toContain("Customers want a date range.");
  });

  it("takes criteria from the linked issue when the PR body has none", () => {
    const closingIssue = {
      number: 12,
      title: "Reports can't be filtered",
      body: "Customers want a range.\n\n## Acceptance criteria\n- [ ] Filter by start and end date",
    };
    const task = parse(backtestSuite("acme/web", [pr({ body: "Fixes #12", closingIssue })]).files["benchmarks/backtest/tasks/pr-41.yaml"]!);
    expect(task.successCriteria).toEqual(["Filter by start and end date"]);
  });

  it("tags by size and skips bots, reverts and PRs without a base commit", () => {
    const { files, skipped } = backtestSuite("acme/web", [
      pr({ number: 1, additions: 3, deletions: 2 }),
      pr({ number: 2, additions: 500, deletions: 10 }),
      pr({ number: 3, author: "dependabot[bot]" }),
      pr({ number: 4, title: 'Revert "Add thing"' }),
      pr({ number: 5, baseSha: "abc" }),
    ]);
    expect(parse(files["benchmarks/backtest/tasks/pr-1.yaml"]!).tags).toEqual(["xs"]);
    expect(parse(files["benchmarks/backtest/tasks/pr-2.yaml"]!).tags).toEqual(["l"]);
    expect(skipped.map((s) => s.number)).toEqual([3, 4, 5]);
  });

  it("writes files that validate inside a factory tree", async () => {
    const source = new FakePullRequestSource([pr({ number: 7 }), pr({ number: 8, additions: 2, deletions: 0 })]);
    const { files } = backtestSuite("acme/web", await source.listMerged("acme/web", 20));
    const tree = { ...loadTree(fileURLToPath(new URL("../../../factories/templates/sdlc", import.meta.url))), ...files };
    const result = validateTree(tree);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("returns at most the requested number of PRs from the fake", async () => {
    const source = new FakePullRequestSource([pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 })]);
    expect(await source.listMerged("acme/web", 2)).toHaveLength(2);
  });
});
