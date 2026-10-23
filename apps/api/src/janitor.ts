import { statfsSync } from "node:fs";
import { DiskSpaceLow, type JanitorRun } from "@kiln/sandbox";
import type { Kiln } from "@kiln/engine";

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

const SETTINGS = "server_settings";
type CleanupSettings = { id: "cleanup"; scheduled: boolean; lastRun?: JanitorRun & { by: string } };

/** Whether the hourly clean-up is on, and the last clean-up. Off until an admin has seen the plan and turned it on. */
export function cleanupSettings(kiln: Kiln): CleanupSettings {
  return kiln.store.get<CleanupSettings>(SETTINGS, "cleanup") ?? { id: "cleanup", scheduled: false };
}

export function setCleanupScheduled(kiln: Kiln, scheduled: boolean, by: string): CleanupSettings {
  kiln.audit(by, scheduled ? "server.cleanup_scheduled" : "server.cleanup_unscheduled", "docker");
  return kiln.store.put(SETTINGS, { ...cleanupSettings(kiln), scheduled });
}

let running: Promise<JanitorRun> | undefined;

/** Run the janitor once (concurrent calls share the run), record it and audit what it removed. */
export async function runCleanup(kiln: Kiln, by: string): Promise<JanitorRun> {
  const janitor = kiln.options.janitor;
  if (!janitor) throw new Error("clean-up needs Docker sandboxes (KILN_SANDBOX=docker)");
  running ??= janitor.run().finally(() => (running = undefined));
  const run = await running;
  kiln.store.put(SETTINGS, { ...cleanupSettings(kiln), lastRun: { ...run, by } });
  kiln.audit(by, "server.cleanup", "docker", { removed: run.removed, failed: run.failed, reclaimedBytes: run.reclaimedBytes });
  return run;
}

export type DiskThreshold = { minFreeBytes: number; minFreeRatio: number };

/** KILN_DISK_MIN_FREE_GB (default 20) and KILN_DISK_MIN_FREE_PCT (default 15); 0 turns either off. */
export function diskThreshold(env: Record<string, string | undefined> = process.env): DiskThreshold {
  return { minFreeBytes: Number(env.KILN_DISK_MIN_FREE_GB ?? 20) * 1e9, minFreeRatio: Number(env.KILN_DISK_MIN_FREE_PCT ?? 15) / 100 };
}

const low = (d: DiskUsage | undefined, t: DiskThreshold) => Boolean(d && (d.freeBytes < t.minFreeBytes || d.freeBytes < d.totalBytes * t.minFreeRatio));

/**
 * Before a Docker sandbox starts: when the disk Kiln's data (and Docker) lives on is low, clean up
 * once, and refuse with a clear error if it is still low, instead of failing halfway through a write.
 */
export function diskGuard(getKiln: () => Kiln, path: string, threshold = diskThreshold(), usage = diskUsage) {
  return async () => {
    if (!low(usage(path), threshold)) return;
    await runCleanup(getKiln(), "kiln").catch(() => undefined);
    const after = usage(path);
    if (after && low(after, threshold)) throw new DiskSpaceLow(after.freeBytes, Math.max(threshold.minFreeBytes, after.totalBytes * threshold.minFreeRatio));
  };
}
