import type { Metadata } from "next";
import Link from "next/link";
import { ApiDown } from "@/components/kiln/ui";
import { SettingsColumn } from "@/components/kiln/settings-blocks";
import { api, safe } from "@/lib/kiln";
import { barPercent, fillDays, formatUsd, monthLabel, usageTone, usedFraction, withShares, type BreakdownRow } from "@/lib/usage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage and limits" };

const PERIODS = [
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "30d", label: "Last 30 days" },
] as const;

function range(period: string, now = new Date()): { since?: string; until?: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "last-month") return { since: new Date(Date.UTC(y, m - 1, 1)).toISOString(), until: new Date(Date.UTC(y, m, 1) - 1).toISOString() };
  if (period === "30d") return { since: new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z" };
  return {};
}

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ period?: string; factory?: string }> }) {
  const sp = await searchParams;
  const period = PERIODS.some((p) => p.id === sp.period) ? sp.period! : "month";
  const [usage, me] = await Promise.all([safe(() => api.usage({ ...range(period), factory: sp.factory }), null), safe(() => api.me(), null)]);
  if (!usage) return <ApiDown />;
  const { limit } = usage;
  const tone = usageTone(limit);
  const used = usedFraction(limit);
  const now = new Date();
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const days = fillDays(usage.byDay, usage.since, usage.until);
  const maxDay = Math.max(0, ...days.map((d) => d.costUsd));
  const admin = me?.role === "owner" || me?.role === "admin";
  return (
    <SettingsColumn title="Usage and limits">
      <div className="rounded-xl border p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className={cn("size-2 rounded-full", tone === "ok" ? "bg-blue-500" : tone === "warn" ? "bg-amber-500" : "bg-red-500")} />
          Team usage{me?.currentTeam ? ` · ${me.currentTeam.name}` : ""}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatUsd(limit.spentThisMonthUsd)}</span>
          <span className="text-base text-muted-foreground">of {formatUsd(limit.monthlyUsd)} monthly limit</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label="Spend this month">
          <div className={cn("h-full rounded-full", tone === "ok" ? "bg-foreground" : tone === "warn" ? "bg-amber-500" : "bg-red-500")} style={{ width: `${barPercent(limit.spentThisMonthUsd, limit.monthlyUsd || 1)}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatUsd(limit.remainingUsd)} left · resets {resets.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
          </span>
          <span>{limit.autoStop ? "New runs stop when the limit is reached." : "Soft limit: runs continue past it."}</span>
        </div>
        {limit.exceeded && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            This team has reached its monthly limit.{limit.autoStop ? " New work is refused until the limit is raised or next month starts." : ""}
          </p>
        )}
      </div>

      <h2 className="mt-10 mb-3 text-lg font-medium text-foreground/70">Spend limit</h2>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Costs are what each harness reports, for comparing, not invoices. Team owners and admins set the monthly limit and auto-stop.</p>
        {admin && (
          <Link href="/team#spend-limit" className="shrink-0 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Change limit
          </Link>
        )}
      </div>

      <div className="mt-10 mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground/70">Breakdown</h2>
        <nav className="flex rounded-lg border p-0.5 text-sm" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p.id} href={p.id === "month" ? "/settings/usage" : `/settings/usage?period=${p.id}`} className={cn("rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground", period === p.id && "bg-muted font-medium text-foreground")}>
              {p.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="rounded-xl border p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold">Spend by day</div>
            <div className="text-xs text-muted-foreground">{period === "month" ? monthLabel(usage.since) : `${usage.since.slice(0, 10)} to ${usage.until.slice(0, 10)}`}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">{formatUsd(usage.totalUsd)}</div>
            <div className="text-xs text-muted-foreground">
              {usage.runs} run{usage.runs === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex h-36 items-end gap-[3px]" role="img" aria-label="Spend per day">
          {days.map((d) => (
            <div key={d.key} className="group relative flex h-full flex-1 items-end">
              <div className="w-full rounded-t-sm bg-foreground/80 group-hover:bg-foreground" style={{ height: `${Math.max(d.costUsd > 0 ? 2 : 0, barPercent(d.costUsd, maxDay))}%` }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-md group-hover:block">
                {d.key}: {formatUsd(d.costUsd)} · {d.runs} runs
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{days[0]?.key.slice(5)}</span>
          <span>{days.at(-1)?.key.slice(5)}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <BreakdownCard title="By factory" rows={usage.byFactory} />
        <BreakdownCard title="By agent" rows={usage.byAgent} />
        <BreakdownCard title="By model" rows={usage.byModel} />
        <BreakdownCard title="By person" rows={usage.byUser.map((r) => ({ ...r, key: r.key === "team" ? "Team (keys, schedules, webhooks)" : r.key }))} />
      </div>
    </SettingsColumn>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const shown = withShares(rows, 8);
  return (
    <div className="rounded-xl border p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No runs in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>Name</th>
              <th>Cost</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="py-1.5 pr-3">
                  <div className="truncate" title={r.key}>
                    {r.key}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground/70" style={{ width: `${r.share}%` }} />
                  </div>
                </td>
                <td className="w-20 py-1.5 text-right font-medium tabular-nums">{formatUsd(r.costUsd)}</td>
                <td className="w-16 py-1.5 text-right text-muted-foreground tabular-nums">{r.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
