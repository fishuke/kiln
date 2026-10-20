import type { Kiln } from "./kiln";
import { C, type Run, type Score, type WorkItem } from "./types";

export type FactoryMetrics = {
  factory: string;
  since: string;
  prsOpened: number;
  prsMerged: number;
  autonomy: number;
  autonomousMerged: number;
  humanTouchesPerPr: number;
  cycleTimeHoursMedian: number | null;
  costUsd: number;
  costPerMergedPrUsd: number | null;
  workItems: { total: number; active: number; complete: number; blocked: number; cancelled: number };
  byAgent: { agent: string; runs: number; costUsd: number; costPerMergedPrUsd: number | null; scored: number; passRate: number | null }[];
  byDefinition: { sha: string; workItems: number; passRate: number | null; costUsd: number }[];
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Everything is computed from stored work items, runs and scores, so the API, MCP and web agree. */
export class MetricsService {
  constructor(private readonly k: Kiln) {}

  factory(factory: string, opts: { since?: string; agent?: string } = {}): FactoryMetrics {
    const since = opts.since ?? new Date(this.k.clock.now().getTime() - 30 * 86_400_000).toISOString();
    const items = this.k.store.list<WorkItem>(C.workItems, (w) => w.factory === factory && w.createdAt >= since);
    const runs = this.k.store.list<Run>(C.runs, (r) => r.factory === factory && r.startedAt >= since && (!opts.agent || r.agent === opts.agent));
    const scores = this.k.store.list<Score>(C.scores, (s) => s.factory === factory && s.createdAt >= since);
    const withPr = items.filter((w) => w.pr);
    const merged = items.filter((w) => w.state === "complete" && w.completion?.by === "merge");
    // A merged PR is autonomous when the only human touch was the original request.
    const autonomous = merged.filter((w) => w.humanTouches <= 1);
    const cost = runs.reduce((s, r) => s + r.costUsd, 0);
    const agents = [...new Set(runs.map((r) => r.agent))];
    const passRate = (ss: Score[]) => (ss.length ? round(ss.filter((s) => s.passed).length / ss.length) : null);
    const shas = [...new Set(items.map((w) => w.definitionSha))];
    return {
      factory,
      since,
      prsOpened: withPr.length,
      prsMerged: merged.length,
      autonomy: merged.length ? round(autonomous.length / merged.length) : 0,
      autonomousMerged: autonomous.length,
      humanTouchesPerPr: withPr.length ? round(withPr.reduce((s, w) => s + w.humanTouches, 0) / withPr.length) : 0,
      cycleTimeHoursMedian: (() => {
        const m = median(merged.filter((w) => w.completedAt).map((w) => (new Date(w.completedAt!).getTime() - new Date(w.createdAt).getTime()) / 3_600_000));
        return m === null ? null : round(m);
      })(),
      costUsd: round(cost),
      costPerMergedPrUsd: merged.length ? round(cost / merged.length) : null,
      workItems: {
        total: items.length,
        active: items.filter((w) => !["complete", "cancelled", "failed"].includes(w.state)).length,
        complete: items.filter((w) => w.state === "complete").length,
        blocked: items.filter((w) => w.state === "blocked").length,
        cancelled: items.filter((w) => w.state === "cancelled").length,
      },
      byAgent: agents.map((agent) => {
        const rs = runs.filter((r) => r.agent === agent);
        const c = rs.reduce((s, r) => s + r.costUsd, 0);
        const mergedRuns = new Set(merged.map((w) => w.id));
        const mergedTouched = new Set(rs.filter((r) => r.workItemId && mergedRuns.has(r.workItemId)).map((r) => r.workItemId));
        const ss = scores.filter((s) => s.agent === agent);
        return { agent, runs: rs.length, costUsd: round(c), costPerMergedPrUsd: mergedTouched.size ? round(c / mergedTouched.size) : null, scored: ss.length, passRate: passRate(ss) };
      }),
      byDefinition: shas.map((sha) => ({
        sha,
        workItems: items.filter((w) => w.definitionSha === sha).length,
        passRate: passRate(scores.filter((s) => s.definitionSha === sha)),
        costUsd: round(runs.filter((r) => r.definitionSha === sha).reduce((s, r) => s + r.costUsd, 0)),
      })),
    };
  }

  /** Raw rows for agents and dashboards that want to compute their own views. */
  raw(factory: string, kind: "runs" | "scores" | "work_items", since?: string) {
    const coll = kind === "runs" ? C.runs : kind === "scores" ? C.scores : C.workItems;
    return this.k.store.list<{ id: string; factory: string; createdAt?: string; startedAt?: string }>(coll, (r) => r.factory === factory && (!since || (r.createdAt ?? r.startedAt ?? "") >= since));
  }
}
