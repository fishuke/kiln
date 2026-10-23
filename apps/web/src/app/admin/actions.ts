"use server";

import { revalidatePath } from "next/cache";
import { bytes } from "@/lib/format";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

export async function runCleanup(): Promise<ActionResult> {
  const r = await attempt(() => api.runCleanup());
  revalidatePath("/admin", "layout");
  if (!r.ok) return r;
  const run = r.data!;
  const removed = `Removed ${run.removed.containers.length} container(s) and ${run.removed.images.length} image(s), reclaimed ${bytes(run.reclaimedBytes)}`;
  return { ok: true, message: run.failed.length ? `${removed}; ${run.failed.length} could not be removed` : removed };
}

export async function setCleanupScheduled(scheduled: boolean): Promise<ActionResult> {
  const r = await attempt(() => api.setCleanupScheduled(scheduled), scheduled ? "Hourly clean-up on" : "Hourly clean-up off");
  revalidatePath("/admin/cleanup");
  return r.ok ? { ok: true, message: r.message } : r;
}
