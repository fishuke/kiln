import type { Metadata } from "next";
import Link from "next/link";
import { KilnApiError } from "@kiln/sdk-ts";
import { Server } from "lucide-react";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { EmptyIcon } from "@/components/kiln/settings-blocks";
import { ApiDown, Empty, Page, PageHeader, Section, Stat } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bytes, duration, timeAgo } from "@/lib/format";
import { api, errorMessage } from "@/lib/kiln";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Server" };

function Meter({ used, total }: { used: number; total: number }) {
  const share = total ? used / total : 0;
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", share > 0.9 ? "bg-red-500" : share > 0.75 ? "bg-amber-500" : "bg-emerald-500")}
        style={{ width: `${Math.min(100, share * 100)}%` }}
      />
    </div>
  );
}

/** Server admins only: memory, disk, load and every sandbox on this host. Refreshes every 5 seconds. */
export default async function Admin() {
  let stats;
  try {
    stats = await api.serverStats();
  } catch (err) {
    if (err instanceof KilnApiError && err.status === 403)
      return (
        <Page narrow>
          <Empty title="Server admins only">Add your email to KILN_ADMIN_EMAILS on the server to see this page.</Empty>
        </Page>
      );
    return <ApiDown error={errorMessage(err)} />;
  }
  const { host, disks, process, sandboxes, sandboxErrors, runs, workers } = stats;
  const usedMem = host.totalMemoryBytes - host.freeMemoryBytes;
  const running = sandboxes.filter((s) => s.state === "running");
  const sandboxMem = running.reduce((n, s) => n + (s.memoryBytes ?? 0), 0);
  const now = Date.now();
  return (
    <>
      <AutoRefresh ms={5000} />
      <PageHeader
        crumbs={[{ label: "Server" }]}
        actions={
          <Link href="/admin/cleanup" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            Clean up disk
          </Link>
        }
      />
      <Page>
        <Section
          title={host.hostname}
          description={`${host.cpus} CPUs, up ${duration(host.uptimeSeconds)}. Kiln API up ${duration(process.uptimeSeconds)} on Node ${process.node}.`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Memory" value={`${bytes(usedMem)} / ${bytes(host.totalMemoryBytes)}`} hint={<Meter used={usedMem} total={host.totalMemoryBytes} />} />
            {disks.map((d, i) => (
              <Stat
                key={d.path}
                label={i === 0 ? "Disk (Kiln data)" : `Disk ${d.path}`}
                value={`${bytes(d.totalBytes - d.freeBytes)} / ${bytes(d.totalBytes)}`}
                hint={
                  <>
                    <Meter used={d.totalBytes - d.freeBytes} total={d.totalBytes} />
                    <div className="mt-1 truncate" title={d.path}>
                      {bytes(d.freeBytes)} free · {d.path}
                    </div>
                  </>
                }
              />
            ))}
            <Stat label="Load (1, 5, 15 min)" value={host.loadAverage.map((l) => l.toFixed(2)).join("  ")} hint={`${host.cpus} CPUs`} />
            <Stat
              label="Sandboxes running"
              value={running.length}
              hint={`${bytes(sandboxMem)} memory · ${sandboxes.length - running.length} stopped or left behind`}
            />
            <Stat label="Runs" value={runs.running} hint={`${runs.queued} queued`} />
            <Stat label="Kiln API memory" value={bytes(process.rssBytes)} hint={`${bytes(process.heapUsedBytes)} heap`} />
          </div>
        </Section>

        <Section title="Sandboxes" description="Every sandbox container or work directory on this host.">
          {sandboxErrors.map((e) => (
            <p key={e.provider} className="mb-2 text-sm text-red-600">
              {e.provider}: {e.error}
            </p>
          ))}
          {sandboxes.length === 0 ? (
            <EmptyIcon icon={<Server className="size-4" />} title="No sandboxes">
              Runs and Studio apps start one when they need it.
            </EmptyIcon>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">CPU</TableHead>
                    <TableHead className="pr-4 text-right">Memory</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sandboxes.map((s) => (
                    <TableRow key={`${s.provider}:${s.name}`}>
                      <TableCell className="pl-4 font-mono text-xs">
                        {s.name}
                        {s.studioApp && <span className="ml-2 text-muted-foreground">Studio app</span>}
                      </TableCell>
                      <TableCell className={cn(s.state === "running" ? "text-emerald-600" : "text-muted-foreground")}>
                        {s.state}
                        {!s.live && s.state === "running" && s.owner === "kiln" && <span className="ml-1 text-xs text-muted-foreground">(not tracked)</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.owner ?? s.provider}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{timeAgo(s.createdAt, now)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.cpuPercent === undefined ? "" : `${s.cpuPercent.toFixed(1)}%`}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{s.memoryBytes === undefined ? "" : bytes(s.memoryBytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        {workers.length > 0 && (
          <Section title="Workers" description="Remote workers connected to this server.">
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableBody>
                  {workers.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="pl-4 font-mono text-xs">{w.workerId}</TableCell>
                      <TableCell>{w.backend}</TableCell>
                      <TableCell className="tabular-nums">
                        {w.active} / {w.maxConcurrent} busy
                      </TableCell>
                      <TableCell className={cn("pr-4", w.stale ? "text-amber-600" : "text-emerald-600")}>{w.stale ? "no heartbeat" : "online"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        )}
      </Page>
    </>
  );
}
