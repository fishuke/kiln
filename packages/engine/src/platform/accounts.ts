import { randomBytes } from "node:crypto";
import { issueToken, revokeToken, type ApiToken, type GitHubIdentity } from "@kiln/auth";
import type { Kiln } from "../kiln";
import { P, PlatformError, type User } from "./types";

export const SESSION_TTL_HOURS = 24 * 30;

type OAuthState = { id: string; createdAt: string; redirect?: string; invite?: string };

/** Signup, login sessions and GitHub login. The first person to sign up owns the default team. */
export class AccountService {
  constructor(private readonly k: Kiln) {}

  /** True until someone owns a team. */
  needsOwner(): boolean {
    return !this.k.store.list<{ id: string; role: string }>(P.memberships).some((m) => m.role === "owner");
  }

  private join(user: User, input: { invite?: string; openSignup?: boolean; firstOwner: boolean }) {
    if (input.firstOwner) {
      const team = this.k.teams.ensureDefaultTeam();
      this.k.teams.addMember(team.id, user.id, "owner", user.email);
    } else if (input.invite) {
      this.k.teams.accept(input.invite, user.id);
    } else if (input.openSignup) {
      const team = this.k.teams.ensureDefaultTeam();
      this.k.teams.addMember(team.id, user.id, "member", user.email);
    }
  }

  private mayCreate(email: string, input: { invite?: string; openSignup?: boolean }) {
    if (this.needsOwner()) return true;
    if (input.invite) {
      const inv = this.k.teams.findInvite(input.invite);
      if (inv.email !== email.trim().toLowerCase()) throw new PlatformError(403, `this invite is for ${inv.email}`);
      return true;
    }
    if (input.openSignup) return true;
    throw new PlatformError(403, "signing up needs an invite");
  }

  signup(input: { name?: string; email: string; password: string; invite?: string }, opts: { openSignup?: boolean } = {}): { user: User; token: string; record: ApiToken } {
    const firstOwner = this.needsOwner();
    this.mayCreate(input.email, { invite: input.invite, openSignup: opts.openSignup });
    const user = this.k.users.create({ name: input.name, email: input.email, password: input.password });
    this.join(user, { invite: input.invite, openSignup: opts.openSignup, firstOwner });
    return { user, ...this.session(user, "signup") };
  }

  login(email: string, password: string): { user: User; token: string; record: ApiToken } {
    const user = this.k.users.authenticate(email, password);
    if (!user) {
      this.k.audit(email.trim().toLowerCase(), "auth.login_failed", "password");
      throw new PlatformError(401, "wrong email or password");
    }
    return { user, ...this.session(user, "password") };
  }

  session(user: User, via: string): { token: string; record: ApiToken } {
    const issued = issueToken(this.k.store, { name: `session (${via})`, subject: user.email, grants: [], ttlHours: SESSION_TTL_HOURS, now: this.k.clock.now(), type: "session", userId: user.id, createdBy: user.email });
    this.k.audit(user.email, "auth.login", issued.record.id, { via });
    return issued;
  }

  logout(token: ApiToken) {
    if (token.type !== "session") throw new PlatformError(400, "only session tokens log out; revoke API keys in settings");
    revokeToken(this.k.store, token.id);
    this.k.audit(token.subject, "auth.logout", token.id);
  }

  // ---- API keys ----

  /**
   * Personal keys act as the user; agent keys are a team service account (team usage, read and
   * send only); worker keys authenticate self-hosted workers. Shown once.
   */
  createApiKey(input: { name: string; type: "personal" | "agent" | "worker"; ttlHours?: number; user: User; teamId: string }): { token: string; record: Omit<ApiToken, "hash"> } {
    const team = this.k.teams.require(input.teamId);
    if (input.type !== "personal") {
      const role = this.k.teams.role(team.id, input.user.id);
      if (role !== "owner" && role !== "admin") throw new PlatformError(403, `only team owners and admins create ${input.type} keys`);
    }
    const subject = input.type === "personal" ? input.user.email : `${input.type}:${team.slug}/${input.name}`;
    const { token, record } = issueToken(this.k.store, {
      name: input.name,
      subject,
      grants: [],
      ttlHours: input.ttlHours,
      now: this.k.clock.now(),
      type: input.type,
      userId: input.type === "personal" ? input.user.id : undefined,
      teamId: team.id,
      createdBy: input.user.id,
    });
    this.k.audit(input.user.email, "api_key.created", record.id, { type: input.type, team: team.id, expiresAt: record.expiresAt });
    const { hash: _h, ...rest } = record;
    return { token, record: rest };
  }

  /** The user's personal keys, plus the team's agent and worker keys for team owners and admins. */
  listApiKeys(user: User, teamId: string): Omit<ApiToken, "hash">[] {
    const admin = ["owner", "admin"].includes(this.k.teams.role(teamId, user.id) ?? "");
    return this.k.store
      .list<ApiToken>("api_tokens", (t) => (t.type === "personal" && t.userId === user.id) || (admin && (t.type === "agent" || t.type === "worker") && t.teamId === teamId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ hash: _h, ...t }) => t);
  }

  revokeApiKey(user: User, id: string) {
    const t = this.k.store.get<ApiToken>("api_tokens", id);
    const mine = t?.type === "personal" && t.userId === user.id;
    const teamKey = (t?.type === "agent" || t?.type === "worker") && t.teamId && ["owner", "admin"].includes(this.k.teams.role(t.teamId, user.id) ?? "");
    if (!t || !(mine || teamKey)) throw new PlatformError(404, "unknown API key");
    revokeToken(this.k.store, id);
    this.k.audit(user.email, "api_key.revoked", id, { type: t.type });
  }

  // ---- GitHub login ----

  oauthState(input: { redirect?: string; invite?: string }): string {
    const id = `st_${randomBytes(16).toString("base64url")}`;
    this.k.store.put(P.oauthStates, { id, createdAt: this.k.clock.now().toISOString(), ...input } satisfies OAuthState);
    return id;
  }

  takeState(state: string): OAuthState {
    const s = this.k.store.get<OAuthState>(P.oauthStates, state);
    if (!s) throw new PlatformError(400, "unknown or used login state");
    this.k.store.delete(P.oauthStates, state);
    if (this.k.clock.now().getTime() - new Date(s.createdAt).getTime() > 10 * 60_000) throw new PlatformError(400, "the login took too long; try again");
    return s;
  }

  /** Find the user for a GitHub identity (linked account, then verified email), or sign them up. */
  githubLogin(identity: GitHubIdentity, opts: { invite?: string; openSignup?: boolean }): { user: User; token: string; record: ApiToken; created: boolean } {
    let user = this.k.users.byIdentity("github", identity.id) ?? (identity.email ? this.k.users.byEmail(identity.email) : undefined);
    let created = false;
    if (!user) {
      if (!identity.email) throw new PlatformError(400, "your GitHub account has no verified email");
      const firstOwner = this.needsOwner();
      this.mayCreate(identity.email, opts);
      user = this.k.users.create({ name: identity.name ?? identity.login, email: identity.email, avatar: identity.avatarUrl });
      this.join(user, { ...opts, firstOwner });
      created = true;
    } else if (opts.invite) {
      this.k.teams.accept(opts.invite, user.id);
    }
    if (!user.linkedAccounts.some((a) => a.provider === "github" && a.externalId === identity.id)) user = this.k.users.link(user.id, "github", identity.id, identity.login);
    return { user, created, ...this.session(user, "github") };
  }
}
