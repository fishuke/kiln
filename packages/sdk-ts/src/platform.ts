import type {
  Appearance,
  EnvironmentTemplate,
  FactoryMember,
  Invite,
  LinkedAccount,
  LinkProvider,
  McpServer,
  Membership,
  NotificationPrefs,
  PublicUser,
  SecretMeta,
  SecretType,
  Team,
  TeamSettings,
  UsageEntry,
  UsageSummary,
} from "@kiln/engine";

export type { Appearance, EnvironmentTemplate, FactoryMember, Invite, LinkedAccount, LinkProvider, McpServer, Membership, NotificationPrefs, PublicUser, SecretMeta, SecretType, TeamSettings, UsageEntry, UsageSummary };

export type TeamRole = "owner" | "admin" | "member";
export type FactoryRole = "user" | "editor" | "admin";
export type TeamSummary = Omit<Team, "settings" | "avatarKey"> & { role?: TeamRole };
export type Session = { token: string; expiresAt?: string; user: PublicUser; teams: { id: string; name: string; slug: string; role: TeamRole }[] };
export type Me = {
  subject: string;
  name: string;
  grants: { scope: string; factory: string }[];
  tokenType: string;
  user?: PublicUser;
  teams: TeamSummary[];
  currentTeam?: { id: string; name: string; slug: string; avatar?: string };
  role?: TeamRole;
  factoryRoles: Record<string, FactoryRole>;
};
export type TeamDetail = TeamSummary & { settings: TeamSettings; members: number; factories: { id: string; name: string; alias: string }[] };
export type TeamMemberRow = { userId: string; role: TeamRole; joinedAt: string; user?: { id: string; name: string; email: string; avatar?: string } };
export type InviteRow = Omit<Invite, "tokenHash"> & { expired?: boolean };
export type IssuedInvite = { invite: InviteRow; token: string; link: string };
export type FactoryMemberRow = { userId: string; role: FactoryRole; source: "team" | "factory" | "default"; teamRole: TeamRole; user?: { id: string; name: string; email: string; avatar?: string } };
export type ApiKeyRow = { id: string; name: string; subject: string; type?: string; userId?: string; teamId?: string; createdAt: string; expiresAt?: string; lastUsedAt?: string; revoked?: boolean };
export type ModelKeyProvider = "anthropic" | "openai" | "openrouter" | "bedrock";
export type BuiltinMcpRow = { kiln_id: string; name: string; description: string; connected: boolean; missing: string[] };
export type McpServerInput = { name: string; description?: string; mode?: "managed" | "direct"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
export type EnvironmentInput = { name: string; description?: string; image?: string; repos?: { owner: string; name: string }[]; setupCommands?: string[]; secrets?: string[] };
