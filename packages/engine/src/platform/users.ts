import { hashPassword, verifyPassword } from "@kiln/auth";
import type { Kiln } from "../kiln";
import { newId } from "../types";
import { INBOX_KINDS, P, PlatformError, type Appearance, type LinkProvider, type NotificationPrefs, type PublicUser, type User } from "./types";

export const DEV_USER_EMAIL = "dev@kiln.local";

export function defaultNotifications(): NotificationPrefs {
  return Object.fromEntries(INBOX_KINDS.map((k) => [k, { email: true, slack: true, discord: false }])) as NotificationPrefs;
}

export function publicUser(u: User): PublicUser {
  const { passwordHash, avatarKey: _k, ...rest } = u;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

const normalize = (email: string) => email.trim().toLowerCase();

/** People: accounts, passwords, profile, preferences and linked identities on other systems. */
export class UserService {
  constructor(private readonly k: Kiln) {}

  get(id: string): User | undefined {
    return this.k.store.get<User>(P.users, id);
  }

  require(id: string): User {
    const u = this.get(id);
    if (!u) throw new PlatformError(404, `unknown user ${id}`);
    return u;
  }

  list(): User[] {
    return this.k.store.list<User>(P.users).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  byEmail(email: string): User | undefined {
    const e = normalize(email);
    return this.k.store.list<User>(P.users, (u) => u.email === e)[0];
  }

  create(input: { name?: string; email: string; password?: string; avatar?: string }): User {
    const email = normalize(input.email);
    if (this.byEmail(email)) throw new PlatformError(409, `an account for ${email} already exists`);
    const user: User = {
      id: newId("usr"),
      name: input.name?.trim() || email.split("@")[0]!,
      email,
      avatar: input.avatar,
      createdAt: this.k.clock.now().toISOString(),
      passwordHash: input.password ? hashPassword(input.password) : undefined,
      appearance: "system",
      notifications: defaultNotifications(),
      linkedAccounts: [],
    };
    this.k.store.put(P.users, user);
    this.k.audit(email, "user.created", user.id);
    return user;
  }

  authenticate(email: string, password: string): User | undefined {
    const u = this.byEmail(email);
    return u && verifyPassword(password, u.passwordHash) ? u : undefined;
  }

  setPassword(id: string, next: string, current?: string) {
    const u = this.require(id);
    if (u.passwordHash && !verifyPassword(current ?? "", u.passwordHash)) throw new PlatformError(403, "the current password is wrong");
    this.k.store.put(P.users, { ...u, passwordHash: hashPassword(next) });
    this.k.audit(u.email, "user.password_changed", u.id);
  }

  update(id: string, patch: { name?: string; email?: string; avatar?: string | null; appearance?: Appearance; notifications?: Partial<NotificationPrefs> }): User {
    const u = this.require(id);
    const next: User = { ...u };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.email !== undefined) {
      const email = normalize(patch.email);
      const other = this.byEmail(email);
      if (other && other.id !== id) throw new PlatformError(409, `${email} belongs to another account`);
      next.email = email;
    }
    if (patch.avatar === null) {
      delete next.avatar;
      delete next.avatarKey;
    } else if (patch.avatar !== undefined) {
      next.avatar = patch.avatar;
      delete next.avatarKey;
    }
    if (patch.appearance) next.appearance = patch.appearance;
    if (patch.notifications) next.notifications = { ...u.notifications, ...patch.notifications };
    this.k.store.put(P.users, next);
    if (patch.email !== undefined && next.email !== u.email) this.k.audit(u.email, "user.email_changed", id, { from: u.email, to: next.email });
    return next;
  }

  async setAvatar(id: string, bytes: Uint8Array, contentType: string): Promise<User> {
    const u = this.require(id);
    const key = `avatars/users/${id}`;
    await this.k.objects.put(key, bytes, contentType);
    const next = { ...u, avatarKey: key, avatar: `/api/v1/users/${id}/avatar?v=${Date.now().toString(36)}` };
    this.k.store.put(P.users, next);
    return next;
  }

  // ---- linked accounts (identity mapping) ----

  link(id: string, provider: LinkProvider, externalId: string, handle?: string): User {
    const u = this.require(id);
    const taken = this.byIdentity(provider, externalId);
    if (taken && taken.id !== id) throw new PlatformError(409, `that ${provider} account is linked to another user`);
    const linkedAccounts = [...u.linkedAccounts.filter((a) => a.provider !== provider), { provider, externalId, handle, linkedAt: this.k.clock.now().toISOString() }];
    const next = { ...u, linkedAccounts };
    this.k.store.put(P.users, next);
    this.k.audit(u.email, "user.account_linked", id, { provider, externalId });
    return next;
  }

  unlink(id: string, provider: LinkProvider): User {
    const u = this.require(id);
    const next = { ...u, linkedAccounts: u.linkedAccounts.filter((a) => a.provider !== provider) };
    this.k.store.put(P.users, next);
    this.k.audit(u.email, "user.account_unlinked", id, { provider });
    return next;
  }

  byIdentity(provider: string, externalId: string): User | undefined {
    const ext = externalId.toLowerCase();
    return this.k.store.list<User>(P.users, (u) => u.linkedAccounts.some((a) => a.provider === provider && (a.externalId.toLowerCase() === ext || a.handle?.toLowerCase() === ext)))[0];
  }

  /**
   * Who a provider identity is: a linked account first, then the static `identities` option, then
   * an email match (Linear and Jira send emails). Falls back to the raw value.
   */
  resolveIdentity(provider: string, raw: string): string {
    const linked = this.byIdentity(provider, raw);
    if (linked) return linked.email;
    const mapped = this.k.options.identities?.[`${provider}:${raw}`];
    if (mapped) return mapped;
    if (raw.includes("@")) return this.byEmail(raw)?.email ?? raw;
    return raw;
  }

  /** The user behind a work item requester (an email or a resolved identity), if there is one. */
  forRequester(requester: string | undefined): User | undefined {
    if (!requester) return undefined;
    return requester.includes("@") ? this.byEmail(requester) : undefined;
  }

  /** Local development: the seeded owner every dev-auth request acts as. */
  ensureDevUser(): User {
    const existing = this.byEmail(DEV_USER_EMAIL);
    const user = existing ?? this.create({ name: "Dev", email: DEV_USER_EMAIL });
    const team = this.k.teams.ensureDefaultTeam();
    if (!this.k.teams.membership(team.id, user.id)) this.k.teams.addMember(team.id, user.id, "owner", "kiln");
    return user;
  }
}
