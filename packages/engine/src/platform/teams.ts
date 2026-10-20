import { createHash, randomBytes } from "node:crypto";
import { grantsForFactoryRole, isTeamAdmin, maxFactoryRole, type FactoryRole, type Grant, type TeamRole } from "@kiln/auth";
import type { Kiln } from "../kiln";
import { C, newId, type FactoryBinding } from "../types";
import { avatarKey, DEFAULT_TEAM_SETTINGS, P, PlatformError, TeamSettings, type FactoryMember, type Invite, type Membership, type Team } from "./types";

const INVITE_DAYS = 7;
const hashInvite = (raw: string) => createHash("sha256").update(raw).digest("hex");

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "team"
  );
}

/** Teams, memberships, invites, team settings and per-factory roles. */
export class TeamService {
  constructor(private readonly k: Kiln) {}

  // ---- teams ----

  list(): Team[] {
    return this.k.store.list<Team>(P.teams).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(idOrSlug: string): Team | undefined {
    return this.k.store.get<Team>(P.teams, idOrSlug) ?? this.k.store.list<Team>(P.teams, (t) => t.slug === idOrSlug)[0];
  }

  require(idOrSlug: string): Team {
    const t = this.get(idOrSlug);
    if (!t) throw new PlatformError(404, `unknown team ${idOrSlug}`);
    return t;
  }

  create(input: { name: string; slug?: string; avatar?: string }, owner?: string): Team {
    let slug = slugify(input.slug ?? input.name);
    if (this.get(slug)) slug = `${slug}-${randomBytes(2).toString("hex")}`;
    const team: Team = { id: newId("team"), name: input.name.trim(), slug, avatar: input.avatar, createdAt: this.k.clock.now().toISOString(), settings: structuredClone(DEFAULT_TEAM_SETTINGS) };
    this.k.store.put(P.teams, team);
    if (owner) this.addMember(team.id, owner, "owner", owner);
    this.k.audit(owner ? (this.k.users.get(owner)?.email ?? owner) : "kiln", "team.created", team.id, { name: team.name });
    return team;
  }

  update(id: string, patch: { name?: string; slug?: string; avatar?: string | null }, by: string): Team {
    const t = this.require(id);
    const next: Team = { ...t };
    if (patch.name) next.name = patch.name.trim();
    if (patch.slug) {
      const slug = slugify(patch.slug);
      const other = this.get(slug);
      if (other && other.id !== t.id) throw new PlatformError(409, `the slug ${slug} is taken`);
      next.slug = slug;
    }
    if (patch.avatar === null) {
      delete next.avatar;
      delete next.avatarKey;
    } else if (patch.avatar !== undefined) {
      next.avatar = patch.avatar;
      delete next.avatarKey;
    }
    this.k.store.put(P.teams, next);
    this.k.audit(by, "team.updated", t.id, patch);
    return next;
  }

  async setAvatar(id: string, bytes: Uint8Array, contentType: string, by: string): Promise<Team> {
    const t = this.require(id);
    const key = avatarKey("teams", t.id, contentType);
    await this.k.objects.put(key, bytes, contentType);
    const next = { ...t, avatarKey: key, avatar: `/api/v1/teams/${t.id}/avatar?v=${Date.now().toString(36)}` };
    this.k.store.put(P.teams, next);
    this.k.audit(by, "team.avatar_changed", t.id);
    return next;
  }

  settings(id: string): TeamSettings {
    return { ...structuredClone(DEFAULT_TEAM_SETTINGS), ...this.require(id).settings };
  }

  updateSettings(id: string, patch: Partial<TeamSettings>, by: string): TeamSettings {
    const t = this.require(id);
    const settings = TeamSettings.parse({ ...this.settings(id), ...patch });
    this.k.store.put(P.teams, { ...t, settings });
    this.k.audit(by, "team.settings_changed", t.id, patch);
    return settings;
  }

  /** The team factories and tokens fall back to. Created on first use; existing factories move into it. */
  ensureDefaultTeam(): Team {
    const team = this.list()[0] ?? this.create({ name: "Default", slug: "default" });
    for (const f of this.k.defs.list()) if (!f.team) this.k.store.put(C.factories, { ...f, team: team.id });
    return team;
  }

  // ---- factories in teams ----

  factoryTeam(factory: string | FactoryBinding | undefined): string | undefined {
    const f = typeof factory === "string" ? this.k.defs.get(factory) : factory;
    if (!f) return undefined;
    return f.team ?? this.ensureDefaultTeam().id;
  }

  factoriesOf(teamId: string): FactoryBinding[] {
    return this.k.defs.list().filter((f) => this.factoryTeam(f) === teamId);
  }

  assignFactory(factory: string, teamId: string, by: string) {
    const f = this.k.defs.require(factory);
    this.require(teamId);
    if (f.team === teamId) return;
    this.k.store.put(C.factories, { ...f, team: teamId });
    this.k.audit(by, "factory.team_assigned", f.id, { team: teamId, from: f.team });
  }

  // ---- memberships ----

  membership(teamId: string, userId: string): Membership | undefined {
    return this.k.store.get<Membership>(P.memberships, `${teamId}:${userId}`);
  }

  role(teamId: string, userId: string): TeamRole | undefined {
    return this.membership(teamId, userId)?.role;
  }

  members(teamId: string): Membership[] {
    return this.k.store.list<Membership>(P.memberships, (m) => m.teamId === teamId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  teamsOf(userId: string): (Team & { role: TeamRole })[] {
    return this.k.store
      .list<Membership>(P.memberships, (m) => m.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .flatMap((m) => {
        const t = this.get(m.teamId);
        return t ? [{ ...t, role: m.role }] : [];
      });
  }

  addMember(teamId: string, userId: string, role: TeamRole, by: string): Membership {
    const existing = this.membership(teamId, userId);
    if (existing) return existing;
    const m: Membership = { id: `${teamId}:${userId}`, teamId, userId, role, createdAt: this.k.clock.now().toISOString() };
    this.k.store.put(P.memberships, m);
    this.k.audit(by, "team.member_added", teamId, { userId, role });
    return m;
  }

  private owners(teamId: string) {
    return this.members(teamId).filter((m) => m.role === "owner");
  }

  /** Only owners grant or take away ownership; a team always keeps one owner. */
  setRole(teamId: string, userId: string, role: TeamRole, actor: { userId?: string; label: string; superuser?: boolean }): Membership {
    const m = this.membership(teamId, userId);
    if (!m) throw new PlatformError(404, "not a member of this team");
    const actorRole = actor.userId ? this.role(teamId, actor.userId) : undefined;
    if ((role === "owner" || m.role === "owner") && actorRole !== "owner" && !actor.superuser) throw new PlatformError(403, "only owners can change ownership");
    if (m.role === "owner" && role !== "owner" && this.owners(teamId).length === 1) throw new PlatformError(409, "a team needs at least one owner");
    const next = { ...m, role };
    this.k.store.put(P.memberships, next);
    this.k.audit(actor.label, "team.member_role_changed", teamId, { userId, from: m.role, to: role });
    return next;
  }

  removeMember(teamId: string, userId: string, actor: { userId?: string; label: string; superuser?: boolean }) {
    const m = this.membership(teamId, userId);
    if (!m) throw new PlatformError(404, "not a member of this team");
    const actorRole = actor.userId ? this.role(teamId, actor.userId) : undefined;
    if (m.role === "owner" && actorRole !== "owner" && !actor.superuser && actor.userId !== userId) throw new PlatformError(403, "only owners can remove an owner");
    if (m.role === "owner" && this.owners(teamId).length === 1) throw new PlatformError(409, "a team needs at least one owner");
    this.k.store.delete(P.memberships, m.id);
    for (const fm of this.k.store.list<FactoryMember>(P.factoryMembers, (x) => x.userId === userId)) {
      if (this.factoryTeam(fm.factory) === teamId) this.k.store.delete(P.factoryMembers, fm.id);
    }
    this.k.audit(actor.label, "team.member_removed", teamId, { userId });
  }

  // ---- invites ----

  invites(teamId: string): (Omit<Invite, "tokenHash"> & { expired: boolean })[] {
    const now = this.k.clock.now().toISOString();
    return this.k.store
      .list<Invite>(P.invites, (i) => i.teamId === teamId && i.status === "pending")
      .map(({ tokenHash: _h, ...i }) => ({ ...i, expired: i.expiresAt <= now }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private inviteLink(token: string) {
    return this.k.link(`/join?invite=${encodeURIComponent(token)}`);
  }

  invite(teamId: string, input: { email: string; role: TeamRole }, by: string): { invite: Omit<Invite, "tokenHash">; token: string; link: string } {
    this.require(teamId);
    const email = input.email.trim().toLowerCase();
    const user = this.k.users.byEmail(email);
    if (user && this.membership(teamId, user.id)) throw new PlatformError(409, `${email} is already a member`);
    for (const old of this.k.store.list<Invite>(P.invites, (i) => i.teamId === teamId && i.email === email && i.status === "pending")) this.k.store.put(P.invites, { ...old, status: "revoked" as const });
    const token = `kinv_${randomBytes(24).toString("base64url")}`;
    const now = this.k.clock.now();
    const invite: Invite = {
      id: newId("inv"),
      teamId,
      email,
      role: input.role,
      tokenHash: hashInvite(token),
      createdBy: by,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(),
      status: "pending",
      sentCount: 1,
      lastSentAt: now.toISOString(),
    };
    this.k.store.put(P.invites, invite);
    this.k.audit(by, "team.invite_created", teamId, { email, role: input.role, invite: invite.id });
    const { tokenHash: _h, ...pub } = invite;
    return { invite: pub, token, link: this.inviteLink(token) };
  }

  /** A fresh token and seven more days; the old link stops working. */
  resend(teamId: string, inviteId: string, by: string) {
    const inv = this.k.store.get<Invite>(P.invites, inviteId);
    if (!inv || inv.teamId !== teamId || inv.status !== "pending") throw new PlatformError(404, "unknown invite");
    const token = `kinv_${randomBytes(24).toString("base64url")}`;
    const now = this.k.clock.now();
    const next: Invite = { ...inv, tokenHash: hashInvite(token), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(), sentCount: inv.sentCount + 1, lastSentAt: now.toISOString() };
    this.k.store.put(P.invites, next);
    this.k.audit(by, "team.invite_resent", teamId, { invite: inviteId });
    const { tokenHash: _h, ...pub } = next;
    return { invite: pub, token, link: this.inviteLink(token) };
  }

  revoke(teamId: string, inviteId: string, by: string) {
    const inv = this.k.store.get<Invite>(P.invites, inviteId);
    if (!inv || inv.teamId !== teamId) throw new PlatformError(404, "unknown invite");
    this.k.store.put(P.invites, { ...inv, status: "revoked" as const });
    this.k.audit(by, "team.invite_revoked", teamId, { invite: inviteId });
  }

  /** The pending, unexpired invite behind a token. */
  findInvite(token: string): Invite {
    const hash = hashInvite(token);
    const inv = this.k.store.list<Invite>(P.invites, (i) => i.tokenHash === hash)[0];
    if (!inv || inv.status !== "pending") throw new PlatformError(404, "this invite is not valid");
    if (inv.expiresAt <= this.k.clock.now().toISOString()) throw new PlatformError(410, "this invite has expired");
    return inv;
  }

  previewInvite(token: string) {
    const inv = this.findInvite(token);
    const team = this.require(inv.teamId);
    return { team: { id: team.id, name: team.name, slug: team.slug, avatar: team.avatar }, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
  }

  accept(token: string, userId: string): Membership {
    const inv = this.findInvite(token);
    const user = this.k.users.require(userId);
    const m = this.membership(inv.teamId, userId) ?? this.addMember(inv.teamId, userId, inv.role, user.email);
    this.k.store.put(P.invites, { ...inv, status: "accepted" as const, acceptedBy: userId, acceptedAt: this.k.clock.now().toISOString() });
    this.k.audit(user.email, "team.invite_accepted", inv.teamId, { invite: inv.id, invitedEmail: inv.email });
    return m;
  }

  // ---- factory roles ----

  factoryMembers(factory: string): FactoryMember[] {
    return this.k.store.list<FactoryMember>(P.factoryMembers, (m) => m.factory === factory).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  setFactoryMember(factory: string, userId: string, role: FactoryRole, by: string): FactoryMember {
    const team = this.factoryTeam(factory);
    if (!team) throw new PlatformError(404, `unknown factory ${factory}`);
    if (!this.membership(team, userId)) throw new PlatformError(400, "add the user to the factory's team first");
    const id = `${factory}:${userId}`;
    const existing = this.k.store.get<FactoryMember>(P.factoryMembers, id);
    const m: FactoryMember = { id, factory, userId, role, addedBy: existing?.addedBy ?? by, createdAt: existing?.createdAt ?? this.k.clock.now().toISOString() };
    this.k.store.put(P.factoryMembers, m);
    this.k.audit(by, existing ? "factory.member_role_changed" : "factory.member_added", factory, { userId, role, from: existing?.role });
    return m;
  }

  removeFactoryMember(factory: string, userId: string, by: string) {
    if (!this.k.store.delete(P.factoryMembers, `${factory}:${userId}`)) throw new PlatformError(404, "not a member of this factory");
    this.k.audit(by, "factory.member_removed", factory, { userId });
  }

  /** The user's effective role on a factory: team owners and admins are always Admin. */
  factoryRole(userId: string, factory: string): FactoryRole | undefined {
    const f = this.k.defs.get(factory);
    if (!f) return undefined;
    const team = this.factoryTeam(f)!;
    const teamRole = this.role(team, userId);
    if (!teamRole) return undefined;
    if (isTeamAdmin(teamRole)) return "admin";
    const settings = this.settings(team);
    const base = settings.defaultFactoryRole === "none" ? undefined : settings.defaultFactoryRole;
    return maxFactoryRole(base, this.k.store.get<FactoryMember>(P.factoryMembers, `${f.id}:${userId}`)?.role);
  }

  factoryRoles(userId: string): Record<string, FactoryRole> {
    const out: Record<string, FactoryRole> = {};
    for (const f of this.k.defs.list()) {
      const r = this.factoryRole(userId, f.id);
      if (r) out[f.id] = r;
    }
    return out;
  }

  /** Grants computed at request time from memberships, so every scope check keeps working. */
  grantsFor(userId: string): Grant[] {
    return Object.entries(this.factoryRoles(userId)).flatMap(([factory, role]) => grantsForFactoryRole(role, factory));
  }

  /** Agent keys act for the team: read and send on its factories, never decide or merge. */
  agentGrants(teamId: string): Grant[] {
    return this.factoriesOf(teamId).flatMap((f) => [
      { scope: "read" as const, factory: f.id },
      { scope: "send" as const, factory: f.id },
    ]);
  }
}
