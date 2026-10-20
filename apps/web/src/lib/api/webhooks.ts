import "server-only";
import type { WebhookDelivery, WebhookSource } from "@kiln/sdk-ts";
import { api, safe } from "@/lib/kiln";

export type WebhookAuthMode = WebhookSource["authMode"];
export type SignatureScheme = NonNullable<WebhookSource["signatureScheme"]>;

/** A webhook as the API lists it: `id` is the uid, `origin: "file"` comes from webhooks/<name>.yaml. */
export type Webhook = WebhookSource & { url: string };

/** A delivery row; the list omits payloads (`hasPayload`), one delivery carries it. */
export type Delivery = Omit<WebhookDelivery, "payload"> & { hasPayload?: boolean; payload?: unknown };

export async function listWebhooks(factory: string): Promise<{ webhooks: Webhook[]; available: boolean }> {
  try {
    return { webhooks: await api.webhooks(factory), available: true };
  } catch {
    return { webhooks: [], available: false };
  }
}

export const getWebhook = (uid: string): Promise<Webhook | null> => safe(() => api.webhook(uid), null);

export const webhookDeliveries = (uid: string): Promise<Delivery[]> => safe(() => api.webhookDeliveries(uid), []);

/** Public base URL for ingress links of webhooks that are not created yet. */
export async function publicUrl(): Promise<string> {
  const i = await safe(() => api.integrations(), null);
  return (process.env.KILN_PUBLIC_URL ?? i?.publicUrl ?? process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
}
