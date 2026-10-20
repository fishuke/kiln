import type { Kiln } from "../kiln";
import { C, type Run } from "../types";
import { BudgetExceededError } from "./types";

/** One row of the usage ledger: a run's cost, attributed to a team, factory, agent, model and user. */
export type UsageEntry = { runId: string; at: string; teamId: string; factory: string; agent: string; model: string; userId?: string; user: string; kind: Run["kind"]; costUsd: number };

export type Breakdown = { key: string; costUsd: number; runs: number }[];

export type UsageSummary = {
  teamId: string;
  since: string;
  until: string;
  totalUsd: number;
  runs: number;
  limit: { monthlyUsd: number; autoStop: boolean; spentThisMonthUsd: number; remainingUsd: number; exceeded: boolean };
  byDay: Breakdown;
  byFactory: Breakdown;
  byAgent: Breakdown;
  byModel: Breakdown;
  byUser: Breakdown;
};

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function group(entries: UsageEntry[], key: (e: UsageEntry) => string): Breakdown {
  const m = new Map<string, { costUsd: number; runs: number }>();
  for (const e of entries) {
    const k = key(e);
    const row = m.get(k) ?? { costUsd: 0, runs: 0 };
    row.costUsd += e.costUsd;
    row.runs += 1;
    m.set(k, row);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, costUsd: Math.round(v.costUsd * 1e6) / 1e6, runs: v.runs })).sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));
}

/** Usage tracking and the team's monthly spend limit. Self-hosted: no plans, no credits. */
export class UsageService {
  constructor(private readonly k: Kiln) {}

  /** Ledger rows derived from runs (their costs are recorded as they finish). */
  ledger(teamId: string, filter: { since?: string; until?: string; factory?: string; userId?: string } = {}): UsageEntry[] {
    const factories = new Set(this.k.teams.factoriesOf(teamId).map((f) => f.id));
    return this.k.store
      .list<Run>(C.runs, (r) => (r.team ? r.team === teamId : factories.has(r.factory)) && (!filter.since || r.startedAt >= filter.since) && (!filter.until || r.startedAt < filter.until) && (!filter.factory || r.factory === filter.factory))
      .map((r) => this.entry(r, teamId))
      .filter((e) => !filter.userId || e.userId === filter.userId)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  private entry(r: Run, teamId: string): UsageEntry {
    let userId = r.userId;
    if (!userId && r.workItemId) userId = this.k.users.forRequester(this.k.workflow.get(r.workItemId)?.requester)?.id;
    const user = userId ? (this.k.users.get(userId)?.email ?? userId) : "team";
    return { runId: r.id, at: r.startedAt, teamId, factory: r.factory, agent: r.agent, model: r.model ?? "default", userId, user, kind: r.kind, costUsd: r.costUsd ?? 0 };
  }

  monthSpend(teamId: string): number {
    return this.ledger(teamId, { since: monthStart(this.k.clock.now()) }).reduce((s, e) => s + e.costUsd, 0);
  }

  summary(teamId: string, opts: { since?: string; until?: string; factory?: string; userId?: string } = {}): UsageSummary {
    const now = this.k.clock.now();
    const since = opts.since ?? monthStart(now);
    const until = opts.until ?? new Date(now.getTime() + 1).toISOString();
    const entries = this.ledger(teamId, { ...opts, since, until });
    const settings = this.k.teams.settings(teamId).spendLimit;
    const spent = this.monthSpend(teamId);
    return {
      teamId,
      since,
      until,
      totalUsd: Math.round(entries.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6,
      runs: entries.length,
      limit: { monthlyUsd: settings.monthlyUsd, autoStop: settings.autoStop, spentThisMonthUsd: spent, remainingUsd: Math.max(0, settings.monthlyUsd - spent), exceeded: spent >= settings.monthlyUsd },
      byDay: group(entries, (e) => e.at.slice(0, 10)).sort((a, b) => a.key.localeCompare(b.key)),
      byFactory: group(entries, (e) => e.factory),
      byAgent: group(entries, (e) => `${e.factory}/${e.agent}`),
      byModel: group(entries, (e) => e.model),
      byUser: group(entries, (e) => e.user),
    };
  }

  /** The monthly limit is soft unless the team turned on auto-stop; then new runs are refused. */
  assertWithinBudget(teamId: string | undefined) {
    if (!teamId || !this.k.teams.get(teamId)) return;
    const { monthlyUsd, autoStop } = this.k.teams.settings(teamId).spendLimit;
    if (!autoStop) return;
    const spent = this.monthSpend(teamId);
    if (spent >= monthlyUsd) throw new BudgetExceededError(monthlyUsd, spent);
  }
}
