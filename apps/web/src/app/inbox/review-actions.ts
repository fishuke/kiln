"use server";

import type { ReviewSubmission, TaskReview } from "@kiln/sdk-ts";
import { revalidatePath } from "next/cache";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

/** Reviewing and merging in Kiln, as the signed-in person's linked GitHub account (ADR-010). */
export async function loadReview(taskId: string): Promise<ActionResult<TaskReview>> {
  return attempt(() => api.taskReview(taskId));
}

export async function submitReview(taskId: string, input: ReviewSubmission): Promise<ActionResult> {
  const r = await attempt(() => api.submitReview(taskId, input));
  if (r.ok) revalidatePath("/", "layout");
  return r.ok ? { ok: true } : r;
}

export async function mergeTask(taskId: string): Promise<ActionResult> {
  const r = await attempt(() => api.mergeTask(taskId));
  if (r.ok) revalidatePath("/", "layout");
  return r.ok ? { ok: true } : r;
}

/** Where to send the person to link GitHub; the callback brings them back to Integrations. */
export async function startGitHubLink(): Promise<ActionResult<{ url: string }>> {
  return attempt(() => api.linkGitHubAccount());
}
