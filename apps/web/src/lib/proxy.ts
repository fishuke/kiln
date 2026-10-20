import "server-only";
import { KILN_API_URL, requestAuth } from "./kiln";

/** Streams a GET from the API with this request's token (avatars and other images). */
export async function proxyGet(path: string): Promise<Response> {
  const { token, team } = await requestAuth();
  const res = await fetch(`${KILN_API_URL.replace(/\/$/, "")}${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-kiln-team": team } : {}) },
    cache: "no-store",
  }).catch(() => undefined);
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
