"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { PageHeader } from "@/components/kiln/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { pct, timeAgo, usd } from "@/lib/format";

export type SuiteCard = { slug: string; name: string; description?: string; agent: string; agentType?: string; tasks: number; configurations: number; lastRun?: string; best?: { configuration: string; successRate: number; avgCostUsd: number } };

export function BenchmarkList({ factory, factoryName, suites }: { factory: string; factoryName: string; suites: SuiteCard[] }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const types = [...new Set(suites.map((s) => s.agentType).filter((t): t is string => Boolean(t)))];
  const shown = suites.filter((s) => (!type || s.agentType === type) && (!q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const label = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace("_", " ");
  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Benchmarks" }]}
        actions={
          <>
            {searching ? (
              <input autoFocus aria-label="Search benchmarks" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} placeholder="Search benchmarks…" className="h-8 w-56 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
            ) : (
              <Button variant="outline" size="icon" aria-label="Search benchmarks" onClick={() => setSearching(true)}>
                <Search />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" aria-label={`Filter by agent type: ${type ? label(type) : "All agent types"}`} />}>
                {type ? label(type) : "All agent types"} <ChevronDown className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setType(null)}>All agent types</DropdownMenuItem>
                {types.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => setType(t)}>
                    <AgentTypeIcon type={t} /> {label(t)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href={`/f/${factory}/benchmarks/new`} className={buttonVariants()}>
              New
            </Link>
          </>
        }
      />
      <div className="px-4 py-6 sm:px-6">
        {suites.length === 0 ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl bg-muted/60 px-6 text-center">
            <p className="font-medium">You haven’t created any benchmarks yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Benchmarks allow you to evaluate agent performance across different model configs.</p>
            <Link href={`/f/${factory}/benchmarks/new`} className={buttonVariants({ className: "mt-4" })}>
              New benchmark
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {shown.map((s) => (
              <Link key={s.slug} href={`/f/${factory}/benchmarks/${encodeURIComponent(s.slug)}`} className="flex items-center gap-6 rounded-xl border px-5 py-5 transition-colors hover:bg-muted/30">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                    <AgentTypeIcon type={s.agentType} className="size-3.5" /> {s.agent} • {s.tasks} task{s.tasks === 1 ? "" : "s"} • {s.configurations} configuration{s.configurations === 1 ? "" : "s"}
                    {s.description && <span className="truncate">• {s.description}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  {s.best ? (
                    <>
                      <div className="font-medium">
                        {s.best.configuration}: {pct(s.best.successRate)} at {usd(s.best.avgCostUsd)}
                      </div>
                      <div className="text-xs text-muted-foreground">last run {timeAgo(s.lastRun)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not run yet</span>
                  )}
                </div>
              </Link>
            ))}
            {!shown.length && <p className="py-10 text-center text-sm text-muted-foreground">No benchmarks match.</p>}
          </div>
        )}
      </div>
    </>
  );
}
