import type { Kiln } from "@kiln/engine";
import type { Context } from "hono";

/** Server-side secrets (webhook signing keys) come from the environment or the store, never from agents. */
export function serverSecret(kiln: Kiln, name: string): string | undefined {
  return process.env[name] ?? kiln.secrets.getSecret(name);
}

/** A connection's credential, falling back to an environment variable (e.g. SLACK_SIGNING_SECRET). */
export function credential(kiln: Kiln, provider: string, key: string, env?: string): string | undefined {
  return (env ? serverSecret(kiln, env) : undefined) ?? kiln.connections.credentials(provider)[key];
}

export function installation(kiln: Kiln, provider: string): Record<string, string | number | boolean | undefined> {
  return kiln.connections.get(provider)?.installation ?? {};
}

export const csv = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function summarize(r: { started: { id: string; factory: string }[]; continued: string[]; duplicate: boolean }) {
  return { started: r.started.map((w) => ({ id: w.id, factory: w.factory })), continued: r.continued, duplicate: r.duplicate };
}

/** Where providers send people back after OAuth, and where they post webhooks. */
export function urls(kiln: Kiln, c: Context, provider: string) {
  const base = (kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const hook = provider === "microsoft-teams" ? "teams" : provider === "azure_devops" ? "azure-devops" : provider;
  return { redirectUri: `${base}/oauth/${provider}/callback`, webhookUrl: `${base}/webhooks/${hook}` };
}

export const header = (c: Context) => (name: string) => c.req.header(name);
