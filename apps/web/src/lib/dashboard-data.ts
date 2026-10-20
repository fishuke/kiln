import { bucket, dayKeys, delta, type DateRange, type Row } from "./chart";

/**
 * Builds every dashboard series from runs, work items and scores, so the page works before the
 * dedicated metrics endpoints exist. Pure; tested in dashboard-data.test.ts.
 */
export type RunLite = { id: string; agent: string; agentType: string; status: string; harness: string; model?: string; workItemId?: string; parentRunId?: string; costUsd: number; computeCostUsd?: number; startedAt: string };
export type WorkItemLite = {
  id: string;
  title: string;
  state: string;
  requester: string;
  source: { provider: string };
  pr?: { repo: string; number: number; url: string };
  triage?: { size?: string };
  humanTouches: number;
  completion?: { by: string };
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
};
export type ScoreLite = { scorer: string; agent: string; score: number; passed: boolean; createdAt: string };

export type Kpi = { key: string; label: string; value: number | null; previous: number | null; delta: number | null; format: "pct" | "hours" | "usd" | "count"; goodWhenUp: boolean; tip: string };
export type SeriesData = { rows: Row[]; series: string[] };
export type PrRow = { id: string; title: string; repo: string; number: number; url: string; status: "open" | "merged" | "closed"; creator: string; source: string; models: { model: string; share: number }[]; additions?: number; deletions?: number; files?: number; cost: number; size: string; component: string };
export type Breakdown = { name: string; cost: number; compute: number; inference: number; runs: number };

export type DashboardData = {
  days: string[];
  kpis: Kpi[];
  interactions: { value: number; rows: Row[] };
  cycle: { kickoffToMerge: number | null; kickoffToPr: number | null; prToReview: number | null; reviewToMerge: number | null };
  prs: { opened: number; merged: number; rows: Row[] };
  runs: { total: number; topLevel: number; groups: Record<RunGroup, SeriesData> };
  cost: { total: number; perPr: number | null; prCount: number; breakdown: SeriesData; bySize: SeriesData };
  spend: Record<"source" | "user" | "agent" | "model", { total: number; series: SeriesData; table: Breakdown[] }>;
  topPrs: PrRow[];
  bySize: Breakdown[];
  byComponent: Breakdown[];
  scores: Record<string, { rows: Row[]; count: number; passRate: number | null }>;
};

export type RunGroup = "agentType" | "status" | "source" | "topLevel" | "model" | "harness";

const TYPE_LABEL: Record<string, string> = { FOREMAN: "Foreman", IMPLEMENT: "Code", REVIEW: "Review", TRIAGE: "Triage", SPEC: "Spec", VERIFY: "Verify", PLAN: "Plan", PO_ASSISTANT: "PO assistant", CUSTOM: "Custom" };
export const SOURCE_LABEL: Record<string, string> = { kiln: "Kiln Web", api: "API", mcp: "MCP", github: "GitHub", linear: "Linear", jira: "Jira", slack: "Slack", schedule: "Schedule", webhook: "Webhook", teams: "Teams", discord: "Discord", gitlab: "GitLab" };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const within = (iso: string | undefined, a: Date, b: Date) => !!iso && iso >= a.toISOString() && iso <= b.toISOString();
const isMerged = (w: WorkItemLite) => w.state === "complete" && (w.completion?.by === "merge" || !!w.pr);
const prStatus = (w: WorkItemLite): PrRow["status"] => (isMerged(w) ? "merged" : w.state === "cancelled" || w.state === "failed" ? "closed" : "open");
export const sizeOf = (w: WorkItemLite) => {
  const s = (w.triage?.size ?? "").toUpperCase();
  return s === "XS" || s === "S" ? "S" : s === "M" ? "M" : s === "L" ? "L" : s === "XL" ? "XL" : "M";
};

