"use server";

import { revalidatePath } from "next/cache";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

export async function publish(factory: string, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.publishSkill(factory, name), `Published ${name} to the catalog`);
  if (r.ok) revalidatePath("/skills");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function install(listingId: string, factory: string): Promise<ActionResult> {
  const r = await attempt(() => api.installSkill(listingId, factory));
  if (!r.ok) return r;
  revalidatePath("/skills");
  return { ok: true, message: r.data?.prUrl ? `Opened ${r.data.prUrl}` : "Installed" };
}
