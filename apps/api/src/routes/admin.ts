import { statfsSync } from "node:fs";
import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os";
import { resolve } from "node:path";
import type { SandboxListing } from "@kiln/sandbox";
import { HttpError, type RouteContext } from "../app";

export type DiskUsage = { path: string; totalBytes: number; freeBytes: number };

/** Size and free space of the filesystem holding `path`; undefined when it cannot be read. */
export function diskUsage(path: string): DiskUsage | undefined {
  try {
    const s = statfsSync(path);
    return { path, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return undefined;
  }
}

/** Server admins only: the host's memory, disk and load, and every sandbox it runs. */
export function adminRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/admin/server", async (c) => {
    if (!ctx.access(c).serverAdmin) throw new HttpError(403, "server admins only (KILN_ADMIN_EMAILS)");
    const dataDir = resolve(process.env.KILN_DATA_DIR ?? ".data");
    const sandboxes: SandboxListing[] = [];
    const sandboxErrors: { provider: string; error: string }[] = [];
    for (const p of Object.values(kiln.sandboxes)) {
      if (!p?.list) continue;
      try {
        sandboxes.push(...(await p.list()));
      } catch (err) {
        sandboxErrors.push({ provider: p.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const runs = kiln.runs.list();
    const mem = process.memoryUsage();
    return c.json({
      at: kiln.clock.now(),
      host: {
        hostname: hostname(),
        cpus: cpus().length,
        loadAverage: loadavg(),
        uptimeSeconds: Math.round(uptime()),
        totalMemoryBytes: totalmem(),
        freeMemoryBytes: freemem(),
      },
      disks: [diskUsage(dataDir), diskUsage("/")]
        .filter((d): d is DiskUsage => Boolean(d))
        .filter((d, i, all) => all.findIndex((o) => o.totalBytes === d.totalBytes && o.freeBytes === d.freeBytes) === i),
      process: { uptimeSeconds: Math.round(process.uptime()), rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, node: process.version },
      sandboxes,
      sandboxErrors,
      runs: { running: runs.filter((r) => r.status === "running").length, queued: runs.filter((r) => r.status === "queued").length },
      workers: kiln.workers
        .connected()
        .map((w) => ({ id: w.id, workerId: w.workerId, backend: w.backend, active: w.active.length, maxConcurrent: w.maxConcurrent, stale: w.stale })),
    });
  });
}