function periodStats(runs: RunLite[], items: WorkItemLite[], a: Date, b: Date) {
  const opened = items.filter((w) => w.pr && within(w.createdAt, a, b));
  const merged = items.filter((w) => isMerged(w) && within(w.completedAt ?? w.updatedAt, a, b));
  const autonomous = merged.filter((w) => w.humanTouches <= 1);
  const cycle = median(merged.filter((w) => w.completedAt).map((w) => (Date.parse(w.completedAt!) - Date.parse(w.createdAt)) / 3_600_000));
  const prIds = new Set(opened.map((w) => w.id));
  const prCost = runs.filter((r) => r.workItemId && prIds.has(r.workItemId)).reduce((s, r) => s + r.costUsd, 0);
  const periodRuns = runs.filter((r) => within(r.startedAt, a, b));
  return {
    autonomy: merged.length ? autonomous.length / merged.length : null,
    cycle: cycle === null ? null : r2(cycle),
    costPerPr: opened.length ? r2(prCost / opened.length) : null,
    runs: periodRuns.length,
    opened: opened.length,
    merged: merged.length,
  };
}

function breakdown(runs: RunLite[], key: (r: RunLite) => string): Breakdown[] {
  const m = new Map<string, Breakdown>();
  for (const r of runs) {
    const k = key(r);
    const b = m.get(k) ?? { name: k, cost: 0, compute: 0, inference: 0, runs: 0 };
    b.cost += r.costUsd + (r.computeCostUsd ?? 0);
    b.compute += r.computeCostUsd ?? 0;
    b.inference += r.costUsd;
    b.runs += 1;
    m.set(k, b);
  }
  return [...m.values()].map((b) => ({ ...b, cost: r2(b.cost), compute: r2(b.compute), inference: r2(b.inference) })).sort((a, b) => b.cost - a.cost);
}

