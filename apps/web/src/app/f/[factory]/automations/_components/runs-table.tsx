"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckCircle2, CircleDashed, ListFilter, Loader2, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RunRow = { id: string; href: string; startedAt: string; finishedAt?: string; status: string; costUsd: number; title?: string };

const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  succeeded: { label: "Successful", icon: CheckCircle2, tone: "text-muted-foreground" },
  failed: { label: "Failed", icon: XCircle, tone: "text-red-600" },
  cancelled: { label: "Cancelled", icon: CircleDashed, tone: "text-muted-foreground" },
  running: { label: "Running", icon: Loader2, tone: "text-blue-600" },
  paused: { label: "Paused", icon: CircleDashed, tone: "text-amber-600" },
};

export function duration(start: string, end?: string): string {
  if (!end) return "—";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}min`;
  return m ? `${m}min ${s % 60}s` : `${s}s`;
}

function ranOn(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "long", day: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Runs started by one automation (or scorer): Ran on, Status, Run time, Cost. */
export function RunsTable({ rows, empty = "No runs yet" }: { rows: RunRow[]; empty?: string }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [desc, setDesc] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      rows
        .filter((r) => (!status || r.status === status) && (!q || `${r.title ?? ""} ${r.id}`.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => (desc ? b.startedAt.localeCompare(a.startedAt) : a.startedAt.localeCompare(b.startedAt))),
    [rows, q, status, desc],
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        {searching && <input autoFocus aria-label="Search runs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs…" className="h-8 w-56 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}
        <Button variant="ghost" size="icon-sm" aria-label="Search" onClick={() => setSearching((s) => !s)}>
          <Search />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={desc ? "Sort oldest first" : "Sort newest first"} onClick={() => setDesc((d) => !d)}>
          {desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Filter" className={cn(status && "bg-muted")} />}>
            <ListFilter />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setStatus(null)}>All statuses</DropdownMenuItem>
            {Object.entries(STATUS).map(([k, v]) => (
              <DropdownMenuItem key={k} onClick={() => setStatus(k)}>
                {v.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-normal">Ran on</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Run time</th>
              <th className="px-4 py-3 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, icon: CircleDashed, tone: "text-muted-foreground" };
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={r.href} className="hover:underline">
                      {ranOn(r.startedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <s.icon className={cn("size-4", s.tone, r.status === "running" && "animate-spin")} /> {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{duration(r.startedAt, r.finishedAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{usd(r.costUsd)}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  {rows.length ? "No runs match" : empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
