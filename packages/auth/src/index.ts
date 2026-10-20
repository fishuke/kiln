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
  "admin",
] as const;
export type Scope = (typeof SCOPES)[number];

export type Grant = { scope: Scope; factory: string };

/**
 * - scoped: explicit grants (bootstrap admin, CI tokens)
 * - session: a login; acts as the user, grants come from their memberships
 * - personal: an API key that acts as the user
 * - agent: a team service account; read and send on the team's factories, team usage
 * - worker: a self-hosted worker; no API scopes
 */
export const TOKEN_TYPES = ["scoped", "session", "personal", "agent", "worker"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export type ApiToken = {
  id: string;
  name: string;
  subject: string;
  hash: string;
  grants: Grant[];
  createdAt: string;
  expiresAt?: string;
  revoked?: boolean;
  type?: TokenType;
  /** Set for session and personal tokens: grants are computed from the user's memberships. */
  userId?: string;
  /** The team an agent or worker key belongs to. */
  teamId?: string;
  createdBy?: string;
  lastUsedAt?: string;
};

const COLLECTION = "api_tokens";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function issueToken(
  store: Store,
  input: { name: string; subject: string; grants: Grant[]; ttlHours?: number; now?: Date; type?: TokenType; userId?: string; teamId?: string; createdBy?: string },
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
    type: input.type ?? "scoped",
    userId: input.userId,
    teamId: input.teamId,
    createdBy: input.createdBy,
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
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  // Last used, at most once a minute so reads stay cheap.
  if (!record.lastUsedAt || now.getTime() - new Date(record.lastUsedAt).getTime() > 60_000) {
    record.lastUsedAt = now.toISOString();
    store.put(COLLECTION, record);
  }
  return record;
}

export function getToken(store: Store, id: string): ApiToken | undefined {
  return store.get<ApiToken>(COLLECTION, id);
}

export function listTokens(store: Store, filter?: (t: ApiToken) => boolean): ApiToken[] {
  return store.list<ApiToken>(COLLECTION, filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A token without its hash, safe to return from the API. */
export function publicToken(t: ApiToken): Omit<ApiToken, "hash"> {
  const { hash: _h, ...rest } = t;
  return rest;
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

export * from "./passwords";
export * from "./roles";
export * from "./github";

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
