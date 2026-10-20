import "server-only";
import { api, safe } from "@/lib/kiln";

export type WebhookAuthMode = "token" | "url_token" | "signature";
export type SignatureScheme = "github" | "stripe" | "sentry" | "pagerduty" | "vercel" | "standard_webhooks";

export type Webhook = {
  uid: string;
  name: string;
  authMode: WebhookAuthMode;
  signatureScheme?: SignatureScheme;
  secretName?: string;
  deliveryIdHeader?: string;
  enabled: boolean;
  /** Ingress URL; url_token webhooks show a {token} placeholder. */
  url?: string;
  /** `file` webhooks come from webhooks/<name>.yaml and are read-only here. */
  source?: "api" | "file";
  createdAt?: string;
  lastDeliveryAt?: string;
};

export type DeliveryStatus = "accepted" | "duplicate" | "rejected_auth" | "rejected_invalid_json" | "rejected_too_large";
export type Delivery = { id: string; deliveryId?: string; status: DeliveryStatus; size?: number; receivedAt: string; payload?: unknown };

const base = (factory: string) => `/api/v1/factories/${encodeURIComponent(factory)}/webhooks`;

export async function listWebhooks(factory: string): Promise<{ webhooks: Webhook[]; available: boolean }> {
  try {
    const r = await api.request<Webhook[] | { webhooks: Webhook[] }>("GET", base(factory));
    return { webhooks: Array.isArray(r) ? r : r.webhooks ?? [], available: true };
  } catch {
    return { webhooks: [], available: false };
  }
}

export async function getWebhook(factory: string, uid: string): Promise<Webhook | null> {
  const direct = await safe(() => api.request<Webhook>("GET", `${base(factory)}/${encodeURIComponent(uid)}`), null);
  if (direct) return direct;
  return (await listWebhooks(factory)).webhooks.find((w) => w.uid === uid || w.name === uid) ?? null;
}

export function webhookDeliveries(factory: string, uid: string): Promise<Delivery[]> {
  return safe(async () => {
    const r = await api.request<Delivery[] | { deliveries: Delivery[] }>("GET", `${base(factory)}/${encodeURIComponent(uid)}/deliveries`);
    return Array.isArray(r) ? r : r.deliveries ?? [];
  }, []);
}

export type CreateWebhookInput = { name: string; authMode: WebhookAuthMode; signatureScheme?: SignatureScheme; secretName?: string; secret?: string; deliveryIdHeader?: string; enabled: boolean };

export function createWebhook(factory: string, input: CreateWebhookInput) {
  return api.request<{ webhook?: Webhook; secret?: string; url?: string } & Partial<Webhook>>("POST", base(factory), input);
}

export function updateWebhook(factory: string, uid: string, patch: Partial<Pick<Webhook, "enabled" | "name" | "deliveryIdHeader">> & { secret?: string }) {
  return api.request<Webhook>("PATCH", `${base(factory)}/${encodeURIComponent(uid)}`, patch);
}

export function deleteWebhook(factory: string, uid: string) {
  return api.request<{ ok: true }>("DELETE", `${base(factory)}/${encodeURIComponent(uid)}`);
}

export function rotateWebhook(factory: string, uid: string) {
  return api.request<{ secret?: string; url?: string }>("POST", `${base(factory)}/${encodeURIComponent(uid)}/rotate`);
}

/** Public base URL for ingress links when the API does not return one. */
export async function publicUrl(): Promise<string> {
  const i = await safe(() => api.integrations(), null);
  return (process.env.KILN_PUBLIC_URL ?? i?.publicUrl ?? process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

export function ingressUrl(w: Webhook, origin: string): string {
  if (w.url) return w.url;
  return `${origin}/webhooks/w/${w.uid}${w.authMode === "url_token" ? "/{token}" : ""}`;
}
