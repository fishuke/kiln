import { createHash, createHmac } from "node:crypto";
import type { ObjectStore } from "./index";

export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as AWS wants it; `/` kept in paths. */
export function awsEncode(s: string, keepSlash = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? "/" : "%2F");
}

/**
 * AWS Signature Version 4 for one request. Returns the headers to add (authorization, x-amz-date,
 * x-amz-content-sha256 for S3, x-amz-security-token). Works for AWS S3, MinIO and Cloudflare R2.
 */
export function signV4(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  service: string;
  region: string;
  credentials: AwsCredentials;
  date: Date;
  /** S3 wants the payload hash as a signed header; other services (the test vector) do not. */
  contentSha256Header?: boolean;
}): Record<string, string> {
  const u = new URL(input.url);
  const amzDate = input.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v])), host: u.host, "x-amz-date": amzDate };
  if (input.contentSha256Header !== false) headers["x-amz-content-sha256"] = input.payloadHash;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const path = u.pathname
    .split("/")
    .map((seg) => awsEncode(decodeURIComponent(seg)))
    .join("/");
  const canonical = [input.method, path || "/", query, canonicalHeaders, names.join(";"), input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  const out: Record<string, string> = { "x-amz-date": amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
  if (input.contentSha256Header !== false) out["x-amz-content-sha256"] = input.payloadHash;
  if (input.credentials.sessionToken) out["x-amz-security-token"] = input.credentials.sessionToken;
  return out;
}

export type S3Options = {
  bucket: string;
  region: string;
  /** For MinIO, R2 or another S3-compatible service; AWS when omitted. */
  endpoint?: string;
  /** Key prefix inside the bucket. */
  prefix?: string;
  /** Path-style URLs (endpoint/bucket/key). Default: true with a custom endpoint, false on AWS. */
  forcePathStyle?: boolean;
  credentials: AwsCredentials | (() => AwsCredentials | Promise<AwsCredentials>);
  fetch?: typeof fetch;
  now?: () => Date;
};

export class S3Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Object storage on an S3-compatible bucket, signed with SigV4 over fetch (no SDK). */
export class S3ObjectStore implements ObjectStore {
  constructor(private readonly o: S3Options) {}

  private get pathStyle() {
    return this.o.forcePathStyle ?? Boolean(this.o.endpoint);
  }

  private base(): string {
    if (this.o.endpoint) {
      const e = this.o.endpoint.replace(/\/$/, "");
      if (this.pathStyle) return `${e}/${this.o.bucket}`;
      const u = new URL(e);
      return `${u.protocol}//${this.o.bucket}.${u.host}`;
    }
    return this.pathStyle ? `https://s3.${this.o.region}.amazonaws.com/${this.o.bucket}` : `https://${this.o.bucket}.s3.${this.o.region}.amazonaws.com`;
  }

  private full(key: string) {
    const p = (this.o.prefix ?? "").replace(/^\/+|\/+$/g, "");
    return p ? `${p}/${key}` : key;
  }

  private async send(method: string, url: string, body?: Uint8Array, headers: Record<string, string> = {}) {
    const creds = typeof this.o.credentials === "function" ? await this.o.credentials() : this.o.credentials;
    const payloadHash = sha256(body ?? "");
    const signed = signV4({ method, url, headers, payloadHash, service: "s3", region: this.o.region, credentials: creds, date: (this.o.now ?? (() => new Date()))() });
    return (this.o.fetch ?? fetch)(url, { method, headers: { ...headers, ...signed }, body: body as unknown as RequestInit["body"] });
  }

  async put(key: string, body: Uint8Array | string, contentType?: string) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const url = `${this.base()}/${awsEncode(this.full(key), true)}`;
    const res = await this.send("PUT", url, bytes, contentType ? { "content-type": contentType } : {});
    if (!res.ok) throw new S3Error(res.status, `S3 PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return { key, url: `s3://${this.o.bucket}/${this.full(key)}` };
  }

  async get(key: string) {
    const res = await this.send("GET", `${this.base()}/${awsEncode(this.full(key), true)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new S3Error(res.status, `S3 GET ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async list(prefix: string) {
    const out: string[] = [];
    const strip = this.full("");
    let token: string | undefined;
    do {
      const q = new URLSearchParams({ "list-type": "2", prefix: this.full(prefix) });
      if (token) q.set("continuation-token", token);
      const res = await this.send("GET", `${this.base()}/?${q}`);
      if (!res.ok) throw new S3Error(res.status, `S3 list ${prefix} failed: ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) out.push(unxml(m[1]!).slice(strip.length));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined : undefined;
    } while (token);
    return out.sort();
  }
}

function unxml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
