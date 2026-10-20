"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/kiln";
import { failure, type ActionResult } from "@/lib/write-result";

export async function runImprovementNow(factory: string): Promise<ActionResult<{ proposals: number }>> {
  try {
    const r = await api.runSelfImprovement(factory);
    revalidatePath(`/f/${factory}`, "layout");
    return { ok: true, proposals: r.length };
  } catch (e) {
    return failure(e);
  }
}

export async function decideProposal(factory: string, id: string, decision: "approve" | "reject", reason?: string): Promise<ActionResult> {
  try {
    if (decision === "approve") await api.approveProposal(id);
    else await api.rejectProposal(id, reason || undefined);
    revalidatePath(`/f/${factory}`, "layout");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
