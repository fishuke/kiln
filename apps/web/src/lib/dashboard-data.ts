import { bucket, dayKeys, delta, type DateRange, type Row } from "./chart";

/**
 * Builds every dashboard series from runs, work items and scores, so the page works before the
 * dedicated metrics endpoints exist. Pure; tested in dashboard-data.test.ts.
 */
export type RunLite = { id: string; agent: string; agentType: string; status: string; harness: string; model?: string; workItemId?: string; parentRunId?: string; kind?: string; costUsd: number; computeCostUsd?: number; startedAt: string };
export type WorkItemLite = {
  id: string;
  title: string;
  state: string;
  requester: string;
  source: { provider: string };
  pr?: { repo: string; number: number; url: string; openedAt?: string; firstReviewAt?: string; mergedAt?: string };
  triage?: { size?: string };
  humanTouches: number;
  completion?: { by: string };
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
};
export type ScoreLite = { scorer: string; agent: string; runId?: string; score: number; passed: boolean; costUsd?: number; createdAt: string };

export type Kpi = { key: string; label: string; value: number | null; previous: number | null; delta: number | null; format: "pct" | "hours" | "usd" | "count"; goodWhenUp: boolean; tip: string };
export type SeriesData = { rows: Row[]; series: string[] };
export type PrRow = { id: string; title: string; repo: string; number: number; url: string; status: "open" | "merged" | "closed"; creator: string; source: string; models: { model: string; share: number }[]; additions?: number; deletions?: number; files?: number; cost: number; size: string; component: string };
export type Breakdown = { name: string; cost: number; compute: number; platform: number; inference: number; runs: number };

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

/** Platform cost is Kiln's own machinery: judging a run, and improver and benchmark runs (#152). */
type Costed = RunLite & { judging: number };
const PLATFORM_KINDS = new Set(["improver", "benchmark"]);
const platformOf = (r: Costed) => r.judging + (PLATFORM_KINDS.has(r.kind ?? "") ? r.costUsd : 0);
const inferenceOf = (r: Costed) => (PLATFORM_KINDS.has(r.kind ?? "") ? 0 : r.costUsd);
const costOf = (r: Costed) => r.costUsd + r.judging + (r.computeCostUsd ?? 0);
const empty = (name: string): Breakdown => ({ name, cost: 0, compute: 0, platform: 0, inference: 0, runs: 0 });
const within = (iso: string | undefined, a: Date, b: Date) => !!iso && iso >= a.toISOString() && iso <= b.toISOString();
const hoursBetween = (a?: string, b?: string) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) / 3_600_000 : null);
/** Median hours between two timestamps over the PRs where both were recorded. */
const medianHours = (ws: WorkItemLite[], from: (w: WorkItemLite) => string | undefined, to: (w: WorkItemLite) => string | undefined) => {
  const m = median(ws.map((w) => hoursBetween(from(w), to(w))).filter((h): h is number => h !== null));
  return m === null ? null : r2(m);
};
const mergedAt = (w: WorkItemLite) => w.pr?.mergedAt ?? w.completedAt;
/** Human touches after the original request, which counts as the first touch. */
const interactionsOf = (w: WorkItemLite) => Math.max(0, w.humanTouches - 1);
const isMerged = (w: WorkItemLite) => w.state === "complete" && (w.completion?.by === "merge" || !!w.pr);
const prStatus = (w: WorkItemLite): PrRow["status"] => (isMerged(w) ? "merged" : w.state === "cancelled" || w.state === "failed" ? "closed" : "open");
export const sizeOf = (w: WorkItemLite) => {
  const s = (w.triage?.size ?? "").toUpperCase();
  return s === "XS" || s === "S" ? "S" : s === "M" ? "M" : s === "L" ? "L" : s === "XL" ? "XL" : "M";
};

