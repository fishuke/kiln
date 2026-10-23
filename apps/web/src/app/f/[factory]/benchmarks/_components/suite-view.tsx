"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Award, ChevronRight, Coins, EllipsisVertical, Gauge, Pencil, Play, Plus, Route, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { Markdown } from "@/components/kiln/markdown";
import { PillTabs } from "@/components/kiln/pill-tabs";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { groupResults, narrative, recommend, summarize, type ConfigRow, type Result, type SuiteModel, type TaskModel } from "@/lib/benchmarks";
import { pct, timeAgo, usd } from "@/lib/format";
import { toastResult } from "@/lib/toast-result";
import { cn } from "@/lib/utils";
import { addTasks, deleteBenchmark, removeTask, startBenchmark, suggestRouting, updateTask } from "../actions";
import { duration } from "../../automations/_components/runs-table";
import { RunDialog } from "./run-dialog";
import { AddTaskDialog, clean, draftProblem, ScratchTaskForm } from "./task-dialog";

/** Average cost (x) against quality (y); the Pareto frontier is drawn and its points filled. */
function ComparisonChart({ rows }: { rows: ConfigRow[] }) {
  const W = 640;
  const H = 280;
  const pad = { l: 48, r: 24, t: 16, b: 40 };
  const maxCost = Math.max(...rows.map((r) => r.avgCostUsd), 0.01) * 1.15;
  const x = (c: number) => pad.l + (c / maxCost) * (W - pad.l - pad.r);
  const y = (s: number) => pad.t + (1 - s) * (H - pad.t - pad.b);
  const front = rows.filter((r) => r.pareto).sort((a, b) => a.avgCostUsd - b.avgCostUsd);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Correctness versus average cost">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray="3 3" />
          <text x={pad.l - 8} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {v * 100}%
          </text>
        </g>
      ))}
      {[0, 0.5, 1].map((v) => (
        <text key={v} x={x(v * maxCost)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {usd(v * maxCost)}
        </text>
      ))}
      <text x={(W + pad.l) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
        Average cost per trial
      </text>
      <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="fill-muted-foreground text-[11px]">
        Correctness
      </text>
      {front.length > 1 && <polyline points={front.map((r) => `${x(r.avgCostUsd)},${y(r.successRate)}`).join(" ")} className="fill-none stroke-violet-600 dark:stroke-violet-400" strokeWidth={1.5} strokeDasharray="5 4" />}
      {rows.map((r, i) => {
        const cx = x(r.avgCostUsd);
        const cy = y(r.successRate);
        // Stack labels of points that sit on top of each other; flip labels near the right edge.
        const stack = rows.slice(0, i).filter((o) => Math.abs(x(o.avgCostUsd) - cx) < 4 && Math.abs(y(o.successRate) - cy) < 4).length;
        const right = cx > W * 0.7;
        const ly = cy + 4 + (cy > H / 2 ? -14 * stack : 14 * stack);
        return (
          <g key={r.configuration}>
            <circle cx={cx} cy={cy} r={6} className={r.pareto ? "fill-violet-600 dark:fill-violet-400" : "fill-background stroke-muted-foreground"} strokeWidth={1.5}>
              <title>{`${r.configuration}: ${pct(r.successRate)} at ${usd(r.avgCostUsd)}${r.pareto ? " (Pareto frontier)" : ""}`}</title>
            </circle>
            <text x={right ? cx - 10 : cx + 10} y={ly} textAnchor={right ? "end" : "start"} className="fill-foreground text-[11px]">
              {r.configuration}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const REC_ICON = { overall: Award, efficient: Gauge, cheapest: Coins } as const;

function Results({ results, tasks, taskTitle }: { results: Result[]; tasks: number; taskTitle: (slug: string) => string }) {
  const rows = useMemo(() => summarize(results), [results]);
  const recs = recommend(rows);
  const groups = useMemo(() => groupResults(results), [results]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const total = results.reduce((s, r) => s + r.costUsd, 0);
  const first = results.reduce((m, r) => (r.at < m ? r.at : m), results[0]?.at ?? "");
  const last = results.reduce((m, r) => {
    const end = new Date(new Date(r.at).getTime() + r.durationMs).toISOString();
    return end > m ? end : m;
  }, "");
  if (!results.length) return <div className="rounded-2xl bg-muted/60 px-6 py-16 text-center text-sm text-muted-foreground">Run the benchmark to compare configurations.</div>;
  return (
    <div className="space-y-6">
      {recs.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {recs.map((r) => {
            const Icon = REC_ICON[r.kind];
            return (
              <div key={r.kind} className={cn("rounded-xl border p-4", r.kind === "overall" && "border-violet-300 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/30")}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon className="size-3.5" /> {r.kind === "overall" ? "Overall recommendation" : r.title}
                </div>
                <div className="mt-1 text-lg font-semibold">{r.configuration}</div>
                <div className="text-sm text-muted-foreground">{r.detail}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Total cost</div>
          <div className="text-xl font-semibold">{usd(total)}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Run time</div>
          <div className="text-xl font-semibold">{duration(first, last)}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Trials</div>
          <div className="text-xl font-semibold">{results.length}</div>
        </div>
      </div>
      <div className="rounded-xl border p-4">
        <div className="mb-2 text-sm font-medium">Comparison</div>
        <ComparisonChart rows={rows} />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-normal">Configuration</th>
              <th className="px-4 py-3 text-right font-normal">Correctness</th>
              <th className="px-4 py-3 text-right font-normal">Overall</th>
              <th className="px-4 py-3 text-right font-normal">Avg cost</th>
              <th className="px-4 py-3 text-right font-normal">Avg time</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const row = rows.find((r) => r.configuration === g.configuration)!;
              return (
                <Fragment key={g.configuration}>
                  <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={() => toggle(g.configuration)}>
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open[g.configuration] && "rotate-90")} />
                        {g.configuration}
                        {row.pareto && <span className="rounded-full bg-violet-100 px-1.5 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">Pareto</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{pct(row.successRate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.avgScore.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{usd(row.avgCostUsd)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{duration(new Date(0).toISOString(), new Date(row.avgDurationMs).toISOString())}</td>
                  </tr>
                  {open[g.configuration] &&
                    g.tasks.map((t) => {
                      const k = `${g.configuration}/${t.task}`;
                      const ok = t.reps.filter((r) => r.success).length / t.reps.length;
                      return (
                        <Fragment key={k}>
                          <tr className="cursor-pointer border-b bg-muted/20 hover:bg-muted/40" onClick={() => toggle(k)}>
                            <td className="py-2.5 pr-4 pl-10">
                              <span className="inline-flex items-center gap-1.5">
                                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open[k] && "rotate-90")} />
                                {taskTitle(t.task)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{pct(ok)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{(t.reps.reduce((s, r) => s + r.score, 0) / t.reps.length).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{usd(t.reps.reduce((s, r) => s + r.costUsd, 0) / t.reps.length)}</td>
                            <td className="px-4 py-2.5" />
                          </tr>
                          {open[k] &&
                            t.reps.map((r, i) => (
                              <tr key={r.runId} className="border-b bg-muted/10 text-xs">
                                <td className="py-2 pr-4 pl-16">
                                  <Link href={`/runs/${r.runId}`} className="hover:underline">
                                    Repetition {i + 1}
                                  </Link>
                                </td>
                                <td className={cn("px-4 py-2 text-right", r.success ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>{r.success ? "Correct" : "Incorrect"}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{r.score.toFixed(2)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{usd(r.costUsd)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{duration(r.at, new Date(new Date(r.at).getTime() + r.durationMs).toISOString())}</td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Summary</div>
        <Markdown className="text-sm">{narrative(rows, tasks)}</Markdown>
      </div>
    </div>
  );
}

export type SuiteViewProps = {
  factory: string;
  factoryName: string;
  suite: SuiteModel;
  tasks: TaskModel[];
  agentType?: string;
  results: Result[];
  resources: { models: string[]; routers: string[]; harnesses: string[]; runners: string[]; scorers: string[] };
};

export function SuiteView({ factory, factoryName, suite, tasks, agentType, results, resources }: SuiteViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"tasks" | "results" | "runs">(results.length ? "results" : "tasks");
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskModel | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "suite" } | { kind: "task"; slug: string } | null>(null);
  const [pending, start] = useTransition();
  const taskTitle = (slug: string) => tasks.find((t) => t.slug === slug)?.title ?? slug;

  const run = (s: Parameters<typeof startBenchmark>[2]) =>
    start(async () => {
      const r = await startBenchmark(factory, suite.slug, s);
      if (!r.ok) return void toast.error(r.error);
      if (r.pullRequest) toast.success("Configurations changed: merge the pull request, then run again");
      else toast.success(r.trials ? `Benchmark finished: ${r.trials} trials` : "Benchmark started");
      setRunning(false);
      setTab("results");
      router.refresh();
    });

  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Benchmarks", href: `/f/${factory}/benchmarks` }, { label: suite.name }]}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
                <EllipsisVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  disabled={!results.length || pending}
                  onClick={() =>
                    start(async () => {
                      const r = await suggestRouting(factory, suite.slug);
                      if (!r.ok) return void toast.error(r.error);
                      toast.success(r.rules.length ? `Suggested ${r.rules.length} routing rule(s)` : "No routing rules to suggest", r.prUrl ? { action: { label: "Open PR", onClick: () => window.open(r.prUrl, "_blank", "noopener") } } : undefined);
                    })
                  }
                >
                  <Route /> Suggest routing
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: "suite" })}>
                  <Trash2 /> Delete benchmark
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setRunning(true)} disabled={!tasks.length}>
              <Play /> Run benchmark
            </Button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{suite.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <AgentTypeIcon size="sm" type={agentType ?? "CUSTOM"} className="size-3.5" /> {suite.agent} • {tasks.length} task{tasks.length === 1 ? "" : "s"} • {suite.configurations.length} configuration{suite.configurations.length === 1 ? "" : "s"}
        </p>
        {suite.description && <p className="mt-2 text-sm text-muted-foreground">{suite.description}</p>}
        <div className="mt-6 mb-6">
          <PillTabs
            tabs={[
              { id: "tasks", label: "Tasks" },
              { id: "results", label: "Results" },
              { id: "runs", label: "Runs" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {tab === "tasks" && (
          <div className="rounded-xl border">
            <ul className="divide-y">
              {tasks.map((t) => (
                <li key={t.slug} className="group flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t.successCriteria.length} correctness criteri{t.successCriteria.length === 1 ? "on" : "a"} • {t.startingRepoRefs.map((r) => r.replace(/@([0-9a-f]{7})[0-9a-f]+$/, "@$1")).join(", ") || "no pinned repository"}
                      {t.sourceRunId && (
                        <>
                          {" "}
                          • from{" "}
                          <Link href={`/runs/${t.sourceRunId}`} className="underline">
                            {t.sourceRunId.slice(0, 14)}
                          </Link>
                        </>
                      )}
                      {t.tags?.length ? ` • ${t.tags.join(", ")}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t.title}`} onClick={() => setConfirm({ kind: "task", slug: t.slug })}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <div className={cn("px-2 py-1", tasks.length > 0 && "border-t")}>
              <Button variant="ghost" onClick={() => setAdding(true)}>
                <Plus /> Add task
              </Button>
            </div>
          </div>
        )}
        {tab === "results" && <Results results={results} tasks={tasks.length} taskTitle={taskTitle} />}
        {tab === "runs" && (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-normal">Task</th>
                  <th className="px-4 py-3 font-normal">Configuration</th>
                  <th className="px-4 py-3 font-normal">Result</th>
                  <th className="px-4 py-3 font-normal">Run time</th>
                  <th className="px-4 py-3 text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...results]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((r) => (
                    <tr key={r.runId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link href={`/runs/${r.runId}`} className="hover:underline">
                          {taskTitle(r.task)}
                        </Link>
                        <div className="text-xs text-muted-foreground">{timeAgo(r.at)}</div>
                      </td>
                      <td className="px-4 py-3">{r.configuration}</td>
                      <td className={cn("px-4 py-3", r.success ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>{r.success ? "Correct" : "Incorrect"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{duration(r.at, new Date(new Date(r.at).getTime() + r.durationMs).toISOString())}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{usd(r.costUsd)}</td>
                    </tr>
                  ))}
                {!results.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No runs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {running && (
        <RunDialog
          open
          onClose={() => setRunning(false)}
          onRun={run}
          pending={pending}
          agent={suite.agent}
          configurations={suite.configurations}
          tasks={tasks.length}
          models={resources.models}
          routers={resources.routers}
          harnesses={resources.harnesses}
          runners={resources.runners}
          scorers={resources.scorers}
        />
      )}
      <AddTaskDialog
        factory={factory}
        agent={suite.agent}
        open={adding}
        pending={pending}
        onClose={() => setAdding(false)}
        onAdd={(t) =>
          start(async () => {
            if (toastResult(await addTasks(factory, suite.slug, [t]), "Task added")) setAdding(false);
            router.refresh();
          })
        }
      />
      {editing && <EditTaskDialog task={editing} pending={pending} onClose={() => setEditing(null)} onSave={(t) => start(async () => (toastResult(await updateTask(factory, suite.slug, t), "Task saved") && setEditing(null), router.refresh()))} />}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "suite" ? `Delete ${suite.name}?` : `Remove ${confirm?.kind === "task" ? taskTitle(confirm.slug) : ""}?`}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.kind === "suite" ? "This removes the benchmark and its tasks from the factory definition. Past results stay in the history." : "The task file is deleted from the benchmark."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const c = confirm!;
                setConfirm(null);
                start(async () => {
                  if (c.kind === "suite") {
                    if (toastResult(await deleteBenchmark(factory, suite.slug), "Benchmark deleted")) router.push(`/f/${factory}/benchmarks`);
                  } else {
                    toastResult(await removeTask(factory, suite.slug, c.slug), "Task removed");
                    router.refresh();
                  }
                });
              }}
            >
              {confirm?.kind === "suite" ? "Delete" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditTaskDialog({ task, onClose, onSave, pending }: { task: TaskModel; onClose: () => void; onSave: (t: TaskModel) => void; pending: boolean }) {
  const [draft, setDraft] = useState<Omit<TaskModel, "slug" | "extra">>({ title: task.title, prompt: task.prompt, successCriteria: task.successCriteria.length ? task.successCriteria : [""], startingRepoRefs: task.startingRepoRefs, tags: task.tags ?? [], sourceRunId: task.sourceRunId });
  const problem = draftProblem(draft);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[672px]">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <ScratchTaskForm draft={draft} onChange={(d) => setDraft({ ...d, sourceRunId: draft.sourceRunId })} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Boolean(problem) || pending} title={problem ?? undefined} onClick={() => onSave({ ...task, ...clean(draft), sourceRunId: draft.sourceRunId })}>
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
