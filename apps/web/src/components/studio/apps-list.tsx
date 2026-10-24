"use client";

import Link from "next/link";
import { GitBranch, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { Empty, Page, PageHeader } from "@/components/kiln/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { relativeTime } from "@/lib/run-tree";
import { shipModeCopy } from "@/lib/studio/model";
import type { StatusReport, StudioApp } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { NewAppDialog } from "./new-app";
import { AppAvatar } from "./top-bar";
import { useStudioClient } from "./use-client";

const SHIP_TONE = {
  safe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  review: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  cowboy: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
} as const;

/** /studio: the apps, in a table like the Projects page, with New app. */
export function AppsList({ startNew }: { startNew: boolean }) {
  const client = useStudioClient();
  const [apps, setApps] = useState<StudioApp[]>();
  const [status, setStatus] = useState<StatusReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!client) return;
    const load = () => {
      client.apps().then(setApps, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      client.status().then(setStatus, () => undefined);
    };
    load();
    const off = client.subscribe?.(load);
    const t = setInterval(load, 8000);
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [client]);

  const byId = new Map(status?.apps.map((p) => [p.id, p]));
  return (
    <>
      <PageHeader crumbs={[{ label: "Studio" }]} actions={client && !(error && !apps) && <NewAppDialog client={client} defaultOpen={startNew} />} />
      <Page>
        {error && !apps ? (
          <Empty title="Studio isn't available">{error}</Empty>
        ) : !apps ? (
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : apps.length === 0 ? (
          <Empty title="No apps yet">Start from a template or import a repository.</Empty>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Ship mode</TableHead>
                  <TableHead className="text-right">Running</TableHead>
                  <TableHead className="text-right">Needs you</TableHead>
                  <TableHead>Pull request</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((a) => {
                  const s = byId.get(a.id);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link href={`/studio/${a.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                          <AppAvatar name={a.name} className="size-6" />
                          {a.name}
                        </Link>
                        {s?.latest && <div className="mt-0.5 ml-8.5 truncate text-xs text-muted-foreground">{s.latest.title}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.source.kind === "repo" ? (
                          <span className="flex items-center gap-1.5">
                            <GitHubIcon className="size-3.5" />
                            {a.source.repo}
                            {a.source.branch && (
                              <span className="flex items-center gap-0.5 text-xs">
                                <GitBranch className="size-3" />
                                {a.source.branch}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <LayoutTemplate className="size-3.5" />
                            Next.js template
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span title={shipModeCopy(a.shipMode).line} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", SHIP_TONE[a.shipMode])}>
                          {shipModeCopy(a.shipMode).label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s?.working.length || <span className="text-muted-foreground">0</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s?.needsYou.length ? (
                          <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{s.needsYou.length}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-muted-foreground" suppressHydrationWarning>
                        {a.status === "creating" ? <span className="shimmer">Setting up</span> : relativeTime(a.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Page>
    </>
  );
}