function periodStats(runs: Costed[], items: WorkItemLite[], a: Date, b: Date) {
  const opened = items.filter((w) => w.pr && within(w.createdAt, a, b));
  const merged = items.filter((w) => isMerged(w) && within(w.completedAt ?? w.updatedAt, a, b));
  const autonomous = merged.filter((w) => w.humanTouches <= 1);
  const cycle = medianHours(merged, (w) => w.createdAt, mergedAt);
  const prIds = new Set(opened.map((w) => w.id));
  const prCost = runs.filter((r) => r.workItemId && prIds.has(r.workItemId)).reduce((s, r) => s + costOf(r), 0);
  const periodRuns = runs.filter((r) => within(r.startedAt, a, b));
  return {
    autonomy: merged.length ? autonomous.length / merged.length : null,
    cycle,
    costPerPr: opened.length ? r2(prCost / opened.length) : null,
    runs: periodRuns.length,
    opened: opened.length,
    merged: merged.length,
  };
}

function breakdown(runs: Costed[], key: (r: Costed) => string): Breakdown[] {
  const m = new Map<string, Breakdown>();
  for (const r of runs) {
    const k = key(r);
    const b = m.get(k) ?? empty(k);
    b.cost += costOf(r);
    b.compute += r.computeCostUsd ?? 0;
    b.platform += platformOf(r);
    b.inference += inferenceOf(r);
    b.runs += 1;
    m.set(k, b);
  }
  return [...m.values()].map((b) => ({ ...b, cost: r2(b.cost), compute: r2(b.compute), platform: r2(b.platform), inference: r2(b.inference) })).sort((a, b) => b.cost - a.cost);
}

