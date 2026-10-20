"use server";

import { revalidatePath } from "next/cache";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";
import { setTeam } from "@/lib/web-session";

export async function acceptInvite(token: string): Promise<ActionResult> {
  const r = await attempt(() => api.acceptInvite(token));
  if (!r.ok) return r;
  await setTeam(r.data!.team.id);
  revalidatePath("/", "layout");
  return { ok: true, message: `You joined ${r.data!.team.name}` };
}
