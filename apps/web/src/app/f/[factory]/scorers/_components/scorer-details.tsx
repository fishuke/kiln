"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/kiln/markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeAgo, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rescoreRun } from "../actions";

export type ScoreRow = { id: string; runId: string; runHref: string; agent: string; label: string; score: number; passed: boolean; rationale?: string; createdAt: string; costUsd?: number };

const DAY = 86_400_000;

/** Last-30-days series: daily pass rate (null on days without scores) and daily judge cost. */
export function dailySeries(rows: ScoreRow[], now = Date.now()) {
  const start = new Date(now - 29 * DAY);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 30 }, (_, i) => ({ t: start.getTime() + i * DAY, n: 0, pass: 0, cost: 0 }));
  for (const r of rows) {
    const i = Math.floor((new Date(r.createdAt).getTime() - start.getTime()) / DAY);
    if (i < 0 || i >= 30) continue;
    days[i]!.n++;
    if (r.passed) days[i]!.pass++;
    days[i]!.cost += r.costUsd ?? 0;
  }
  return days.map((d) => ({ t: d.t, n: d.n, passRate: d.n ? d.pass / d.n : null, cost: d.cost }));
}

function TrendChart({ rows, mode }: { rows: ScoreRow[]; mode: "pass" | "cost" }) {
  const data = useMemo(() => dailySeries(rows), [rows]);
  const W = 640;
  const H = 180;
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const has = data.some((d) => d.n > 0);
  if (!has) return <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">No scores in this range</div>;
  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);
  const x = (i: number) => pad.l + (i / 29) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const points = data.map((d, i) => (d.passRate === null ? null : `${x(i)},${y(d.passRate)}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={mode === "pass" ? "Pass rate per day" : "Judge cost per day"}>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray="3 3" />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {mode === "pass" ? `${v * 100}%` : usd(v * maxCost)}
          </text>
        </g>
      ))}
      {[0, 14, 29].map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === 29 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
          {fmt(data[i]!.t)}
        </text>
      ))}
      {mode === "pass" ? (
        <>
          <polyline points={points.join(" ")} className="fill-none stroke-violet-600 dark:stroke-violet-400" strokeWidth={2} />
          {data.map((d, i) =>
            d.passRate === null ? null : (
              <circle key={i} cx={x(i)} cy={y(d.passRate)} r={3} className="fill-violet-600 dark:fill-violet-400">
                <title>{`${fmt(d.t)}: ${Math.round(d.passRate * 100)}% of ${d.n}`}</title>
              </circle>
            ),
          )}
        </>
      ) : (
        data.map((d, i) => (
          <rect key={i} x={x(i) - 6} width={12} y={y(d.cost / maxCost)} height={Math.max(0, H - pad.b - y(d.cost / maxCost))} rx={2} className="fill-violet-600/80 dark:fill-violet-400/80">
            <title>{`${fmt(d.t)}: ${usd(d.cost)}`}</title>
          </rect>
        ))
      )}
    </svg>
  );
}

export function ScorerDetails({ factory, scorer, rows, agents, passingScore }: { factory: string; scorer: string; rows: ScoreRow[]; agents: string[]; passingScore: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"pass" | "cost">("pass");
  const [agent, setAgent] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const filtered = agent ? rows.filter((r) => r.agent === agent) : rows;
  const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const recent = filtered.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 30 * DAY);
  const rate = recent.length ? recent.filter((r) => r.passed).length / recent.length : null;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border p-5">
        <div className="text-xs text-muted-foreground">All-time scorer cost</div>
        <div className="mt-1 text-2xl font-semibold">{usd(total)}</div>
        <div className="my-4 border-t" />
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Scorer trend · last 30 days{rate !== null && mode === "pass" && <span className="ml-2 text-foreground">{Math.round(rate * 100)}% pass rate</span>}
          </div>
          <div className="flex gap-1 text-sm">
            {(
              [
                ["pass", "Pass rate"],
                ["cost", "Daily cost"],
              ] as const
            ).map(([m, l]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("border-b-2 px-2 pb-1", mode === m ? "border-violet-600 font-medium dark:border-violet-400" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <TrendChart rows={filtered} mode={mode} />
        <div className="mt-2 flex flex-wrap gap-2">
          {agents.map((a) => (
            <button key={a} type="button" aria-pressed={agent === a} onClick={() => setAgent(agent === a ? null : a)} className={cn("rounded-md border px-2 py-0.5 text-xs", agent === a ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border">
        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-muted-foreground">No scoring runs yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-normal">Run</th>
                <th className="px-4 py-3 font-normal">Classification</th>
                <th className="px-4 py-3 font-normal">Score</th>
                <th className="px-4 py-3 font-normal">Reason</th>
                <th className="px-4 py-3 text-right font-normal">Scored</th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link href={r.runHref} className="font-mono text-xs hover:underline">
                      {r.runId.slice(0, 14)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.agent}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.score >= passingScore ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400")}>{r.label}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.score.toFixed(2)}</td>
                  <td className="max-w-80 px-4 py-3">
                    {r.rationale ? (
                      <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="text-left">
                        {open === r.id ? <Markdown className="text-sm">{r.rationale}</Markdown> : <span className="line-clamp-2 text-muted-foreground">{r.rationale}</span>}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-muted-foreground">{timeAgo(r.createdAt)}</td>
                  <td className="px-2 py-3">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Re-score run"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await rescoreRun(factory, scorer, r.runId);
                                if (res.ok) toast.success("Re-scoring started; the new result replaces this one");
                                else toast.error(res.error);
                                router.refresh();
                              })
                            }
                          />
                        }
                      >
                        <RotateCw />
                      </TooltipTrigger>
                      <TooltipContent>Re-score</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
