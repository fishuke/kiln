import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "@kiln/store";

/**
 * Scopes for API and MCP tokens. Every grant names a factory
 * (or "*"), so a product owner's token can decide previews without touching definitions.
 */
export const SCOPES = [
  "read",
  "send",
  "decide:spec",
  "decide:preview",
  "decide:question",
  "decide:merge",
  "definitions:write",
  /** Self-hosted workers: connect, claim runs routed to their worker id, report results. */
  "worker",
  "admin",
] as const;
export type Scope = (typeof SCOPES)[number];

export type Grant = { scope: Scope; factory: string };

export type ApiToken = {
  id: string;
  name: string;
  subject: string;
  hash: string;
  grants: Grant[];
  createdAt: string;
  expiresAt?: string;
  revoked?: boolean;
};

const COLLECTION = "api_tokens";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function issueToken(
  store: Store,
  input: { name: string; subject: string; grants: Grant[]; ttlHours?: number; now?: Date },
): { token: string; record: ApiToken } {
  const id = `tok_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const token = `kiln_${id}_${secret}`;
  const now = input.now ?? new Date();
  const record: ApiToken = {
    id,
    name: input.name,
    subject: input.subject,
    hash: hash(token),
    grants: input.grants,
    createdAt: now.toISOString(),
    expiresAt: input.ttlHours ? new Date(now.getTime() + input.ttlHours * 3600_000).toISOString() : undefined,
  };
  store.put(COLLECTION, record);
  return { token, record };
}

export function verifyToken(store: Store, raw: string | undefined, now = new Date()): ApiToken | undefined {
  if (!raw) return undefined;
  const match = /^kiln_(tok_[0-9a-f]{12})_/.exec(raw);
  if (!match) return undefined;
  const record = store.get<ApiToken>(COLLECTION, match[1]!);
  if (!record || record.revoked) return undefined;
  if (record.expiresAt && new Date(record.expiresAt) <= now) return undefined;
  const a = Buffer.from(record.hash, "hex");
  const b = Buffer.from(hash(raw), "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? record : undefined;
}

export function revokeToken(store: Store, id: string): void {
  const record = store.get<ApiToken>(COLLECTION, id);
  if (record) store.put(COLLECTION, { ...record, revoked: true });
}

/** `admin` implies every scope; `decide:*` style wildcards are not supported on purpose. */
export function can(token: Pick<ApiToken, "grants"> | undefined, scope: Scope, factory: string | "*"): boolean {
  if (!token) return false;
  return token.grants.some(
    (g) =>
      (g.scope === scope || g.scope === "admin") && (g.factory === "*" || (factory !== "*" && g.factory === factory)),
  );
}

/** Factories a token may read, or "*" for all. */
export function readableFactories(token: Pick<ApiToken, "grants">): string[] | "*" {
  if (token.grants.some((g) => g.factory === "*")) return "*";
  return [...new Set(token.grants.map((g) => g.factory))];
}

export function parseGrants(spec: string): Grant[] {
  // "read:*,send:webapp,decide:preview:webapp"
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(":");
      const factory = parts.pop()!;
      const scope = parts.join(":") as Scope;
      if (!SCOPES.includes(scope)) throw new Error(`unknown scope ${scope}`);
      return { scope, factory };
    });
}
