"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { DateRange as DayRange } from "react-day-picker";
import { ArrowDownRight, ArrowUpRight, Bot, Globe, Plus } from "lucide-react";
import { ChartCard, Disclosure, Legend, SERIES_COLORS, TimeChart, useHidden, type Series } from "@/components/kiln/charts";
import { InfoTip } from "@/components/kiln/info-tip";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Breakdown, DashboardData, Kpi, PrRow, RunGroup } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

export type Tab = "productivity" | "spending" | "scorers";
export type ScorerCard = { slug: string; name: string; description: string; agents: string[] };
export type ImprovementPr = { id: string; agent: string; category: string; state: string; url?: string; title: string; createdAt: string; passRateBefore: number; passRateAfter: number };

const TABS: { id: Tab; label: string }[] = [
  { id: "productivity", label: "Productivity" },
  { id: "spending", label: "Spending" },
  { id: "scorers", label: "Scorers" },
];

const RANGE_ITEMS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom…" },
];

/** Top-bar date-range select; "Custom…" opens a range calendar. Writes ?range= or ?from=&to=. */
export function RangeSelect({ value, label }: { value: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<DayRange | undefined>();
  const go = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  };
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const items = value === "custom" ? RANGE_ITEMS.map((i) => (i.value === "custom" ? { ...i, label } : i)) : RANGE_ITEMS;
  return (
    <>
      <Select
        items={items}
        value={value}
        onValueChange={(v) => {
          if (v === "custom") setOpen(true);
          else go({ range: v === "7d" ? undefined : String(v), from: undefined, to: undefined });
        }}
      >
        <SelectTrigger className="w-40" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end">
          {RANGE_ITEMS.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-fit">
          <DialogHeader>
            <DialogTitle>Custom range</DialogTitle>
          </DialogHeader>
          <Calendar mode="range" numberOfMonths={2} selected={days} onSelect={setDays} disabled={{ after: new Date() }} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!days?.from}
              onClick={() => {
                if (!days?.from) return;
                go({ range: undefined, from: iso(days.from), to: iso(days.to ?? days.from) });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DashboardTabs({ tab }: { tab: Tab }) {
  const params = useSearchParams();
  return (
    <div className="flex gap-2" role="tablist">
      {TABS.map((t) => {
        const p = new URLSearchParams(params.toString());
        if (t.id === "productivity") p.delete("tab");
        else p.set("tab", t.id);
        const qs = p.toString();
        return (
          <Link
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            href={qs ? `?${qs}` : "?"}
            scroll={false}
            className={cn("flex h-9 items-center rounded-lg border px-3.5 text-sm font-medium transition-colors", tab === t.id ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

const colorize = (names: string[], fixed: Record<string, string> = {}): Series[] => names.map((n, i) => ({ key: n, label: n, color: fixed[n] ?? SERIES_COLORS[i % SERIES_COLORS.length]! }));
const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(2)}`);

function formatKpi(k: Kpi) {
  if (k.value === null) return "—";
  if (k.format === "pct") return `${Math.round(k.value * 100)}%`;
  if (k.format === "usd") return usd(k.value);
  if (k.format === "hours") return hours(k.value);
  return String(k.value);
}

function KpiCard({ k }: { k: Kpi }) {
  const good = k.delta === null ? null : k.delta === 0 ? null : k.delta > 0 === k.goodWhenUp;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {k.label}
        <InfoTip title={k.label}>{k.tip}</InfoTip>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatKpi(k)}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {k.delta === null ? (
          <span>No previous data</span>
        ) : (
          <>
            <span className={cn("inline-flex items-center font-medium", good === null ? "" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {k.delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(Math.round(k.delta * 100))}%
            </span>
            <span>vs previous period</span>
          </>
        )}
      </div>
    </div>
  );
}

const TIPS = {
  interactions:
    "The average number of human interactions per merged PR attributed to this factory in the selected range. This includes code updates, comments, reviews, assignments, status changes, and eligible Slack and Linear follow-ups; coverage starts when PR-fact collection began.",
  cycle:
    "Median time this factory’s merged PRs took to move from run kickoff through PR, first human review, and merge. Each stage is measured over the PRs where both of its endpoints were recorded, so stages don’t sum to the overall time.",
  cell: "No merged PR in this range has both of this stage's endpoints recorded.",
  review: "Review stages count human reviews only and need review webhook coverage.",
  prs: "PRs opened by this factory, and how many of each period’s PRs went on to merge. Opened and merged are tracked by different pipelines, so a period’s merged count can occasionally exceed its opened count.",
  runs: "Runs executed by this factory’s agents in the range, bucketed by creation time. Subruns count individually except in the By source view, where only top-level runs have a source.",
  costPerPr:
    "The average cost of the PRs opened in the range, merged or not. Each PR carries its whole run tree — the runs plus their subruns — with the cost split evenly when one tree produced several PRs.",
  source: "Each run tree’s cost rolls up to the trigger that started the root run — Linear, Slack, API, and so on.",
  user: "Each run tree’s cost rolls up to the person who started the root run.",
  agent: "Each run keeps its own cost, attributed to the configured agent that executed it.",
  model: "Each run keeps its own cost, attributed to the model it ran on.",
};

const GROUPS: { value: RunGroup; label: string }[] = [
  { value: "agentType", label: "By agent type" },
  { value: "status", label: "By status" },
  { value: "source", label: "By source" },
  { value: "topLevel", label: "Top-level vs subruns" },
  { value: "model", label: "By model" },
  { value: "harness", label: "By harness" },
];
const TYPE_COLORS: Record<string, string> = { Foreman: "#8b5cf6", Code: "#ea580c", Review: "#db2777", Triage: "#16a34a", Spec: "#d97706", Verify: "#0d9488" };

function CycleCell({ label, value, review }: { label: string; value: number | null; review?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
        {label}
        <InfoTip title={label}>{value === null ? `${TIPS.cell}${review ? ` ${TIPS.review}` : ""}` : "Median over the merged PRs in this range."}</InfoTip>
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value === null ? "not measured" : hours(value)}</div>
    </div>
  );
}

function Productivity({ data, improvements, factory }: { data: DashboardData; improvements: ImprovementPr[]; factory: string }) {
  const [prHidden, togglePr] = useHidden();
  const [group, setGroup] = useState<RunGroup>("agentType");
  const [runHidden, toggleRun] = useHidden();
  const prSeries: Series[] = [
    { key: "opened", label: "Opened", color: "#8b5cf6" },
    { key: "merged", label: "Merged", color: "#ea580c" },
  ];
  const g = data.runs.groups[group];
  const runSeries = colorize(g.series, TYPE_COLORS);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((k) => (
          <KpiCard key={k.key} k={k} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Human interactions per PR" tip={TIPS.interactions} value={data.interactions.value}>
          <TimeChart rows={data.interactions.rows} series={[{ key: "interactions", label: "Interactions", color: "#ea580c" }]} height={260} />
        </ChartCard>
        <section className="overflow-hidden rounded-xl border bg-card">
          <h3 className="flex items-center gap-1.5 border-b px-4 py-3 text-sm font-medium text-muted-foreground">
            Median cycle time
            <InfoTip title="Median cycle time">{TIPS.cycle}</InfoTip>
          </h3>
          <div className="grid h-[calc(100%-45px)] grid-cols-2 [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b">
            <CycleCell label="Kickoff → merge" value={data.cycle.kickoffToMerge} />
            <CycleCell label="Kickoff → PR" value={data.cycle.kickoffToPr} />
            <CycleCell label="PR → first human review" value={data.cycle.prToReview} review />
            <CycleCell label="First human review → merge" value={data.cycle.reviewToMerge} review />
          </div>
        </section>
        <ChartCard title="Pull requests" tip={TIPS.prs} value={data.prs.opened} sub={`${data.prs.merged} merged`} controls={<Legend series={prSeries} hidden={prHidden} onToggle={togglePr} />}>
          <TimeChart rows={data.prs.rows} series={prSeries.filter((s) => !prHidden.has(s.key))} height={260} />
        </ChartCard>
        <ChartCard
          title="Total runs"
          tip={TIPS.runs}
          value={data.runs.total}
          sub={`${data.runs.topLevel} top-level runs`}
          controls={
            <>
              <Select items={GROUPS} value={group} onValueChange={(v) => setGroup(v as RunGroup)}>
                <SelectTrigger className="h-9 w-56" aria-label="Group runs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUPS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Legend series={runSeries} hidden={runHidden} onToggle={toggleRun} />
            </>
          }
        >
          <TimeChart rows={g.rows} series={runSeries.filter((s) => !runHidden.has(s.key))} kind="stacked" height={260} />
        </ChartCard>
      </div>
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium text-muted-foreground">Latest self-improvement PRs</h3>
          <Link href={`/f/${factory}/self-improvement`} className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        {improvements.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No self-improvement PRs yet. They appear when scored failures cross the threshold.</p>
        ) : (
          <ul className="divide-y">
            {improvements.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Bot className="size-4 shrink-0 text-muted-foreground" />
                <a href={p.url ?? `/f/${factory}/self-improvement`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {p.title}
                </a>
                <span className="hidden text-muted-foreground sm:inline">{p.agent}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(p.passRateBefore * 100)}% → {Math.round(p.passRateAfter * 100)}%
                </span>
                <StatusPill status={p.state === "merged" ? "merged" : p.state === "rejected" ? "closed" : "open"} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: PrRow["status"] }) {
  const cls = {
    merged: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
    closed: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    open: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  }[status];
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize", cls)}>{status}</span>;
}

const MODEL_BAR = ["bg-foreground", "bg-[#c2410c]", "bg-muted-foreground", "bg-slate-500", "bg-orange-300"];

function PrTable({ rows }: { rows: PrRow[] }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No pull requests in this range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pull request</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Creator</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="w-44">Model(s)</TableHead>
          <TableHead className="text-right">Diff</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="max-w-72">
              <a href={p.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">
                {p.title}
              </a>
              <div className="text-xs text-muted-foreground">
                {p.repo}#{p.number}
              </div>
            </TableCell>
            <TableCell>
              <StatusPill status={p.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{p.creator}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                <Globe className="size-3.5" />
                {p.source}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex h-2 w-40 overflow-hidden rounded-full bg-muted" title={p.models.map((m) => `${m.model} ${Math.round(m.share * 100)}%`).join(", ")}>
                {p.models.map((m, i) => (
                  <span key={m.model} className={cn("h-full", MODEL_BAR[i % MODEL_BAR.length])} style={{ width: `${m.share * 100}%` }} />
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              {p.additions !== undefined ? (
                <>
                  <span className="text-emerald-600 dark:text-emerald-400">+{p.additions}</span> <span className="text-red-600 dark:text-red-400">−{p.deletions ?? 0}</span>
                  <div className="text-muted-foreground">{p.files ?? 0} files</div>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">{usd(p.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CostTable({ rows, label = "Name", detail }: { rows: Breakdown[]; label?: string; detail?: boolean }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No spend in this range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          {!detail && <TableHead className="text-right">{label === "Size" || label === "Component" ? "PRs" : "Runs"}</TableHead>}
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>
              <div className="font-medium">{r.name}</div>
              {detail && (
                <div className="text-xs text-muted-foreground">
                  {usd(r.compute)} compute · {usd(r.inference)} inference
                </div>
              )}
            </TableCell>
            {!detail && <TableCell className="text-right tabular-nums">{r.runs}</TableCell>}
            <TableCell className="text-right font-medium tabular-nums">{usd(r.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SpendCard({ title, tip, unit, data, footer, footerHint, detail }: { title: string; tip: string; unit: string; data: DashboardData["spend"]["agent"]; footer: string; footerHint: string; detail?: boolean }) {
  const [hidden, toggle] = useHidden();
  const series = colorize(data.series.series);
  const n = data.table.length;
  return (
    <ChartCard
      title={title}
      tip={tip}
      value={usd(data.total)}
      sub={`${usd(n ? data.total / n : 0)} per ${unit}, ${n} ${unit}${n === 1 ? "" : "s"}`}
      controls={<Legend series={series} hidden={hidden} onToggle={toggle} />}
      footer={
        <Disclosure label={footer} hint={footerHint}>
          <CostTable rows={data.table} detail={detail} />
        </Disclosure>
      }
    >
      <TimeChart rows={data.series.rows} series={series.filter((s) => !hidden.has(s.key))} kind="area" format="usd" height={260} />
    </ChartCard>
  );
}

function Spending({ data }: { data: DashboardData }) {
  const [mode, setMode] = useState<"breakdown" | "size">("breakdown");
  const [hidden, toggle] = useHidden();
  const src = mode === "breakdown" ? data.cost.breakdown : data.cost.bySize;
  const series = mode === "breakdown" ? [{ key: "Compute", label: "Compute", color: "#2563eb" }, { key: "Inference", label: "Inference", color: "#8b5cf6" }] : colorize(["S", "M", "L", "XL"]);
  const modes = [
    { value: "breakdown", label: "Cost breakdown" },
    { value: "size", label: "By PR size" },
  ];
  return (
    <div className="space-y-6">
      <ChartCard
        title="Cost per PR"
        tip={TIPS.costPerPr}
        value={usd(data.cost.perPr ?? 0)}
        sub={`${usd(data.cost.total)} total (approximate) · ${data.cost.prCount} PRs`}
        controls={
          <>
            <Select items={modes} value={mode} onValueChange={(v) => setMode(v as "breakdown" | "size")}>
              <SelectTrigger className="h-9 w-56" aria-label="Cost view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Legend series={series} hidden={hidden} onToggle={toggle} />
          </>
        }
        footer={
          <>
            <Disclosure label="Most expensive PRs" hint="top 20 by attributed cost">
              <PrTable rows={data.topPrs} />
            </Disclosure>
            <Disclosure label="By PR size" hint="S · M · L · XL">
              <CostTable rows={data.bySize} label="Size" />
            </Disclosure>
            <Disclosure label="By component" hint="ranked by spend">
              <CostTable rows={data.byComponent} label="Component" />
            </Disclosure>
          </>
        }
      >
        <TimeChart rows={src.rows} series={series.filter((s) => !hidden.has(s.key))} format="usd" height={260} />
      </ChartCard>
      <SpendCard title="Spend by source" tip={TIPS.source} unit="source" data={data.spend.source} footer="Sources" footerHint="ranked by spend" />
      <SpendCard title="Spend by user" tip={TIPS.user} unit="user" data={data.spend.user} footer="Users" footerHint="ranked by spend" />
      <SpendCard title="Spend by agent" tip={TIPS.agent} unit="agent" data={data.spend.agent} footer="Agents" footerHint="ranked by spend" detail />
      <SpendCard title="Spend by model" tip={TIPS.model} unit="model" data={data.spend.model} footer="Models" footerHint="ranked by spend" />
    </div>
  );
}

function ScorerTile({ s, factory, data }: { s: ScorerCard; factory: string; data?: DashboardData["scores"][string] }) {
  const [all, setAll] = useState(false);
  const shown = all ? s.agents : s.agents.slice(0, 4);
  return (
    <Link href={`/f/${factory}/scorers/${s.slug}`} className="flex min-h-72 flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {s.name}
        {s.description && <InfoTip title={s.name}>{s.description}</InfoTip>}
      </div>
      <div className="mt-1 text-sm">{data?.count ? `${Math.round((data.passRate ?? 0) * 100)}% passing · ${data.count} scores` : "No scores in this range"}</div>
      <div className="flex flex-1 items-center justify-center py-4">
        {data?.count ? <TimeChart rows={data.rows} series={[{ key: "Pass rate", label: "Pass rate %", color: "#8b5cf6" }]} height={150} /> : <span className="text-sm text-muted-foreground">No scores in this range</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((a) => (
          <span key={a} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {a}
          </span>
        ))}
        {s.agents.length > 4 && !all && (
          <button
            type="button"
            className="px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              setAll(true);
            }}
          >
            Show {s.agents.length - 4} more
          </button>
        )}
      </div>
    </Link>
  );
}

function Scorers({ scorers, data, factory }: { scorers: ScorerCard[]; data: DashboardData; factory: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {scorers.map((s) => (
        <ScorerTile key={s.slug} s={s} factory={factory} data={data.scores[s.slug] ?? data.scores[s.name]} />
      ))}
      <Link href={`/f/${factory}/scorers/new`} className="flex min-h-72 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground">
        <Plus className="size-5" />
        Add scorer
      </Link>
    </div>
  );
}

export function DashboardView({ tab, data, scorers, improvements, factory }: { tab: Tab; data: DashboardData; scorers: ScorerCard[]; improvements: ImprovementPr[]; factory: string }) {
  const body = useMemo(() => {
    if (tab === "spending") return <Spending data={data} />;
    if (tab === "scorers") return <Scorers scorers={scorers} data={data} factory={factory} />;
    return <Productivity data={data} improvements={improvements} factory={factory} />;
  }, [tab, data, scorers, improvements, factory]);
  return body;
}