export function buildDashboard(input: { runs: RunLite[]; items: WorkItemLite[]; scores: ScoreLite[]; range: DateRange }): DashboardData {
  const { range } = input;
  const days = dayKeys(range.start, range.end);
  const items = input.items;
  const byId = new Map(items.map((w) => [w.id, w]));
  const judging = new Map<string, number>();
  for (const s of input.scores) if (s.runId) judging.set(s.runId, (judging.get(s.runId) ?? 0) + (s.costUsd ?? 0));
  const allRuns: Costed[] = input.runs.map((r) => ({ ...r, judging: judging.get(r.id) ?? 0 }));
  const runs = allRuns.filter((r) => within(r.startedAt, range.start, range.end));
  const cur = periodStats(allRuns, items, range.start, range.end);
  const prev = periodStats(allRuns, items, range.prevStart, range.prevEnd);

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
  const inter = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "interactions", interactionsOf, ["interactions"]);
  const mergedCount = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "n", () => 1, ["n"]);
  inter.rows.forEach((r, i) => {
    const n = Number(mergedCount.rows[i]!.n);
    r.interactions = n ? r2(Number(r.interactions) / n) : 0;
  });
  const opened = items.filter((w) => w.pr && within(w.createdAt, range.start, range.end));
  const prOpen = bucket(opened, days, (w) => w.createdAt, () => "opened", () => 1, ["opened"]);
  const prMerged = bucket(merged, days, (w) => w.completedAt ?? w.updatedAt, () => "merged", () => 1, ["merged"]);
  const prRows = prOpen.rows.map((r, i) => ({ ...r, merged: Number(prMerged.rows[i]!.merged) }));

  const sourceOf = (r: Costed) => {
    const w = r.workItemId ? byId.get(r.workItemId) : undefined;
    return SOURCE_LABEL[w?.source.provider ?? "api"] ?? w?.source.provider ?? "API";
  };
  const groupKey: Record<RunGroup, (r: Costed) => string | null> = {
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
  const prRuns = (w: WorkItemLite) => allRuns.filter((r) => r.workItemId === w.id);
  const prCostTotal = prItems.reduce((s, w) => s + prRuns(w).reduce((a, r) => a + costOf(r), 0), 0);
  const costRunsOfPrs = allRuns.filter((r) => r.workItemId && prItems.some((w) => w.id === r.workItemId));
  const prDay = new Map(prItems.map((w) => [w.id, w.createdAt.slice(0, 10)]));
  const prsPerDay = bucket(prItems, days, (w) => w.createdAt, () => "n", () => 1, ["n"]);
  const perDay = (value: (r: Costed) => number, series: (r: Costed) => string | null, seeds: string[]) => {
    const b = bucket(costRunsOfPrs, days, (r) => prDay.get(r.workItemId!), series, value, seeds);
    b.rows.forEach((row, i) => {
      const n = Number(prsPerDay.rows[i]!.n);
      for (const s of b.series) row[s] = n ? r2(Number(row[s]) / n) : 0;
    });
    return b;
  };
  const components = { Compute: (r: Costed) => r.computeCostUsd ?? 0, Platform: platformOf, Inference: inferenceOf };
  const parts = Object.entries(components).map(([name, value]) => [name, perDay(value, () => name, [name])] as const);
  const costBreakdown = { series: Object.keys(components), rows: parts[0]![1].rows.map((row, i) => ({ ...row, ...Object.fromEntries(parts.map(([name, p]) => [name, p.rows[i]![name]])) })) };
  const sizeSeries = perDay(costOf, (r) => sizeOf(byId.get(r.workItemId!)!), ["S", "M", "L", "XL"]);

  const spendOf = (key: (r: Costed) => string) => {
    const table = breakdown(runs, key);
    const series = bucket(runs, days, (r) => r.startedAt, key, costOf, table.map((t) => t.name));
    return { total: r2(table.reduce((s, t) => s + t.cost, 0)), series, table };
  };

  const topPrs: PrRow[] = prItems
    .map((w) => {
      const rs = prRuns(w);
      const cost = rs.reduce((s, r) => s + costOf(r), 0);
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
    const m = new Map<string, Breakdown>(seed.map((s) => [s, empty(s)]));
    for (const p of topPrs) {
      const b = m.get(key(p)) ?? empty(key(p));
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
    interactions: { value: merged.length ? r2(merged.reduce((s, w) => s + interactionsOf(w), 0) / merged.length) : 0, rows: inter.rows },
    cycle: {
      kickoffToMerge: cur.cycle,
      kickoffToPr: medianHours(merged, (w) => w.createdAt, (w) => w.pr?.openedAt),
      prToReview: medianHours(merged, (w) => w.pr?.openedAt, (w) => w.pr?.firstReviewAt),
      reviewToMerge: medianHours(merged, (w) => w.pr?.firstReviewAt, mergedAt),
    },
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

/** Every item of a cursor-paged list, at most `maxPages` pages. */
export async function allPages<P extends { pageInfo: { hasNextPage: boolean; nextCursor?: string } }, T>(fetch: (cursor?: string) => Promise<P>, items: (page: P) => T[], maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetch(cursor);
    out.push(...items(page));
    if (!page.pageInfo.hasNextPage || !page.pageInfo.nextCursor) break;
    cursor = page.pageInfo.nextCursor;
  }
  return out;
}

/** A row of the API's per-PR cost report (`/costs/per-pr/top`). */
export type ReportedPr = {
  pr: { repo: string; number: number; url: string; title: string; state: PrRow["status"] };
  creator?: string;
  source?: string;
  models?: { model: string; share: number }[];
  additions?: number;
  deletions?: number;
  files?: number;
  costUsd: number;
  size?: string;
  components?: string[];
};

/** The report's rows, filling creator, source and models the report lacks from the locally built row of the same PR. */
export function withReportedPrs(local: PrRow[], reported: ReportedPr[]): PrRow[] {
  const byPr = new Map(local.map((p) => [`${p.repo}#${p.number}`, p]));
  return reported.map((t, i) => {
    const l = byPr.get(`${t.pr.repo}#${t.pr.number}`);
    return {
      id: `${t.pr.repo}#${t.pr.number}#${i}`,
      title: t.pr.title,
      repo: t.pr.repo,
      number: t.pr.number,
      url: t.pr.url,
      status: t.pr.state,
      creator: t.creator ?? l?.creator ?? "—",
      source: (t.source ? (SOURCE_LABEL[t.source] ?? t.source) : l?.source) ?? "—",
      models: t.models ?? l?.models ?? [],
      additions: t.additions,
      deletions: t.deletions,
      files: t.files,
      cost: t.costUsd,
      size: t.size ?? l?.size ?? "M",
      component: t.components?.[0] ?? t.pr.repo,
    };
  });
}
