import "server-only";
import { KILN_API_URL, requestAuth } from "./kiln";

/** The API's base URL without a trailing slash, for the streaming and binary proxies. */
export const API_BASE = KILN_API_URL.replace(/\/$/, "");

/** Headers that make a raw API call act as this request's user (session token and team). */
export async function apiHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { token, team } = await requestAuth();
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-kiln-team": team } : {}), ...extra };
}

/** Streams a GET from the API with this request's token (avatars and other images). */
export async function proxyGet(path: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { headers: await apiHeaders(), cache: "no-store" }).catch(() => undefined);
  if (!res || !res.ok || !res.body) return new Response(null, { status: res?.status ?? 502 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
