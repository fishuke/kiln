import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os";
import { resolve } from "node:path";
import type { SandboxListing } from "@kiln/sandbox";
import { z } from "zod";
import { HttpError, type RouteContext } from "../app";
import { cleanupSettings, diskUsage, runCleanup, setCleanupScheduled, type DiskUsage } from "../janitor";

/** Server admins only: the host's memory, disk and load, and every sandbox it runs. */
export function adminRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  const admin = (c: Parameters<RouteContext["access"]>[0]) => {
    if (!ctx.access(c).serverAdmin) throw new HttpError(403, "server admins only (KILN_ADMIN_EMAILS)");
  };

  app.get("/api/v1/admin/server", async (c) => {
    admin(c);
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

  // Docker clean-up: GET is the dry run (read-only), POST removes what it lists.
  app.get("/api/v1/admin/cleanup", async (c) => {
    admin(c);
    const janitor = kiln.options.janitor;
    const settings = cleanupSettings(kiln);
    if (!janitor) return c.json({ available: false, scheduled: false });
    const [usage, plan] = await Promise.allSettled([janitor.diskUsage(), janitor.plan()]);
    const error = [usage, plan].flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []));
    return c.json({
      available: true,
      scheduled: settings.scheduled,
      lastRun: settings.lastRun,
      usage: usage.status === "fulfilled" ? usage.value : [],
      ...(plan.status === "fulfilled" ? { plan: plan.value } : {}),
      ...(error.length ? { error: error.join("; ") } : {}),
    });
  });
  app.post("/api/v1/admin/cleanup", async (c) => {
    admin(c);
    if (!kiln.options.janitor) throw new HttpError(400, "clean-up needs Docker sandboxes (KILN_SANDBOX=docker)");
    return c.json(await runCleanup(kiln, ctx.who(c)));
  });
  app.put("/api/v1/admin/cleanup/schedule", async (c) => {
    admin(c);
    const { scheduled } = z.object({ scheduled: z.boolean() }).parse(await c.req.json());
    return c.json(setCleanupScheduled(kiln, scheduled, ctx.who(c)));
  });
}
