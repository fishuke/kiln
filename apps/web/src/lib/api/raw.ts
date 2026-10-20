import "server-only";

/** Raw access to API endpoints the SDK does not cover yet. Server only: the token stays here. */
export const KILN_API_URL = (process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env.KILN_TOKEN ? { authorization: `Bearer ${process.env.KILN_TOKEN}` } : {}), ...extra };
}

export class RawApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function rawJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${KILN_API_URL}${path}`, {
    method,
    headers: authHeaders({ accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new RawApiError(res.status, (data as { error?: string } | undefined)?.error ?? `${method} ${path} returned ${res.status}`);
  return data as T;
}
