import type { Kiln } from "@kiln/engine";
import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "../app";

/** Query string as an object; repeated keys become arrays. */
export function queryObject(c: Context<Env>): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(c.req.queries()).map(([k, v]) => [k, v.length > 1 ? v : v[0]!]));
}

/** A list query param: repeated (`?stage=A&stage=B`) or comma separated (`?stage=A,B`). */
export const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(",")).filter(Boolean)), z.array(item).optional());

export const flag = z.preprocess((v) => (v === undefined ? undefined : v === "true" || v === "1" || v === true), z.boolean().optional());

export const limit = (max: number) => z.coerce.number().int().min(1).max(max).optional();

export const Period = z.enum(["day", "week", "month"]);

export const RangeQuery = z
  .object({ start_date: z.string().datetime({ offset: true }).optional(), end_date: z.string().datetime({ offset: true }).optional(), group_by_period: Period.optional() })
  .passthrough();

export const range = (q: z.infer<typeof RangeQuery>) => ({ start: q.start_date && new Date(q.start_date).toISOString(), end: q.end_date && new Date(q.end_date).toISOString(), groupByPeriod: q.group_by_period });

/** Path after a prefix in a wildcard route, decoded. */
export function restOf(c: Context<Env>, prefix: RegExp): string {
  const m = prefix.exec(c.req.path);
  return decodeURIComponent(m ? c.req.path.slice(m[0].length) : "");
}

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
