import { describe, expect, it } from "vitest";
import { parseRange } from "./chart";
import { allPages, buildDashboard, withReportedPrs, type RunLite, type WorkItemLite } from "./dashboard-data";

const range = parseRange({ range: "7d" }, new Date("2026-10-20T12:00:00Z"));
const wi = (id: string, extra: Partial<WorkItemLite>): WorkItemLite => ({ id, title: id, state: "building", requester: "ann@x", source: { provider: "kiln" }, humanTouches: 1, createdAt: "2026-10-19T08:00:00Z", updatedAt: "2026-10-19T08:00:00Z", ...extra });
const run = (id: string, extra: Partial<RunLite>): RunLite => ({ id, agent: "implement", agentType: "IMPLEMENT", status: "succeeded", harness: "claude-code", model: "claude-sonnet-5-5", costUsd: 1, startedAt: "2026-10-19T09:00:00Z", ...extra });

describe("buildDashboard", () => {
  const items = [
    wi("a", { pr: { repo: "o/r", number: 1, url: "u" }, state: "complete", completion: { by: "merge" }, completedAt: "2026-10-20T08:00:00Z", humanTouches: 1, triage: { size: "s" } }),
    wi("b", { pr: { repo: "o/r", number: 2, url: "u" }, humanTouches: 3 }),
    wi("old", { pr: { repo: "o/r", number: 0, url: "u" }, createdAt: "2026-10-10T08:00:00Z", state: "complete", completion: { by: "merge" }, completedAt: "2026-10-11T08:00:00Z", humanTouches: 4 }),
  ];
  const runs = [
    run("1", { workItemId: "a", costUsd: 3 }),
    run("2", { workItemId: "a", agent: "review", agentType: "REVIEW", model: "gpt-6", costUsd: 1, parentRunId: "1" }),
    run("3", { workItemId: "b", agent: "foreman", agentType: "FOREMAN", costUsd: 2 }),
    run("4", { workItemId: "old", costUsd: 10, startedAt: "2026-10-10T09:00:00Z" }),
  ];
  const d = buildDashboard({ runs, items, scores: [], range });

  it("computes KPIs with period deltas", () => {
    const k = Object.fromEntries(d.kpis.map((x) => [x.key, x]));
    expect(k.opened!.value).toBe(2);
    expect(k.merged!.value).toBe(1);
    expect(k.autonomy!.value).toBe(1);
    expect(k.autonomy!.previous).toBe(0);
    expect(k.costPerPr!.value).toBe(3);
    expect(k.costPerPr!.previous).toBe(10);
    expect(k.costPerPr!.delta).toBeCloseTo(-0.7);
    expect(k.runs!.value).toBe(3);
  });

  it("groups runs and spend", () => {
    expect(d.runs.total).toBe(3);
    expect(d.runs.topLevel).toBe(2);
    expect(d.runs.groups.agentType.series).toEqual(["Foreman", "Code", "Review"]);
    expect(d.spend.agent.table.map((t) => [t.name, t.cost])).toEqual([["implement", 3], ["foreman", 2], ["review", 1]]);
    expect(d.spend.source.table[0]!.name).toBe("Kiln Web");
  });

  it("ranks PRs and buckets by size", () => {
    expect(d.topPrs.map((p) => [p.number, p.cost, p.status])).toEqual([[1, 4, "merged"], [2, 2, "open"]]);
    expect(d.topPrs[0]!.models.map((m) => m.model)).toEqual(["claude-sonnet-5-5", "gpt-6"]);
    expect(d.bySize.find((b) => b.name === "S")!.cost).toBe(4);
    expect(d.cost.perPr).toBe(3);
  });

  it("splits cost into compute, platform and inference", () => {
    const scores = [{ scorer: "q", agent: "implement", runId: "1", score: 1, passed: true, costUsd: 0.5, createdAt: "2026-10-19T10:00:00Z" }];
    const extra = [...runs, run("5", { agent: "improver", kind: "improver", costUsd: 2 })];
    const p = buildDashboard({ runs: extra, items, scores, range });
    expect(p.cost.breakdown.series).toEqual(["Compute", "Platform", "Inference"]);
    const day = p.cost.breakdown.rows.find((r) => r.key === "2026-10-19")!;
    // Two PRs opened that day: (3 + 1 + 2) inference and 0.5 judging over 2 PRs.
    expect(day).toMatchObject({ Compute: 0, Platform: 0.25, Inference: 3 });
    expect(p.cost.perPr).toBe(3.25);
    expect(p.spend.agent.table.find((t) => t.name === "improver")).toMatchObject({ cost: 2, platform: 2, inference: 0 });
    expect(p.spend.agent.table.find((t) => t.name === "implement")).toMatchObject({ cost: 3.5, platform: 0.5, inference: 3 });
    expect(p.topPrs[0]!.cost).toBe(4.5);
  });

  it("averages human interactions over merged PRs, not counting the original request", () => {
    expect(d.interactions.value).toBe(0);
    const two = buildDashboard({ runs, items: [...items, wi("c", { pr: { repo: "o/r", number: 3, url: "u" }, state: "complete", completion: { by: "merge" }, completedAt: "2026-10-20T08:00:00Z", humanTouches: 3 })], scores: [], range });
    expect(two.interactions.value).toBe(1);
    expect(two.interactions.rows.at(-1)).toMatchObject({ interactions: 1 });
    expect(d.prs.rows.at(-2)).toMatchObject({ opened: 2, merged: 0 });
    expect(d.prs.rows.at(-1)).toMatchObject({ opened: 0, merged: 1 });
  });

  it("measures every cycle-time stage from the PR timestamps", () => {
    const pr = (n: number, t: { openedAt?: string; firstReviewAt?: string; mergedAt?: string }) => ({ repo: "o/r", number: n, url: "u", ...t });
    const c = buildDashboard({
      runs: [],
      scores: [],
      range,
      items: [
        wi("x", { createdAt: "2026-10-19T00:00:00Z", state: "complete", completion: { by: "merge" }, completedAt: "2026-10-19T12:00:00Z", pr: pr(1, { openedAt: "2026-10-19T02:00:00Z", firstReviewAt: "2026-10-19T05:00:00Z", mergedAt: "2026-10-19T10:00:00Z" }) }),
        wi("y", { createdAt: "2026-10-19T00:00:00Z", state: "complete", completion: { by: "merge" }, completedAt: "2026-10-19T08:00:00Z", pr: pr(2, { openedAt: "2026-10-19T04:00:00Z" }) }),
      ],
    }).cycle;
    // Kickoff → merge prefers the PR's merge time: 10h and 8h.
    expect(c).toEqual({ kickoffToMerge: 9, kickoffToPr: 3, prToReview: 3, reviewToMerge: 5 });
  });
});