export function buildDashboard(input: { runs: RunLite[]; items: WorkItemLite[]; scores: ScoreLite[]; range: DateRange }): DashboardData {
  const { range } = input;
  const days = dayKeys(range.start, range.end);
  const items = input.items;
  const byId = new Map(items.map((w) => [w.id, w]));
  const runs = input.runs.filter((r) => within(r.startedAt, range.start, range.end));
  const cur = periodStats(input.runs, items, range.start, range.end);
  const prev = periodStats(input.runs, items, range.prevStart, range.prevEnd);

  const kpis: Kpi[] = [
    { key: "autonomy", label: "Autonomy", value: cur.autonomy, previous: prev.autonomy, delta: delta(cur.autonomy, prev.autonomy), format: "pct", goodWhenUp: true, tip: "Share of merged PRs that needed no human touch beyond the original request." },
    { key: "cycle", label: "PR cycle time", value: cur.cycle, previous: prev.cycle, delta: delta(cur.cycle, prev.cycle), format: "hours", goodWhenUp: false, tip: "Median time from kickoff to merge for PRs merged in the range." },
    { key: "costPerPr", label: "Cost per PR", value: cur.costPerPr, previous: prev.costPerPr, delta: delta(cur.costPerPr, prev.costPerPr), format: "usd", goodWhenUp: false, tip: "Average cost of the PRs opened in the range, including every run of their work item." },
    { key: "runs", label: "Total runs", value: cur.runs, previous: prev.runs, delta: delta(cur.runs, prev.runs), format: "count", goodWhenUp: true, tip: "Runs executed by this factory's agents in the range." },
    { key: "opened", label: "PRs opened", value: cur.opened, previous: prev.opened, delta: delta(cur.opened, prev.opened), format: "count", goodWhenUp: true, tip: "Pull requests the factory opened in the range." },
    { key: "merged", label: "PRs merged", value: cur.merged, previous: prev.merged, delta: delta(cur.merged, prev.merged), format: "count", goodWhenUp: true, tip: "Pull requests from this factory that were merged in the range." },
  ];

  // Productivity
  const merged = items.filter((w) => isMerged(w) && within(w.completedAt ?? w.updatedAt, range.start, range.end));
  const inter = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "interactions", (w) => w.humanTouches, ["interactions"]);
  const mergedCount = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "n", () => 1, ["n"]);
  inter.rows.forEach((r, i) => {
    const n = Number(mergedCount.rows[i]!.n);
    r.interactions = n ? r2(Number(r.interactions) / n) : 0;
  });
  const opened = items.filter((w) => w.pr && within(w.createdAt, range.start, range.end));
  const prOpen = bucket(opened, days, (w) => w.createdAt, () => "opened", () => 1, ["opened"]);
  const prMerged = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "merged", () => 1, ["merged"]);
  const prRows = prOpen.rows.map((r, i) => ({ ...r, merged: Number(prMerged.rows[i]!.merged) }));

  const sourceOf = (r: RunLite) => {
    const w = r.workItemId ? byId.get(r.workItemId) : undefined;
    return SOURCE_LABEL[w?.source.provider ?? "api"] ?? w?.source.provider ?? "API";
  };
  const groupKey: Record<RunGroup, (r: RunLite) => string | null> = {
    agentType: (r) => TYPE_LABEL[r.agentType] ?? r.agentType,
    status: (r) => r.status.charAt(0).toUpperCase() + r.status.slice(1),
    source: (r) => (r.parentRunId ? null : sourceOf(r)),
    topLevel: (r) => (r.parentRunId ? "Subruns" : "Top-level"),
    model: (r) => r.model ?? "default",
    harness: (r) => r.harness,
  };
  const order: Partial<Record<RunGroup, string[]>> = { agentType: ["Foreman", "Code", "Review", "Triage"], topLevel: ["Top-level", "Subruns"] };
  const groups = Object.fromEntries((Object.keys(groupKey) as RunGroup[]).map((g) => [g, bucket(runs, days, (r) => r.startedAt, groupKey[g], () => 1, order[g] ?? [])])) as Record<RunGroup, SeriesData>;
  // Hide the seeded order names that have no runs at all.
  for (const g of Object.values(groups)) g.series = g.series.filter((s) => g.rows.some((r) => Number(r[s]) > 0) || runs.length === 0);

  // Spending
  const prItems = items.filter((w) => w.pr && within(w.createdAt, range.start, range.end));
  const prRuns = (w: WorkItemLite) => input.runs.filter((r) => r.workItemId === w.id);
  const prCostTotal = prItems.reduce((s, w) => s + prRuns(w).reduce((a, r) => a + r.costUsd + (r.computeCostUsd ?? 0), 0), 0);
  const costRunsOfPrs = input.runs.filter((r) => r.workItemId && prItems.some((w) => w.id === r.workItemId));
  const prDay = new Map(prItems.map((w) => [w.id, w.createdAt.slice(0, 10)]));
  const prsPerDay = bucket(prItems, days, (w) => w.createdAt, () => "n", () => 1, ["n"]);
  const perDay = (value: (r: RunLite) => number, series: (r: RunLite) => string | null, seeds: string[]) => {
    const b = bucket(costRunsOfPrs, days, (r) => prDay.get(r.workItemId!), series, value, seeds);
    b.rows.forEach((row, i) => {
      const n = Number(prsPerDay.rows[i]!.n);
      for (const s of b.series) row[s] = n ? r2(Number(row[s]) / n) : 0;
    });
    return b;
  };
  const costBreakdown = perDay((r) => r.costUsd, () => "Inference", ["Compute", "Inference"]);
  const computeSeries = bucket(costRunsOfPrs, days, (r) => prDay.get(r.workItemId!), () => "Compute", (r) => r.computeCostUsd ?? 0, ["Compute"]);
  costBreakdown.rows.forEach((row, i) => {
    const n = Number(prsPerDay.rows[i]!.n);
    row.Compute = n ? r2(Number(computeSeries.rows[i]!.Compute) / n) : 0;
  });
  const sizeSeries = perDay((r) => r.costUsd + (r.computeCostUsd ?? 0), (r) => sizeOf(byId.get(r.workItemId!)!), ["S", "M", "L", "XL"]);

  const spendOf = (key: (r: RunLite) => string) => {
    const table = breakdown(runs, key);
    const series = bucket(runs, days, (r) => r.startedAt, key, (r) => r.costUsd + (r.computeCostUsd ?? 0), table.map((t) => t.name));
    return { total: r2(table.reduce((s, t) => s + t.cost, 0)), series, table };
  };

  const topPrs: PrRow[] = prItems
    .map((w) => {
      const rs = prRuns(w);
      const cost = rs.reduce((s, r) => s + r.costUsd + (r.computeCostUsd ?? 0), 0);
      const byModel = breakdown(rs, (r) => r.model ?? r.harness);
      return {
        id: w.id,
        title: w.title,
        repo: w.pr!.repo,
        number: w.pr!.number,
        url: w.pr!.url,
        status: prStatus(w),
        creator: w.requester,
        source: SOURCE_LABEL[w.source.provider] ?? w.source.provider,
        models: byModel.map((m) => ({ model: m.name, share: cost ? m.cost / cost : 0 })),
        cost: r2(cost),
        size: sizeOf(w),
        component: w.pr!.repo,
      };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20);

  const groupPrs = (key: (p: PrRow) => string, seed: string[] = []): Breakdown[] => {
    const m = new Map<string, Breakdown>(seed.map((s) => [s, { name: s, cost: 0, compute: 0, inference: 0, runs: 0 }]));
    for (const p of topPrs) {
      const b = m.get(key(p)) ?? { name: key(p), cost: 0, compute: 0, inference: 0, runs: 0 };
      b.cost = r2(b.cost + p.cost);
      b.runs += 1;
      m.set(key(p), b);
    }
    return [...m.values()];
  };

  const scores: DashboardData["scores"] = {};
  for (const s of input.scores.filter((x) => within(x.createdAt, range.start, range.end))) (scores[s.scorer] ??= { rows: [], count: 0, passRate: 0 }).count++;
  for (const name of Object.keys(scores)) {
    const ss = input.scores.filter((x) => x.scorer === name && within(x.createdAt, range.start, range.end));
    const pass = bucket(ss, days, (x) => x.createdAt, () => "pass", (x) => (x.passed ? 1 : 0), ["pass"]);
    const all = bucket(ss, days, (x) => x.createdAt, () => "n", () => 1, ["n"]);
    scores[name] = {
      count: ss.length,
      passRate: ss.length ? ss.filter((x) => x.passed).length / ss.length : null,
      rows: pass.rows.map((r, i) => ({ key: r.key, "Pass rate": Number(all.rows[i]!.n) ? r2((Number(r.pass) / Number(all.rows[i]!.n)) * 100) : 0 })),
    };
  }

  return {
    days,
    kpis,
    interactions: { value: merged.length ? r2(merged.reduce((s, w) => s + w.humanTouches, 0) / merged.length) : 0, rows: inter.rows },
    cycle: { kickoffToMerge: cur.cycle, kickoffToPr: null, prToReview: null, reviewToMerge: null },
    prs: { opened: opened.length, merged: merged.length, rows: prRows },
    runs: { total: runs.length, topLevel: runs.filter((r) => !r.parentRunId).length, groups },
    cost: { total: r2(prCostTotal), perPr: prItems.length ? r2(prCostTotal / prItems.length) : null, prCount: prItems.length, breakdown: costBreakdown, bySize: sizeSeries },
    spend: {
      source: spendOf((r) => sourceOf(r)),
      user: spendOf((r) => (r.workItemId ? (byId.get(r.workItemId)?.requester ?? "unknown") : "automation")),
      agent: spendOf((r) => r.agent),
      model: spendOf((r) => r.model ?? r.harness),
    },
    topPrs,
    bySize: groupPrs((p) => p.size, ["S", "M", "L", "XL"]),
    byComponent: groupPrs((p) => p.component).sort((a, b) => b.cost - a.cost),
    scores,
  };
}
