"use server";

import { revalidatePath } from "next/cache";
import { isMissingEndpoint } from "@/lib/api/missing";
import { createWebhook, deleteWebhook, rotateWebhook, updateWebhook, type CreateWebhookInput, type Webhook } from "@/lib/api/webhooks";
import { slugify, toYaml } from "@/lib/frontmatter";
import { api } from "@/lib/kiln";
import { failure, write, type ActionResult } from "@/lib/write-result";

const refresh = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

export type CreatedWebhook = { uid?: string; url?: string; secret?: string; fileBacked?: boolean; pullRequest?: string };

/**
 * Create a webhook. Uses the webhooks API; when the server does not have it yet, the webhook is
 * written as webhooks/<name>.yaml (file webhooks reference an existing secret by name).
 */
export async function addWebhook(factory: string, input: CreateWebhookInput): Promise<ActionResult<CreatedWebhook>> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  try {
    const r = await createWebhook(factory, { ...input, name: input.name.trim() });
    const w = (r.webhook ?? r) as Partial<Webhook>;
    refresh(factory);
    return { ok: true, uid: w.uid, url: r.url ?? w.url, secret: r.secret };
  } catch (e) {
    if (!isMissingEndpoint(e)) return failure(e);
  }
  if (!input.secretName) return { ok: false, error: "This server stores webhooks as files; choose an existing secret name." };
  const file = toYaml({
    enabled: input.enabled,
    authMode: input.authMode,
    ...(input.authMode === "signature" ? { signatureScheme: input.signatureScheme } : {}),
    secretName: input.secretName,
    ...(input.deliveryIdHeader ? { deliveryIdHeader: input.deliveryIdHeader } : {}),
  });
  const name = slugify(input.name) || "webhook";
  const r = await write(factory, [{ path: `webhooks/${name}.yaml`, content: file }], `Add webhook ${name}`);
  refresh(factory);
  return r.ok ? { ok: true, uid: name, fileBacked: true, pullRequest: r.pullRequest } : r;
}

export async function setWebhookEnabled(factory: string, uid: string, enabled: boolean): Promise<ActionResult> {
  try {
    await updateWebhook(factory, uid, { enabled });
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Second step for providers that issue the secret only after they know the URL (Stripe, Vercel, PagerDuty). */
export async function finishWebhookSetup(factory: string, uid: string, secret: string): Promise<ActionResult> {
  try {
    await updateWebhook(factory, uid, { secret, enabled: true });
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function rotateWebhookSecret(factory: string, uid: string): Promise<ActionResult<{ secret?: string; url?: string }>> {
  try {
    const r = await rotateWebhook(factory, uid);
    refresh(factory);
    return { ok: true, secret: r.secret, url: r.url };
  } catch (e) {
    return failure(e);
  }
}

export async function removeWebhook(factory: string, uid: string, fileBacked: boolean): Promise<ActionResult> {
  try {
    if (fileBacked) {
      const def = await api.definition(factory);
      const path = Object.keys(def.tree).find((p) => p === `webhooks/${uid}.yaml` || p === `webhooks/${uid}.yml`);
      if (!path) return { ok: false, error: "Webhook file not found" };
      const r = await write(factory, [{ path, content: null }], `Delete webhook ${uid}`);
      refresh(factory);
      return r.ok ? { ok: true } : r;
    }
    await deleteWebhook(factory, uid);
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
