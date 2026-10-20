import { randomBytes } from "node:crypto";
import { CONNECTION_PROVIDERS, type ConnectionProvider, type ConnectionProviderId, type ConnectionStatus, type StartResult, type TestResult } from "@kiln/integrations";
import type { Kiln } from "./kiln";
import { C } from "./types";

/** A workspace-level connection to one external system. Factories opt in from factory.yaml. */
export type Connection = {
  id: ConnectionProviderId;
  provider: ConnectionProviderId;
  status: ConnectionStatus;
  account?: { id: string; name: string; url?: string };
  installation: Record<string, string | number | boolean | undefined>;
  scopes: string[];
  connectedBy?: string;
  connectedAt?: string;
  error?: string;
  lastTest?: TestResult & { at: string };
  /** Names → ids for alias filters and pickers: teams, projects, states, channels, users. */
  directory?: Record<string, Record<string, string>>;
  /** Credential key → name of the Kiln secret holding it. */
  secretNames: Record<string, string>;
};

export type ApprovalLink = {
  id: string;
  provider: ConnectionProviderId;
  token: string;
  email?: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  state: "open" | "used" | "revoked";
  sentCount: number;
};

type OAuthState = { id: string; provider: ConnectionProviderId; by: string; createdAt: string; approvalLink?: string };

