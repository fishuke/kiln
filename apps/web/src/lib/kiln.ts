import "server-only";
import { cookies } from "next/headers";
import { KilnApiError, KilnClient } from "@kiln/sdk-ts";
import { effectiveToken, SESSION_COOKIE, TEAM_COOKIE, validTeam } from "./session";

export const KILN_API_URL = process.env.KILN_API_URL ?? "http://localhost:4000";

/** The server's own client: KILN_TOKEN, or no token when the API runs with dev auth. */
const base = new KilnClient({ baseUrl: KILN_API_URL, token: process.env.KILN_TOKEN });

/** The session token and chosen team from this request's cookies (none outside a request). */
export async function requestAuth(): Promise<{ token?: string; team?: string; signedIn: boolean }> {
  try {
    const jar = await cookies();
    const session = jar.get(SESSION_COOKIE)?.value;
    return { token: effectiveToken(session, process.env.KILN_TOKEN), team: validTeam(jar.get(TEAM_COOKIE)?.value), signedIn: Boolean(session) };
  } catch {
    return { token: process.env.KILN_TOKEN, signedIn: false };
  }
}

/** A client acting as this request's user: the session cookie first, then KILN_TOKEN, then dev auth. */
export async function client(): Promise<KilnClient> {
  const { token, team } = await requestAuth();
  let k = token && token !== process.env.KILN_TOKEN ? base.withToken(token) : base;
  if (team) k = k.withTeam(team);
  return k;
}

const PER_REQUEST = new Set<PropertyKey>(["withTeam", "withToken"]);

/**
 * Server-side client. Every call resolves the caller from the request cookies, so pages and
 * server actions act as the signed-in user. The token never reaches the browser.
 */
export const api: KilnClient = new Proxy(base, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function" || PER_REQUEST.has(prop)) return value;
    return async (...args: unknown[]) => {
      const k = await client();
      return (Reflect.get(k, prop) as (...a: unknown[]) => unknown).apply(k, args);
    };
  },
});

export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Human message for an API error. */
export function errorMessage(err: unknown): string {
  if (err instanceof KilnApiError) {
    const data = err.body as { message?: string; error?: string; issues?: (string | { message: string; path?: (string | number)[] })[] } | undefined;
    if (data?.issues?.length)
      return data.issues
        .map((i) => (typeof i === "string" ? i.replace(/^:\s*/, "") : i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ");
    return data?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
