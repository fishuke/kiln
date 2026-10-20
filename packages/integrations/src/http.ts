import { createHmac, timingSafeEqual } from "node:crypto";

export type Fetch = typeof fetch;

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * JSON over fetch for provider adapters. 404 resolves to undefined (callers treat it as "missing");
 * other non-2xx statuses throw ProviderHttpError with the response text.
 */
export async function jsonRequest<T>(
  provider: string,
  doFetch: Fetch,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  contentType = "application/json",
): Promise<T> {
  const res = await doFetch(url, {
    method,
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": contentType } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  if (res.status === 404) return undefined as T;
  if (!res.ok) throw new ProviderHttpError(provider, res.status, `${provider} ${method} ${url} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacHex = (algo: "sha1" | "sha256", secret: string | Buffer, body: string) => createHmac(algo, secret).update(body).digest("hex");

export const resolveToken = async (t: string | (() => Promise<string> | string)) => (typeof t === "string" ? t : await t());
