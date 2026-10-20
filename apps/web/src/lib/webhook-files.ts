import YAML from "yaml";
import { automationNames, automationPath, parseAutomation } from "@/lib/automations/model";

export type FileWebhook = { uid: string; name: string; authMode: "token" | "url_token" | "signature"; signatureScheme?: string; secretName?: string; deliveryIdHeader?: string; enabled: boolean; source: "file" };

/** Webhooks declared as webhooks/<name>.yaml in a definition tree. */
export function fileWebhooks(tree: Record<string, string>): FileWebhook[] {
  const out: FileWebhook[] = [];
  for (const [path, text] of Object.entries(tree)) {
    const m = /^webhooks\/([^/]+)\.ya?ml$/.exec(path);
    if (!m) continue;
    let d: Record<string, unknown> = {};
    try {
      d = (YAML.parse(text) as Record<string, unknown>) ?? {};
    } catch {
      /* show the file with defaults */
    }
    out.push({
      uid: m[1]!,
      name: m[1]!,
      authMode: (d.authMode as FileWebhook["authMode"]) ?? "token",
      signatureScheme: d.signatureScheme ? String(d.signatureScheme) : undefined,
      secretName: d.secretName ? String(d.secretName) : undefined,
      deliveryIdHeader: d.deliveryIdHeader ? String(d.deliveryIdHeader) : undefined,
      enabled: d.enabled !== false,
      source: "file",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const AUTH_MODES = [
  { value: "token", label: "Bearer token", help: "Sender authenticates with an Authorization: Bearer <secret> header." },
  { value: "url_token", label: "URL token", help: "The secret is part of the URL, so the URL itself is the credential. Use it for senders that cannot set headers." },
  { value: "signature", label: "Provider signature", help: "The provider signs each delivery with a shared secret; Kiln verifies the signature." },
] as const;

export const SIGNATURE_SCHEMES = [
  { value: "github", label: "GitHub", secretAfterUrl: false },
  { value: "stripe", label: "Stripe", secretAfterUrl: true },
  { value: "sentry", label: "Sentry", secretAfterUrl: false },
  { value: "pagerduty", label: "PagerDuty", secretAfterUrl: true },
  { value: "vercel", label: "Vercel", secretAfterUrl: true },
  { value: "standard_webhooks", label: "Standard Webhooks (Svix)", secretAfterUrl: false },
] as const;

export function authLabel(mode: string, scheme?: string): string {
  if (mode === "signature") return `${SIGNATURE_SCHEMES.find((s) => s.value === scheme)?.label ?? scheme ?? "Provider"} signature`;
  return AUTH_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** How many automations subscribe to each webhook (by uid or file name). */
export function webhookUsage(tree: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of automationNames(tree)) {
    try {
      const a = parseAutomation(name, tree[automationPath(tree, name)!]!);
      for (const t of a.triggers) if (t.provider === "webhook" && t.webhook) out[t.webhook] = (out[t.webhook] ?? 0) + 1;
    } catch {
      /* unparsable automation */
    }
  }
  return out;
}

