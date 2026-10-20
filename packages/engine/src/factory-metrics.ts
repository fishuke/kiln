import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { page, runState } from "./run-state";
import { C, type Run, type WorkItem } from "./types";

export type Period = "day" | "week" | "month";
export type Range = { start: string; end: string; groupByPeriod?: Period };

const DAY = 86_400_000;
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Start of the period containing `iso` (UTC; weeks start on Sunday). */
export function periodStart(iso: string, period: Period): string {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  if (period === "week") d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  if (period === "month") d.setUTCDate(1);
  return d.toISOString();
}

export function periods(range: Range): string[] {
  if (!range.groupByPeriod) return [];
  const out: string[] = [];
  let cur = periodStart(range.start, range.groupByPeriod);
  while (cur < range.end && out.length < 366) {
    out.push(cur);
    const d = new Date(cur);
    if (range.groupByPeriod === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (range.groupByPeriod === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    cur = d.toISOString();
  }
  if (out.length > 365) throw new KilnError("invalid_request", "at most 365 periods; pick a larger group_by_period");
  return out;
}

const within = (iso: string | undefined, r: Range) => Boolean(iso && iso >= r.start && iso < r.end);

export type PrRecord = {
  provider: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  state: "open" | "draft" | "merged" | "closed";
  taskId: string;
  openedAt?: string;
  firstHumanReviewAt?: string;
  mergedAt?: string;
  closedAt?: string;
  updatedAt: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: number;
  humanInteractions: { total: number; followUpMessage: number; reviewChangesRequested: number };
  humanCodeChange: boolean;
  historyComplete: boolean;
  runs: { runId: string; rootRunId: string; createdAt: string }[];
  kickoffAt: string;
  cycleTime: { kickoffToPr: number | null; prToFirstReview: number | null; firstReviewToMerge: number | null; kickoffToMerge: number | null };
  costUsd: number;
};

const secs = (a?: string, b?: string) => (a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000) : null);

/** Factory metrics, costs and pull requests: computed from stored tasks and runs, with periods and period-over-period deltas. */
export class FactoryMetricsService {
  constructor(private readonly k: Kiln) {}

  /** Default range: the last 30 days. */
  range(input: { start?: string; end?: string; groupByPeriod?: Period }): Range {
    const end = input.end ?? this.k.clock.now().toISOString();
    const start = input.start ?? new Date(new Date(end).getTime() - 30 * DAY).toISOString();
    if (start >= end) throw new KilnError("invalid_request", "start_date must be before end_date");
    const r: Range = { start, end, groupByPeriod: input.groupByPeriod };
    periods(r);
    return r;
  }

  private previous(r: Range): Range {
    const len = new Date(r.end).getTime() - new Date(r.start).getTime();
    return { start: new Date(new Date(r.start).getTime() - len).toISOString(), end: r.start, groupByPeriod: r.groupByPeriod };
  }

  private envelope(factory: string, r: Range) {
    return { asOf: this.k.clock.now().toISOString(), factory, startDate: r.start, endDate: r.end, ...(r.groupByPeriod ? { groupByPeriod: r.groupByPeriod } : {}) };
  }

  private items(factory: string): WorkItem[] {
    return this.k.store.list<WorkItem>(C.workItems, (w) => w.factory === factory && !w.deletedAt);
  }

  private runs(factory: string): Run[] {
    return this.k.store.list<Run>(C.runs, (r) => r.factory === factory);
  }

  private prState(w: WorkItem): PrRecord["state"] {
    if (w.pr?.mergedAt || w.completion?.by === "merge") return "merged";
    if (w.state === "cancelled" || w.state === "failed") return "closed";
    if (w.state === "planning" || w.state === "awaiting_spec") return "draft";
    return "open";
  }

  private mergedAt(w: WorkItem) {
    return w.pr?.mergedAt ?? (w.completion?.by === "merge" ? w.completedAt : undefined);
  }

  prRecord(w: WorkItem, runs: Run[]): PrRecord {
    const pr = w.pr!;
    const own = runs.filter((r) => r.workItemId === w.id);
    const openedAt = pr.openedAt ?? own.find((r) => r.artifacts.some((a) => a.kind === "pr"))?.finishedAt;
    const mergedAt = this.mergedAt(w);
    const state = this.prState(w);
    const reviewChanges = w.conversation.filter((c) => c.role === "human" && /review/i.test(c.from)).length;
    return {
      provider: this.k.forge.name,
      repo: pr.repo,
      number: pr.number,
      url: pr.url,
      title: w.title,
      author: "kiln-agent",
      state,
      taskId: w.id,
      ...(openedAt ? { openedAt } : {}),
      ...(pr.firstReviewAt ? { firstHumanReviewAt: pr.firstReviewAt } : {}),
      ...(mergedAt ? { mergedAt } : {}),
      ...(state === "closed" ? { closedAt: w.updatedAt } : {}),
      updatedAt: w.updatedAt,
      ...(pr.additions !== undefined ? { additions: pr.additions, deletions: pr.deletions ?? 0, changedFiles: pr.changedFiles ?? 0, commits: pr.commits ?? 0 } : {}),
      humanInteractions: { total: Math.max(0, w.humanTouches - 1), followUpMessage: w.conversation.filter((c) => c.role === "human").length - 1, reviewChangesRequested: reviewChanges },
      humanCodeChange: pr.humanCodeChange === true,
      historyComplete: Boolean(openedAt),
      runs: own.map((r) => ({ runId: r.id, rootRunId: r.rootRunId ?? r.id, createdAt: r.startedAt })),
      kickoffAt: w.createdAt,
      cycleTime: { kickoffToPr: secs(w.createdAt, openedAt), prToFirstReview: secs(openedAt, pr.firstReviewAt), firstReviewToMerge: secs(pr.firstReviewAt, mergedAt), kickoffToMerge: secs(w.createdAt, mergedAt) },
      costUsd: round(own.reduce((s, r) => s + r.costUsd, 0)),
    };
  }

  private prs(factory: string): PrRecord[] {
    const runs = this.runs(factory);
    return this.items(factory)
      .filter((w) => w.pr)
      .map((w) => this.prRecord(w, runs));
  }

  private core(factory: string, r: Range) {
    const runs = this.runs(factory).filter((x) => within(x.startedAt, r));
    const prs = this.prs(factory);
    const opened = prs.filter((p) => within(p.openedAt ?? p.kickoffAt, r));
    const merged = prs.filter((p) => within(p.mergedAt, r));
    const autonomous = merged.filter((p) => !p.humanCodeChange);
    const measured = merged.filter((p) => p.additions !== undefined);
    const latency = (key: keyof PrRecord["cycleTime"]) => {
      const xs = merged.map((p) => p.cycleTime[key]).filter((x): x is number => x !== null);
      return { medianSeconds: median(xs), measuredPrCount: xs.length };
    };
    const repos = [...new Set(merged.map((p) => p.repo))].map((repo) => ({ repo, merged: merged.filter((p) => p.repo === repo).length, autonomous: autonomous.filter((p) => p.repo === repo).length }));
    return {
      runCount: runs.length,
      prCount: opened.length,
      mergedPrCount: merged.length,
      autonomy: merged.length ? round(autonomous.length / merged.length) : null,
      autonomyFunnel: { totalMerged: merged.length, factoryMerged: merged.length, factoryMergedObserved: merged.filter((p) => p.historyComplete).length, mergedWithoutHumanCodeChange: autonomous.length, repos },
      impact: { additions: measured.reduce((s, p) => s + (p.additions ?? 0), 0), deletions: measured.reduce((s, p) => s + (p.deletions ?? 0), 0), mergedPrCount: merged.length, measuredPrCount: measured.length },
      prLatency: { kickoffToPr: latency("kickoffToPr"), prToFirstReview: latency("prToFirstReview"), firstReviewToMerge: latency("firstReviewToMerge"), kickoffToMerge: latency("kickoffToMerge") },
      averageHumanInteractionsPerPr: opened.length ? round(opened.reduce((s, p) => s + p.humanInteractions.total, 0) / opened.length, 2) : null,
      costUsd: round(runs.reduce((s, x) => s + x.costUsd, 0)),
    };
  }

  private delta(cur: number | null, prev: number | null) {
    return { previous: prev, change: cur !== null && prev !== null ? round(cur - prev) : null, changePct: cur !== null && prev ? round((cur - prev) / prev) : null };
  }

  /** Runs, PRs, autonomy funnel, impact, PR latency and human interactions, with deltas against the previous period. */
  metrics(factory: string, input: { start?: string; end?: string; groupByPeriod?: Period }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const cur = this.core(factory, r);
    const prev = this.core(factory, this.previous(r));
    const series = periods(r).map((p, i, all) => {
      const sub = { start: p, end: all[i + 1] ?? r.end };
      const c = this.core(factory, sub);
      return { periodStart: p, runCount: c.runCount, prCount: c.prCount, mergedPrCount: c.mergedPrCount, autonomy: c.autonomy, costUsd: c.costUsd };
    });
    return {
      ...this.envelope(factory, r),
      ...cur,
      deltas: {
        runCount: this.delta(cur.runCount, prev.runCount),
        prCount: this.delta(cur.prCount, prev.prCount),
        mergedPrCount: this.delta(cur.mergedPrCount, prev.mergedPrCount),
        autonomy: this.delta(cur.autonomy, prev.autonomy),
        averageHumanInteractionsPerPr: this.delta(cur.averageHumanInteractionsPerPr, prev.averageHumanInteractionsPerPr),
        kickoffToMergeSeconds: this.delta(cur.prLatency.kickoffToMerge.medianSeconds, prev.prLatency.kickoffToMerge.medianSeconds),
        costUsd: this.delta(cur.costUsd, prev.costUsd),
      },
      ...(series.length ? { series } : {}),
    };
  }

  private dollars(total: number) {
    // Self-hosted with your own keys: everything is inference spend; compute and platform are yours.
    return { compute: 0, platform: 0, inference: round(total), total: round(total) };
  }

  private prCosts(factory: string, r: Range) {
    return this.prs(factory).filter((p) => within(p.openedAt ?? p.kickoffAt, r));
  }

  /** Cost per PR opened in the range: total, mean, median and a series. */
  costPerPr(factory: string, input: { start?: string; end?: string; groupByPeriod?: Period }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const calc = (rr: Range) => {
      const prs = this.prCosts(factory, rr);
      const total = prs.reduce((s, p) => s + p.costUsd, 0);
      return { prCount: prs.length, dollars: this.dollars(total), mean: prs.length ? round(total / prs.length) : null, median: median(prs.map((p) => p.costUsd)) };
    };
    const cur = calc(r);
    const prev = calc(this.previous(r));
    const series = periods(r).map((p, i, all) => ({ periodStart: p, ...calc({ start: p, end: all[i + 1] ?? r.end }) }));
    return { ...this.envelope(factory, r), ...cur, deltas: { mean: this.delta(cur.mean, prev.mean), median: this.delta(cur.median, prev.median), total: this.delta(cur.dollars.total, prev.dollars.total) }, ...(series.length ? { series } : {}) };
  }

  /** Spend grouped by source or user (rolled up to the root run), or by agent or model (each run's own cost). */
  costBreakdown(factory: string, groupBy: "source" | "user" | "agent" | "model", input: { start?: string; end?: string; groupByPeriod?: Period }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const all = this.runs(factory);
    const byId = new Map(all.map((x) => [x.id, x]));
    const keyOf = (run: Run) => {
      const root = byId.get(run.rootRunId ?? run.id) ?? run;
      if (groupBy === "source") return root.source ?? "UNKNOWN";
      if (groupBy === "user") return root.creator && !root.creator.includes(":") ? root.creator : (root.creator ?? "UNKNOWN");
      if (groupBy === "agent") return run.agent;
      return run.model ?? "UNKNOWN";
    };
    const group = (rr: Range) => {
      const m = new Map<string, { dollars: number; runCount: number }>();
      for (const run of all.filter((x) => within(x.startedAt, rr))) {
        const k = keyOf(run);
        const row = m.get(k) ?? { dollars: 0, runCount: 0 };
        row.dollars += run.costUsd;
        row.runCount += 1;
        m.set(k, row);
      }
      return [...m.entries()].map(([key, v]) => ({ key, dollars: this.dollars(v.dollars), runCount: v.runCount })).sort((a, b) => (a.key === "UNKNOWN" ? 1 : b.key === "UNKNOWN" ? -1 : b.dollars.total - a.dollars.total));
    };
    const series = periods(r).map((p, i, allp) => ({ periodStart: p, groups: group({ start: p, end: allp[i + 1] ?? r.end }) }));
    return { ...this.envelope(factory, r), groupBy, groups: group(r), ...(series.length ? { series } : {}) };
  }

  /** The most expensive PRs opened in the range. */
  topPrs(factory: string, input: { start?: string; end?: string; limit?: number }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const prs = this.prCosts(factory, r).sort((a, b) => b.costUsd - a.costUsd).slice(0, limit);
    return { ...this.envelope(factory, r), prs: prs.map((p) => ({ repo: p.repo, number: p.number, url: p.url, title: p.title, taskId: p.taskId, state: p.state, dollars: this.dollars(p.costUsd), additions: p.additions, deletions: p.deletions })) };
  }

  /** Cost per PR by size: S < 100, M < 500, L < 1000, XL ≥ 1000 changed lines. */
  costBySize(factory: string, input: { start?: string; end?: string; groupByPeriod?: Period }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const size = (p: PrRecord) => {
      if (p.additions === undefined) return "UNKNOWN";
      const lines = p.additions + (p.deletions ?? 0);
      return lines < 100 ? "S" : lines < 500 ? "M" : lines < 1000 ? "L" : "XL";
    };
    const prs = this.prCosts(factory, r);
    const buckets = ["S", "M", "L", "XL", "UNKNOWN"].map((bucket) => {
      const xs = prs.filter((p) => size(p) === bucket).map((p) => p.costUsd);
      const total = xs.reduce((s, x) => s + x, 0);
      return { bucket, prCount: xs.length, dollars: this.dollars(total), mean: xs.length ? round(total / xs.length) : null, median: median(xs) };
    });
    return { ...this.envelope(factory, r), buckets };
  }

  /** Run counts by agent type, status, source (top-level runs only), root vs subrun, model or harness. */
  runBreakdown(factory: string, groupBy: "agent_type" | "status" | "source" | "root_vs_subrun" | "model" | "harness", input: { start?: string; end?: string; groupByPeriod?: Period }) {
    this.k.defs.require(factory);
    const r = this.range(input);
    const keyOf = (run: Run) => {
      switch (groupBy) {
        case "agent_type":
          return run.agentType ?? "UNKNOWN";
        case "status":
          return runState(run);
        case "source":
          return run.source ?? "UNKNOWN";
        case "root_vs_subrun":
          return run.parentRunId ? "SUBRUN" : "ROOT";
        case "model":
          return run.model ?? "UNKNOWN";
        case "harness":
          return run.harness ?? "UNKNOWN";
      }
    };
    const group = (rr: Range) => {
      const m = new Map<string, number>();
      for (const run of this.runs(factory).filter((x) => within(x.startedAt, rr) && (groupBy !== "source" || !x.parentRunId))) m.set(keyOf(run), (m.get(keyOf(run)) ?? 0) + 1);
      return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => (a.key === "UNKNOWN" ? 1 : b.key === "UNKNOWN" ? -1 : b.count - a.count));
    };
    const series = periods(r).map((p, i, all) => ({ periodStart: p, groups: group({ start: p, end: all[i + 1] ?? r.end }) }));
    return { ...this.envelope(factory, r), groupBy, groups: group(r), ...(series.length ? { series } : {}) };
  }

  /** PRs produced by the factory's runs, for dashboards and incremental sync. */
  pullRequests(
    factory: string,
    f: { limit?: number; cursor?: string; repo?: string; state?: PrRecord["state"][]; openedAfter?: string; openedBefore?: string; mergedAfter?: string; mergedBefore?: string; updatedAfter?: string },
  ) {
    this.k.defs.require(factory);
    const rows = this.prs(factory)
      .filter((p) => !f.repo || p.repo === f.repo)
      .filter((p) => !f.state?.length || f.state.includes(p.state))
      .filter((p) => (!f.openedAfter || (p.openedAt ?? "") >= f.openedAfter) && (!f.openedBefore || (p.openedAt ?? "") < f.openedBefore))
      .filter((p) => (!f.mergedAfter || (p.mergedAt ?? "") >= f.mergedAfter) && (!f.mergedBefore || (p.mergedAt !== undefined && p.mergedAt < f.mergedBefore)))
      .filter((p) => !f.updatedAfter || p.updatedAt >= f.updatedAfter)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const { items, pageInfo } = page(rows, Math.min(Math.max(f.limit ?? 50, 1), 500), f.cursor);
    return { pullRequests: items, pageInfo };
  }
}
