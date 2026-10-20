import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";

const CLIENTS = "oauth_clients";
const CODES = "oauth_codes";
const REFRESH = "oauth_refresh";
const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 3_600_000;

/** Loopback for native clients (Claude Code, Codex …) or HTTPS for hosted ones. */
const RedirectUri = z
  .string()
  .url()
  .refine((u) => {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  }, "redirect URIs must be https, or http on localhost");

/** RFC 7591 dynamic client registration; public clients only (PKCE, no secret). */
export const ClientRegistration = z.object({
  client_name: z.string().min(1).max(100).default("MCP client"),
  redirect_uris: z.array(RedirectUri).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
});

export const AuthorizeRequest = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(500).optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});
export type AuthorizeRequest = z.infer<typeof AuthorizeRequest>;

export type OAuthClient = { client_id: string; client_name: string; redirect_uris: string[]; client_id_issued_at: number; createdAt: string };
type Code = { id: string; clientId: string; redirectUri: string; challenge: string; userId: string; expiresAt: string };
type Refresh = { id: string; clientId: string; userId: string; expiresAt: string };

const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

/**
 * Kiln as an OAuth 2.1 authorization server for MCP clients: they register themselves, the person
 * approves in the web app, and the client gets a session token that acts as that person. Codes and
 * refresh tokens are stored hashed, single use, with PKCE (S256) required.
 */
export class OAuthService {
  constructor(private readonly k: Kiln) {}

  register(input: unknown): OAuthClient & { token_endpoint_auth_method: "none"; grant_types: string[]; response_types: string[] } {
    const r = ClientRegistration.safeParse(input);
    if (!r.success) throw new KilnError("invalid_request", r.error.issues.map((i) => i.message).join("; "));
    const now = this.k.clock.now();
    const client: OAuthClient = {
      client_id: `kmcp_${randomBytes(12).toString("base64url")}`,
      client_name: r.data.client_name,
      redirect_uris: r.data.redirect_uris,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      createdAt: now.toISOString(),
    };
    this.k.store.put(CLIENTS, { id: client.client_id, ...client });
    return { ...client, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  }

  client(id: string): OAuthClient | undefined {
    const c = this.k.store.get<OAuthClient & { id: string }>(CLIENTS, id);
    if (!c) return undefined;
    const { id: _id, ...rest } = c;
    return rest;
  }

  /** Checks an authorization request before anyone is asked; the redirect URI must be one the client registered. */
  validate(params: unknown): { request: AuthorizeRequest; client: OAuthClient } {
    const r = AuthorizeRequest.safeParse(params);
    if (!r.success) throw new KilnError("invalid_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const client = this.client(r.data.client_id);
    if (!client) throw new KilnError("invalid_request", "unknown client_id; register the client first");
    if (!client.redirect_uris.includes(r.data.redirect_uri)) throw new KilnError("invalid_request", "redirect_uri is not one the client registered");
    return { request: r.data, client };
  }

  /** The person approved: a one-time code back to the client. */
  approve(userId: string, params: unknown): string {
    const { request, client } = this.validate(params);
    const code = secret("kc_");
    this.k.store.put(CODES, {
      id: hash(code),
      clientId: client.client_id,
      redirectUri: request.redirect_uri,
      challenge: request.code_challenge,
      userId,
      expiresAt: new Date(this.k.clock.now().getTime() + CODE_TTL_MS).toISOString(),
    } satisfies Code);
    const user = this.k.users.get(userId);
    this.k.audit(user?.email ?? userId, "oauth.approved", client.client_id, { client: client.client_name });
    return this.redirect(request.redirect_uri, { code, state: request.state });
  }

  deny(params: unknown): string {
    const { request } = this.validate(params);
    return this.redirect(request.redirect_uri, { error: "access_denied", state: request.state });
  }

  /** The token endpoint: authorization_code (with the PKCE verifier) or refresh_token. Refresh tokens rotate. */
  token(form: Record<string, string>) {
    if (form.grant_type === "authorization_code") {
      const id = hash(form.code ?? "");
      const code = this.k.store.get<Code>(CODES, id);
      if (code) this.k.store.delete(CODES, id);
      if (!code || code.expiresAt < this.k.clock.now().toISOString()) throw new OAuthError("invalid_grant", "the code is invalid, expired or already used");
      if (code.clientId !== form.client_id || code.redirectUri !== form.redirect_uri)
        throw new OAuthError("invalid_grant", "client_id or redirect_uri does not match the code");
      if (hash(form.code_verifier ?? "") !== code.challenge) throw new OAuthError("invalid_grant", "code_verifier does not match the code challenge");
      return this.issue(code.clientId, code.userId);
    }
    if (form.grant_type === "refresh_token") {
      const id = hash(form.refresh_token ?? "");
      const r = this.k.store.get<Refresh>(REFRESH, id);
      if (r) this.k.store.delete(REFRESH, id);
      if (!r || r.expiresAt < this.k.clock.now().toISOString() || r.clientId !== form.client_id)
        throw new OAuthError("invalid_grant", "the refresh token is invalid, expired or already used");
      return this.issue(r.clientId, r.userId);
    }
    throw new OAuthError("unsupported_grant_type", "use authorization_code or refresh_token");
  }

  private issue(clientId: string, userId: string) {
    const user = this.k.users.get(userId);
    if (!user) throw new OAuthError("invalid_grant", "the person who approved no longer has an account");
    const client = this.client(clientId);
    const session = this.k.accounts.session(user, `mcp: ${client?.client_name ?? clientId}`);
    const refresh = secret("kr_");
    this.k.store.put(REFRESH, {
      id: hash(refresh),
      clientId,
      userId,
      expiresAt: new Date(this.k.clock.now().getTime() + REFRESH_TTL_MS).toISOString(),
    } satisfies Refresh);
    const expiresIn = session.record.expiresAt
      ? Math.max(60, Math.floor((Date.parse(session.record.expiresAt) - this.k.clock.now().getTime()) / 1000))
      : 30 * 24 * 3600;
    return { access_token: session.token, token_type: "Bearer" as const, expires_in: expiresIn, refresh_token: refresh };
  }

  private redirect(uri: string, params: Record<string, string | undefined>) {
    const url = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    return url.toString();
  }
}

/** Token endpoint errors (RFC 6749 §5.2): answered as 400 with `error` and `error_description`. */
export class OAuthError extends Error {
  constructor(
    readonly error: "invalid_grant" | "unsupported_grant_type" | "invalid_request",
    message: string,
  ) {
    super(message);
  }
}
