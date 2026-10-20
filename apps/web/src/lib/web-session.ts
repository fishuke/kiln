import "server-only";
import { cookies, headers } from "next/headers";
import { isSecureRequest, SESSION_COOKIE, sessionCookieOptions, TEAM_COOKIE, teamCookieOptions } from "./session";

async function secure(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `http://${h.get("host")}` : "http://localhost");
  return isSecureRequest(origin, h.get("x-forwarded-proto"));
}

/** Stores the API session token in the httpOnly kiln_session cookie. */
export async function setSession(token: string, expiresAt?: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions({ secure: await secure(), expiresAt }));
  jar.delete(TEAM_COOKIE);
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TEAM_COOKIE);
}

export async function setTeam(team: string) {
  (await cookies()).set(TEAM_COOKIE, team, teamCookieOptions(await secure()));
}

/** This web app's own origin, for redirects the API sends people back to. */
export async function webOrigin(): Promise<string> {
  if (process.env.KILN_WEB_URL) return process.env.KILN_WEB_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
