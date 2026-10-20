"use server";

import { revalidatePath } from "next/cache";
import type { Attachment, SpecRetryOptions } from "@kiln/sdk-ts";
import { api } from "@/lib/kiln";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function withAttachmentLinks(body: string, attachments: Attachment[]): string {
  if (!attachments.length) return body;
  const links = attachments.map((a) => `- [${a.name}](/files/${a.key})`).join("\n");
  return `${body}${body ? "\n\n" : ""}Attachments:\n${links}`;
}

/** New Chat: creates the work item (the root foreman run) and returns its id. */
export async function startRun(input: { factory: string; text: string; attachments: Attachment[] }): Promise<ActionResult<{ id: string }>> {
  const text = input.text.trim();
  if (!text || !input.factory) return { ok: false, error: "Write what you'd like to build first" };
  const [first, ...rest] = text.split("\n");
  const title = first!.trim().slice(0, 200) || "New run";
  const body = rest.join("\n").trim();
  try {
    const wi = await api.send({ factory: input.factory, title, body, attachments: input.attachments, via: "kiln" });
    // A server that drops attachments still gets them as links in the conversation.
    if (input.attachments.length && !wi.attachments?.length) await api.message(wi.id, withAttachmentLinks("", input.attachments)).catch(() => undefined);
    revalidatePath("/runs");
    return { ok: true, id: wi.id };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Follow-up from the run composer. Root foreman runs (work items) get a message; agent runs use
 * POST /runs/:id/followups and fall back to steering the live run (attachments become links).
 */
export async function sendFollowup(input: { id: string; isWorkItem: boolean; text: string; attachments: Attachment[] }): Promise<ActionResult> {
  const text = input.text.trim();
  if (!text && !input.attachments.length) return { ok: false, error: "Write a message first" };
  // The API needs message text; files sent alone get a short one.
  const message = text || "Attached files";
  try {
    if (input.isWorkItem) {
      await api.message(input.id, message, input.attachments);
    } else {
      try {
        await api.followup(input.id, message, { attachments: input.attachments });
      } catch {
        await api.steer(input.id, withAttachmentLinks(text, input.attachments));
      }
    }
    revalidatePath(`/runs/${input.id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function stopRun(input: { id: string; isWorkItem: boolean }): Promise<ActionResult> {
  try {
    if (input.isWorkItem) await api.cancel(input.id);
    else await api.cancelRun(input.id);
    revalidatePath("/runs", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function pauseRun(id: string): Promise<ActionResult> {
  try {
    await api.pauseRun(id);
    revalidatePath(`/runs/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function resumeRun(id: string): Promise<ActionResult> {
  try {
    await api.resumeRun(id);
    revalidatePath(`/runs/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function replayRun(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const r = await api.replay(id);
    revalidatePath("/runs");
    return { ok: true, id: r.id };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function saveAsBenchmark(input: { id: string; suite: string; slug: string; title?: string; criteria?: string }): Promise<ActionResult<{ files: string[] }>> {
  try {
    const successCriteria = input.criteria
      ?.split("\n")
      .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);
    const r = await api.saveBenchmark(input.id, { suite: input.suite, slug: input.slug, title: input.title || undefined, successCriteria: successCriteria?.length ? successCriteria : undefined });
    return { ok: true, files: Object.keys(r.files) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function scoreThisRun(id: string): Promise<ActionResult> {
  try {
    await api.scoreRunNow(id);
    revalidatePath(`/runs/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function decide(input: { gateId: string; decision: "approve" | "reject" | "answer"; answer?: string; path?: string }): Promise<ActionResult> {
  try {
    await api.decide(input.gateId, input.decision, input.answer || undefined, "web");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function specRetryOptions(gateId: string): Promise<ActionResult<{ options: SpecRetryOptions }>> {
  try {
    return { ok: true, options: await api.retryOptions(gateId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function retrySpec(input: { gateId: string; model?: string }): Promise<ActionResult> {
  try {
    await api.retrySpec(input.gateId, input.model || undefined, "web");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function confirmLanded(workItemId: string): Promise<ActionResult> {
  try {
    await api.complete(workItemId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Take local: returns what `kiln pull` needs to continue in a local worktree. */
export async function takeLocal(workItemId: string): Promise<ActionResult<{ branch: string; cloneUrl: string; repo: string }>> {
  try {
    const r = await api.pull(workItemId);
    revalidatePath(`/runs/${workItemId}`);
    return { ok: true, branch: r.branch, cloneUrl: r.cloneUrl, repo: r.repo };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function handBack(workItemId: string, text: string): Promise<ActionResult> {
  try {
    await api.handback(workItemId, text.trim() || "Back to the factory");
    revalidatePath(`/runs/${workItemId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
