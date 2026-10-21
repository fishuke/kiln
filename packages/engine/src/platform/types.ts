import type { FactoryRole, TeamRole } from "@kiln/auth";
import { z } from "zod";

/** Store collections of the platform layer. */
export const P = {
  users: "users",
  teams: "teams",
  memberships: "team_memberships",
  invites: "team_invites",
  factoryMembers: "factory_members",
  secrets: "managed_secrets",
  mcpServers: "mcp_servers",
  environments: "environments",
  oauthStates: "oauth_states",
} as const;

export const LINK_PROVIDERS = ["github", "slack", "discord", "linear", "jira", "teams", "gitlab", "azure_devops"] as const;
export type LinkProvider = (typeof LINK_PROVIDERS)[number];

/** What people are notified about: the gate kinds (merge is the PR review), plus work that is blocked or failed. */
export const NOTIFY_KINDS = ["spec", "preview", "question", "merge", "custom", "blocked", "failed"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export const NOTIFY_CHANNELS = ["email", "slack", "discord"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export type NotificationPrefs = Record<NotifyKind, Record<NotifyChannel, boolean>>;

/** A daily summary of open decisions. With `only`, nothing is sent right away. */
export const DigestPrefs = z
  .object({ daily: z.boolean(), hourUtc: z.number().int().min(0).max(23), channels: z.array(z.enum(NOTIFY_CHANNELS)).min(1), only: z.boolean() })
  .strict();
export type DigestPrefs = z.infer<typeof DigestPrefs>;
export const DEFAULT_DIGEST: DigestPrefs = { daily: false, hourUtc: 8, channels: ["email"], only: false };

export const Appearance = z.enum(["light", "dark", "system"]);
export type Appearance = z.infer<typeof Appearance>;

export type LinkedAccount = { provider: LinkProvider; externalId: string; handle?: string; linkedAt: string };

export type User = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  avatarKey?: string;
  createdAt: string;
  passwordHash?: string;
  appearance: Appearance;
  notifications: NotificationPrefs;
  digest?: DigestPrefs;
  linkedAccounts: LinkedAccount[];
};

/** A user as the API returns it: no password hash. */
export type PublicUser = Omit<User, "passwordHash" | "avatarKey"> & { hasPassword: boolean };

export const StorageTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), path: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal("s3"),
      bucket: z.string().min(1),
      region: z.string().min(1),
      endpoint: z.string().url().optional(),
      prefix: z.string().optional(),
      /** Names of team secrets holding the access key id and secret (omit to use the server's role). */
      accessKeyIdSecret: z.string().optional(),
      secretAccessKeySecret: z.string().optional(),
      forcePathStyle: z.boolean().optional(),
    })
    .strict(),
]);
export type StorageTarget = z.infer<typeof StorageTarget>;

export const TeamSettings = z
  .object({
    spendLimit: z.object({ monthlyUsd: z.number().min(0), autoStop: z.boolean() }).strict(),
    githubOrgs: z.array(z.string().min(1)),
    defaultSandboxHost: z.string().optional(),
    egressAllowlist: z.array(z.string().min(1)),
    storage: z.object({ artifacts: StorageTarget, transcripts: StorageTarget, attachments: StorageTarget }).strict(),
    /** The role every team member has on the team's factories unless a factory membership gives more. */
    defaultFactoryRole: z.enum(["none", "user", "editor"]),
  })
  .strict();
export type TeamSettings = z.infer<typeof TeamSettings>;

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  spendLimit: { monthlyUsd: 200, autoStop: false },
  githubOrgs: [],
  egressAllowlist: [],
  storage: { artifacts: { kind: "local" }, transcripts: { kind: "local" }, attachments: { kind: "local" } },
  defaultFactoryRole: "user",
};

export type Team = { id: string; name: string; slug: string; avatar?: string; avatarKey?: string; createdAt: string; settings: TeamSettings };

export type Membership = { id: string; teamId: string; userId: string; role: TeamRole; createdAt: string };

export type Invite = {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked";
  sentCount: number;
  lastSentAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
};

export type FactoryMember = { id: string; factory: string; userId: string; role: FactoryRole; addedBy: string; createdAt: string };

/** Typed secrets. Raw values become an env var named after the secret; harness credentials map to their provider's variables. */
export const SECRET_TYPES = [
  "raw",
  "docker_registry",
  "aws_ecr",
  "anthropic_api_key",
  "claude_oauth_token",
  "chatgpt_auth",
  "anthropic_bedrock_api_key",
  "anthropic_bedrock_access_key",
  "openai_api_key",
  "openrouter_api_key",
  "google_api_key",
] as const;
export type SecretType = (typeof SECRET_TYPES)[number];

export type ManagedSecret = {
  id: string;
  scope: "team" | "personal";
  /** Team id for team secrets, user id for personal ones. */
  owner: string;
  name: string;
  type: SecretType;
  description?: string;
  /** Sealed value; never returned by the API. */
  value: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};

export type SecretMeta = Omit<ManagedSecret, "value">;

export const BUILTIN_MCP = ["linear", "slack", "jira", "github", "discord"] as const;
export type BuiltinMcp = (typeof BUILTIN_MCP)[number];

export type McpServer = {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  /** managed: Kiln resolves secrets and connects; direct: the sandbox connects with the config as written. */
  mode: "managed" | "direct";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Every agent in the team's factories gets this server, on top of the ones it lists. */
  allAgents?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EnvironmentTemplate = {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  image?: string;
  repos: { owner: string; name: string }[];
  setupCommands: string[];
  secrets: string[];
  /** A team secret (docker_registry or aws_ecr) for pulling `image`. */
  registryCredentialSecretName?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

/** Object-store key for an uploaded avatar; the extension carries the content type. */
export function avatarKey(kind: "users" | "teams", id: string, contentType: string): string {
  return `avatars/${kind}/${id}.${IMAGE_EXT[contentType] ?? "bin"}`;
}

export function avatarContentType(key: string): string {
  const ext = key.split(".").pop();
  return Object.entries(IMAGE_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}

export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  constructor(
    readonly limitUsd: number,
    readonly spentUsd: number,
  ) {
    super(`Monthly spending budget of $${limitUsd} has been reached ($${spentUsd.toFixed(2)} spent)`);
  }
}

export class PlatformError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410,
    message: string,
  ) {
    super(message);
  }
}