describe("allPages", () => {
  it("follows cursors until the last page", async () => {
    const pages: Record<string, { runs: number[]; pageInfo: { hasNextPage: boolean; nextCursor?: string } }> = {
      start: { runs: [1, 2], pageInfo: { hasNextPage: true, nextCursor: "b" } },
      b: { runs: [3], pageInfo: { hasNextPage: false } },
    };
    const seen: (string | undefined)[] = [];
    const all = await allPages(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? "start"]!;
    }, (p) => p.runs);
    expect(all).toEqual([1, 2, 3]);
    expect(seen).toEqual([undefined, "b"]);
  });

  it("stops at the page cap", async () => {
    const all = await allPages(async () => ({ runs: [1], pageInfo: { hasNextPage: true, nextCursor: "again" } }), (p) => p.runs, 3);
    expect(all).toEqual([1, 1, 1]);
  });
});

describe("withReportedPrs", () => {
  it("keeps the report's cost and diff and fills creator, source and models from the local row", () => {
    const local = buildDashboard({ runs: [run("1", { workItemId: "p", costUsd: 2 })], scores: [], range, items: [wi("p", { pr: { repo: "o/r", number: 7, url: "u" }, source: { provider: "slack" } })] }).topPrs;
    const [row] = withReportedPrs(local, [{ pr: { repo: "o/r", number: 7, url: "u", title: "T", state: "open" }, additions: 10, deletions: 2, costUsd: 5 }]);
    expect(row).toMatchObject({ title: "T", cost: 5, additions: 10, creator: "ann@x", source: "Slack", models: [{ model: "claude-sonnet-5-5", share: 1 }] });
    expect(row!.files).toBeUndefined();
  });
});
