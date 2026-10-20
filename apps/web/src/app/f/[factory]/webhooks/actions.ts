"use server";

import { revalidatePath } from "next/cache";
import { isMissingEndpoint } from "@/lib/api/missing";
import type { SignatureScheme, WebhookAuthMode } from "@/lib/api/webhooks";
import { slugify, toYaml } from "@/lib/frontmatter";
import { api } from "@/lib/kiln";
import { failure, write, type ActionResult } from "@/lib/write-result";

const refresh = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

export type CreateWebhookInput = { name: string; authMode: WebhookAuthMode; signatureScheme?: SignatureScheme; secretName?: string; secret?: string; deliveryIdHeader?: string; enabled: boolean };

export type CreatedWebhook = { uid?: string; url?: string; secret?: string; fileBacked?: boolean; pullRequest?: string };

/**
 * Create a webhook. Uses the webhooks API (Kiln names and stores the secret); when the server does
 * not have it yet, the webhook is written as webhooks/<name>.yaml referencing an existing secret.
 */
export async function addWebhook(factory: string, input: CreateWebhookInput): Promise<ActionResult<CreatedWebhook>> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  try {
    const r = await api.createWebhook(factory, { name: input.name.trim(), authMode: input.authMode, signatureScheme: input.signatureScheme, secret: input.secret, deliveryIdHeader: input.deliveryIdHeader });
    // Webhooks with a secret start enabled; honour "Enabled" off.
    if (!input.enabled && r.webhook.enabled) await api.updateWebhook(r.webhook.id, { enabled: false });
    refresh(factory);
    return { ok: true, uid: r.webhook.id, url: r.url, secret: r.secret };
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
    await api.updateWebhook(uid, { enabled });
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Second step for providers that issue the secret only after they know the URL (Stripe, Vercel, PagerDuty). */
export async function finishWebhookSetup(factory: string, uid: string, secret: string): Promise<ActionResult> {
  try {
    await api.finishWebhook(uid, secret);
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function rotateWebhookSecret(factory: string, uid: string): Promise<ActionResult<{ secret?: string; url?: string }>> {
  try {
    const r = await api.rotateWebhookSecret(uid);
    refresh(factory);
    return { ok: true, secret: r.secret, url: r.url };
  } catch (e) {
    return failure(e);
  }
}

/** Managed webhooks are deleted by uid; file webhooks by removing webhooks/<name>.yaml. */
export async function removeWebhook(factory: string, webhook: { uid: string; name: string }, fileBacked: boolean): Promise<ActionResult> {
  try {
    if (fileBacked) {
      const def = await api.definition(factory);
      const path = Object.keys(def.tree).find((p) => p === `webhooks/${webhook.name}.yaml` || p === `webhooks/${webhook.name}.yml`);
      if (!path) return { ok: false, error: "Webhook file not found" };
      const r = await write(factory, [{ path, content: null }], `Delete webhook ${webhook.name}`);
      refresh(factory);
      return r.ok ? { ok: true } : r;
    }
    await api.deleteWebhook(webhook.uid);
    refresh(factory);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** One delivery with its payload (the list omits payloads). */
export async function loadDeliveryPayload(uid: string, id: string): Promise<ActionResult<{ payload: unknown }>> {
  try {
    return { ok: true, payload: (await api.webhookDelivery(uid, id)).payload };
  } catch (e) {
    return failure(e);
  }
}
