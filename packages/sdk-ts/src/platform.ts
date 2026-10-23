import type {
  Appearance,
  CredentialStatus,
  PoolEntry,
  ChatgptSignInState as ChatgptSignIn,
  DigestPrefs,
  EnvironmentTemplate,
  FactoryMember,
  Invite,
  LinkedAccount,
  LinkProvider,
  McpServer,
  Membership,
  NotificationPrefs,
  NotificationRecord,
  PublicUser,
  SecretMeta,
  SecretType,
  Team,
  TeamSettings,
  UsageEntry,
  UsageSummary,
  ResolvedVariableView,
  VariableInput,
  VariableLayerView,
  VariableScope,
} from "@kiln/engine";

export type { Appearance, ChatgptSignIn, CredentialStatus, PoolEntry, DigestPrefs, EnvironmentTemplate, FactoryMember, Invite, LinkedAccount, LinkProvider, McpServer, Membership, NotificationPrefs, NotificationRecord, PublicUser, SecretMeta, SecretType, TeamSettings, UsageEntry, UsageSummary, ResolvedVariableView, VariableInput, VariableLayerView, VariableScope };

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
  /** Listed in KILN_ADMIN_EMAILS (or the bootstrap admin): sees the server page. */
  serverAdmin?: boolean;
  factoryRoles: Record<string, FactoryRole>;
};
export type ServerStats = {
  at: string;
  host: { hostname: string; cpus: number; loadAverage: number[]; uptimeSeconds: number; totalMemoryBytes: number; freeMemoryBytes: number };
  disks: { path: string; totalBytes: number; freeBytes: number }[];
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; node: string };
  sandboxes: { name: string; provider: string; state: string; live: boolean; owner?: string; studioApp?: string; createdAt?: string; cpuPercent?: number; memoryBytes?: number }[];
  sandboxErrors: { provider: string; error: string }[];
  runs: { running: number; queued: number };
  workers: { id: string; workerId: string; backend: string; active: number; maxConcurrent: number; stale: boolean }[];
};
export type CleanupItem = { id: string; name: string; createdAt?: string; sizeBytes?: number; reason: string };
export type DockerUsageRow = { type: string; count: number; sizeBytes: number; reclaimableBytes: number };
export type CleanupRun = { at: string; removed: { containers: string[]; images: string[] }; failed: string[]; before: DockerUsageRow[]; after: DockerUsageRow[]; reclaimedBytes: number };
export type CleanupStatus = {
  available: boolean;
  scheduled: boolean;
  lastRun?: CleanupRun & { by: string };
  /** A Docker command that failed; the rest of the status is still shown. */
  error?: string;
  usage?: DockerUsageRow[];
  plan?: { project?: string; containers: CleanupItem[]; images: CleanupItem[]; buildCache: { olderThanHours: number; keepBytes: number }; volumes: { name: string; inUse: boolean }[] };
};
export type TeamDetail = TeamSummary & { settings: TeamSettings; members: number; factories: { id: string; name: string; alias: string }[] };
export type TeamMemberRow = { userId: string; role: TeamRole; joinedAt: string; user?: { id: string; name: string; email: string; avatar?: string } };
export type InviteRow = Omit<Invite, "tokenHash"> & { expired?: boolean };
export type IssuedInvite = { invite: InviteRow; token: string; link: string };
export type FactoryMemberRow = { userId: string; role: FactoryRole; source: "team" | "factory" | "default"; teamRole: TeamRole; user?: { id: string; name: string; email: string; avatar?: string } };
export type ApiKeyRow = { id: string; name: string; subject: string; type?: string; userId?: string; teamId?: string; createdAt: string; expiresAt?: string; lastUsedAt?: string; revoked?: boolean };
export type ModelKeyProvider = "anthropic" | "openai" | "openrouter" | "bedrock";
export type BuiltinMcpRow = { kiln_id: string; name: string; description: string; connected: boolean; missing: string[] };
/** One server's test result; `untested` for command servers, which only start in a run's sandbox. */
export type McpTestResult = { name: string; status: "ok" | "error" | "untested"; tools?: string[]; message: string; agents?: string[] };
export type McpServerInput = { name: string; description?: string; mode?: "managed" | "direct"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; allAgents?: boolean };
export type EnvironmentInput = { name: string; description?: string; image?: string; repos?: { owner: string; name: string }[]; setupCommands?: string[]; secrets?: string[]; registryCredentialSecretName?: string };
