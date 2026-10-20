import type { Grant, Scope } from "./index";

/** Roles inside a team. Owners and admins manage the team and are Admin on every factory in it. */
export const TEAM_ROLES = ["owner", "admin", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * Roles on one factory.
 * - user: view, run work, decide spec/preview/question gates, propose definition changes (memories)
 * - editor: edit the definition, agents, repos, automations; attach secrets, MCPs, runners; confirm merges
 * - admin: everything, including members and deleting the factory
 */
export const FACTORY_ROLES = ["user", "editor", "admin"] as const;
export type FactoryRole = (typeof FACTORY_ROLES)[number];

export const FACTORY_ROLE_SCOPES: Record<FactoryRole, Scope[]> = {
  user: ["read", "send", "decide:spec", "decide:preview", "decide:question"],
  editor: ["read", "send", "decide:spec", "decide:preview", "decide:question", "decide:merge", "definitions:write"],
  admin: ["admin"],
};

const RANK: Record<FactoryRole, number> = { user: 1, editor: 2, admin: 3 };

export function maxFactoryRole(...roles: (FactoryRole | undefined)[]): FactoryRole | undefined {
  return roles.filter((r): r is FactoryRole => Boolean(r)).sort((a, b) => RANK[b] - RANK[a])[0];
}

export function grantsForFactoryRole(role: FactoryRole, factory: string): Grant[] {
  return FACTORY_ROLE_SCOPES[role].map((scope) => ({ scope, factory }));
}

export function isTeamAdmin(role: TeamRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Team-wide checks (factory "*", or a factory that does not exist yet): owners and admins may do
 * anything in their team, members may read and send.
 */
export function teamRoleAllows(role: TeamRole | undefined, scope: Scope): boolean {
  if (!role) return false;
  if (isTeamAdmin(role)) return true;
  return scope === "read" || scope === "send";
}

/** API key lifetimes offered in user settings. */
export const KEY_EXPIRY = { "1d": 24, "30d": 24 * 30, "90d": 24 * 90, never: undefined } as const;
export type KeyExpiry = keyof typeof KEY_EXPIRY;
