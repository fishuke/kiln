import "server-only";
import { KILN_API_URL, requestAuth } from "./kiln";

/** The API's base URL without a trailing slash, for the streaming and binary proxies. */
export const API_BASE = KILN_API_URL.replace(/\/$/, "");

/** Headers that make a raw API call act as this request's user (session token and team). */
export async function apiHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { token, team } = await requestAuth();
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-kiln-team": team } : {}), ...extra };
}

/** Forwards a JSON call to the API as this request's user and answers with the API's status and body. */
export async function proxyJson(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await apiHeaders(body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  }).catch(() => undefined);
  if (!res) return Response.json({ error: "The Kiln API can't be reached" }, { status: 502 });
  const text = await res.text();
  return new Response(text || null, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
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