const APPROVAL_TTL_MS = 7 * 86_400_000;
const STATE_TTL_MS = 30 * 60_000;
const secretName = (provider: string, key: string) => `KILN_CONN_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;

/** Which connection resolves alias names for a trigger provider. */
const DIRECTORY_OF: Record<string, ConnectionProviderId> = { linear: "linear", slack: "slack", jira: "jira", teams: "microsoft-teams", discord: "discord", github: "github", gitlab: "gitlab", azure_devops: "azure_devops" };

export class ConnectionError extends Error {}

export class ConnectionService {
  constructor(
    private readonly k: Kiln,
    private readonly providers: Partial<Record<ConnectionProviderId, ConnectionProvider>> = {},
  ) {}

  private now() {
    return this.k.clock.now();
  }

  private provider(id: string): ConnectionProvider {
    if (!(CONNECTION_PROVIDERS as readonly string[]).includes(id)) throw new ConnectionError(`unknown provider ${id}`);
    const p = this.providers[id as ConnectionProviderId];
    if (!p) throw new ConnectionError(`${id} is not available on this server`);
    return p;
  }

  /** Every provider, with its connection when there is one. */
  list(): { provider: ConnectionProviderId; label: string; mode?: string; available: boolean; connection?: Connection; pendingApprovals: number }[] {
    return CONNECTION_PROVIDERS.map((id) => {
      const p = this.providers[id];
      return {
        provider: id,
        label: p?.label ?? id,
        mode: p?.mode,
        available: Boolean(p),
        connection: this.get(id),
        pendingApprovals: this.approvalLinks(id).filter((l) => l.state === "open").length,
      };
    });
  }

  get(id: string): Connection | undefined {
    return this.k.store.get<Connection>(C.connections, id);
  }

  isConnected(id: string): boolean {
    return this.get(id)?.status === "connected";
  }

  /** Credentials of a connection, read from Kiln secrets. */
  credentials(id: string): Record<string, string> {
    const c = this.get(id);
    const out: Record<string, string> = {};
    for (const [key, name] of Object.entries(c?.secretNames ?? {})) {
      const v = this.k.secrets.getSecret(name);
      if (v) out[key] = v;
    }
    return out;
  }

  /** Begin connecting: an OAuth/install URL and/or setup steps, plus the state to send back. */
  start(id: string, by: string, urls: { redirectUri: string; webhookUrl: string }, approvalLink?: string): StartResult & { provider: string; state: string } {
    const p = this.provider(id);
    const state: OAuthState = { id: randomBytes(16).toString("hex"), provider: p.id, by, createdAt: this.now().toISOString(), approvalLink };
    this.k.store.put(C.connectionStates, state);
    return { provider: p.id, state: state.id, ...p.start({ state: state.id, redirectUri: urls.redirectUri, webhookUrl: urls.webhookUrl }) };
  }

  /** Finish connecting: OAuth code + state, or the manual fields. */
  async complete(id: string, input: { code?: string; state?: string; params?: Record<string, string>; by: string; redirectUri: string; webhookUrl: string }): Promise<Connection> {
    const p = this.provider(id);
    let by = input.by;
    let approval: string | undefined;
    if (input.state) {
      const st = this.k.store.get<OAuthState>(C.connectionStates, input.state);
      if (!st || st.provider !== p.id || this.now().getTime() - Date.parse(st.createdAt) > STATE_TTL_MS) throw new ConnectionError("the connection link expired or was already used; start again");
      this.k.store.delete(C.connectionStates, st.id);
      by = st.by;
      approval = st.approvalLink;
    } else if (input.code) {
      throw new ConnectionError("state is required with an OAuth code");
    }
    const now = this.now().toISOString();
    try {
      const r = await p.complete({ code: input.code, state: input.state, params: input.params, redirectUri: input.redirectUri, webhookUrl: input.webhookUrl });
      const secretNames: Record<string, string> = {};
      for (const [key, value] of Object.entries(r.secrets)) {
        if (!value) continue;
        const name = secretName(p.id, key);
        this.k.secrets.setSecret(name, value);
        secretNames[key] = name;
      }
      const conn: Connection = { id: p.id, provider: p.id, status: "connected", account: r.account, installation: r.installation, scopes: r.scopes, connectedBy: by, connectedAt: now, secretNames, directory: this.get(p.id)?.directory };
      this.k.store.put(C.connections, conn);
      if (approval) {
        const link = this.k.store.get<ApprovalLink>(C.approvalLinks, approval);
        if (link) this.k.store.put(C.approvalLinks, { ...link, state: "used" });
      }
      this.k.audit(by, "connection.connected", p.id, { account: r.account.name, viaApproval: Boolean(approval) });
      return conn;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const prev = this.get(p.id);
      this.k.store.put(C.connections, { ...(prev ?? { id: p.id, provider: p.id, installation: {}, scopes: [], secretNames: {} }), status: "error", error: message } satisfies Connection);
      this.k.audit(by, "connection.failed", p.id, { error: message });
      throw new ConnectionError(`${p.label}: ${message}`);
    }
  }

  async test(id: string): Promise<TestResult> {
    const p = this.provider(id);
    const c = this.get(id);
    if (!c) throw new ConnectionError(`${p.label} is not connected`);
    let result: TestResult;
    try {
      result = await p.test({ installation: c.installation, secrets: this.credentials(id) });
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    this.k.store.put(C.connections, { ...c, status: result.ok ? "connected" : "error", error: result.ok ? undefined : result.message, lastTest: { ...result, at: this.now().toISOString() } });
    return result;
  }

  disconnect(id: string, by: string): boolean {
    const c = this.get(id);
    if (!c) return false;
    for (const name of Object.values(c.secretNames)) this.k.store.delete(C.secrets, name);
    this.k.store.delete(C.connections, id);
    for (const l of this.approvalLinks(id)) if (l.state === "open") this.k.store.put(C.approvalLinks, { ...l, state: "revoked" });
    this.k.audit(by, "connection.disconnected", id);
    return true;
  }

  /** Names → ids used to resolve alias filters (refreshed when the connection is tested or set by an admin). */
  setDirectory(id: ConnectionProviderId, directory: Record<string, Record<string, string>>) {
    const c = this.get(id) ?? ({ id, provider: id, status: "connected", installation: {}, scopes: [], secretNames: {} } satisfies Connection);
    this.k.store.put(C.connections, { ...c, directory });
  }

  /** Resolve one alias name (e.g. linear teams "Engineering") to ids. */
  resolveName(triggerProvider: string, key: string, name: string): string[] | undefined {
    const conn = this.get(DIRECTORY_OF[triggerProvider] ?? triggerProvider);
    const kind = key === "itemUsers" ? "users" : key;
    const dir = conn?.directory?.[kind];
    if (!dir) return undefined;
    const hit = dir[name] ?? Object.entries(dir).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    return hit ? [hit] : undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // "Someone else" approval links (a site admin finishes the connection; expire after 7 days)

  approvalLinks(provider?: string): ApprovalLink[] {
    return this.k.store
      .list<ApprovalLink>(C.approvalLinks, (l) => !provider || l.provider === provider)
      .map((l) => (l.state === "open" && Date.parse(l.expiresAt) < this.now().getTime() ? { ...l, state: "revoked" as const } : l))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createApprovalLink(id: string, by: string, email?: string): ApprovalLink {
    const p = this.provider(id);
    const now = this.now();
    const link: ApprovalLink = { id: `apl_${randomBytes(6).toString("hex")}`, provider: p.id, token: randomBytes(24).toString("base64url"), email, createdBy: by, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(), state: "open", sentCount: 1 };
    this.k.store.put(C.approvalLinks, link);
    const c = this.get(p.id);
    if (!c || c.status !== "connected") this.k.store.put(C.connections, { ...(c ?? { id: p.id, provider: p.id, installation: {}, scopes: [], secretNames: {} }), status: "pending_approval" } satisfies Connection);
    this.k.audit(by, "connection.approval_requested", p.id, { email });
    return link;
  }

  /** Resend: a fresh token and another 7 days. */
  resendApprovalLink(linkId: string, by: string): ApprovalLink {
    const link = this.k.store.get<ApprovalLink>(C.approvalLinks, linkId);
    if (!link || link.state !== "open") throw new ConnectionError("unknown or closed approval link");
    const next = { ...link, token: randomBytes(24).toString("base64url"), expiresAt: new Date(this.now().getTime() + APPROVAL_TTL_MS).toISOString(), sentCount: link.sentCount + 1 };
    this.k.store.put(C.approvalLinks, next);
    this.k.audit(by, "connection.approval_resent", link.provider);
    return next;
  }

  revokeApprovalLink(linkId: string, by: string) {
    const link = this.k.store.get<ApprovalLink>(C.approvalLinks, linkId);
    if (!link) throw new ConnectionError("unknown approval link");
    this.k.store.put(C.approvalLinks, { ...link, state: "revoked" });
    const c = this.get(link.provider);
    if (c?.status === "pending_approval" && !this.approvalLinks(link.provider).some((l) => l.state === "open" && l.id !== link.id)) this.k.store.delete(C.connections, c.id);
    this.k.audit(by, "connection.approval_revoked", link.provider);
  }

  /** The approver opened the link: start the provider flow on behalf of the link's creator. */
  openApprovalLink(token: string, urls: { redirectUri: string; webhookUrl: string }) {
    const link = this.k.store.list<ApprovalLink>(C.approvalLinks, (l) => l.token === token)[0];
    if (!link || link.state !== "open") throw new ConnectionError("this approval link was revoked or already used");
    if (Date.parse(link.expiresAt) < this.now().getTime()) throw new ConnectionError("this approval link expired; ask for a new one");
    return this.start(link.provider, link.createdBy, urls, link.id);
  }
}

/** Provider identities linked to Kiln people (Slack, Teams and Discord sign-in, GitHub OAuth, email match). */
export type IdentityLink = { id: string; provider: string; externalId: string; subject: string; displayName?: string; tenant?: string; linkedAt: string };
type LinkToken = { id: string; provider: string; externalId: string; displayName?: string; tenant?: string; createdAt: string };

export class IdentityService {
  constructor(private readonly k: Kiln) {}

  lookup(provider: string, externalId: string): string | undefined {
    const hit = this.k.store.get<IdentityLink>(C.identityLinks, `${provider}:${externalId}`)?.subject;
    if (hit) return hit;
    // Linear and Jira identify people by email.
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalId) ? externalId : undefined;
  }

  list(subject?: string): IdentityLink[] {
    return this.k.store.list<IdentityLink>(C.identityLinks, (l) => !subject || l.subject === subject);
  }

  /** A one-hour token a chat user opens in the browser to link their account (the `sign in` command). */
  startLink(provider: string, externalId: string, extra: { displayName?: string; tenant?: string } = {}): { token: string; url: string } {
    const t: LinkToken = { id: randomBytes(18).toString("base64url"), provider, externalId, createdAt: this.k.clock.now().toISOString(), ...extra };
    this.k.store.put(C.linkTokens, t);
    return { token: t.id, url: this.k.link(`/link?token=${t.id}`) };
  }

  claim(token: string, subject: string): IdentityLink {
    const t = this.k.store.get<LinkToken>(C.linkTokens, token);
    if (!t || this.k.clock.now().getTime() - Date.parse(t.createdAt) > 3600_000) throw new ConnectionError("this sign-in link expired; ask the bot for a new one");
    this.k.store.delete(C.linkTokens, token);
    return this.link(t.provider, t.externalId, subject, { displayName: t.displayName, tenant: t.tenant });
  }

  link(provider: string, externalId: string, subject: string, extra: { displayName?: string; tenant?: string } = {}): IdentityLink {
    const l: IdentityLink = { id: `${provider}:${externalId}`, provider, externalId, subject, linkedAt: this.k.clock.now().toISOString(), ...extra };
    this.k.store.put(C.identityLinks, l);
    this.k.audit(subject, "identity.linked", l.id);
    return l;
  }

  /** Teams `sign out` unlinks the person everywhere in that Microsoft organization. */
  unlink(provider: string, externalId: string, opts: { tenant?: string } = {}): number {
    const target = this.k.store.get<IdentityLink>(C.identityLinks, `${provider}:${externalId}`);
    if (!target) return 0;
    const all = this.k.store.list<IdentityLink>(C.identityLinks, (l) => l.provider === provider && l.subject === target.subject && (!opts.tenant || !l.tenant || l.tenant === opts.tenant));
    for (const l of all) this.k.store.delete(C.identityLinks, l.id);
    this.k.audit(target.subject, "identity.unlinked", `${provider}:${externalId}`, { count: all.length });
    return all.length;
  }

  /** The provider id linked to a person (for DMs). */
  externalFor(provider: string, subject: string): string | undefined {
    return this.k.store.list<IdentityLink>(C.identityLinks, (l) => l.provider === provider && l.subject === subject)[0]?.externalId;
  }
}
