import { describe, expect, it } from "vitest";
import { parseRange } from "./chart";
import { buildDashboard, type RunLite, type WorkItemLite } from "./dashboard-data";

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

  it("averages human interactions over merged PRs", () => {
    expect(d.interactions.value).toBe(1);
    expect(d.prs.rows.at(-2)).toMatchObject({ opened: 2, merged: 0 });
    expect(d.prs.rows.at(-1)).toMatchObject({ opened: 0, merged: 1 });
  });
});
