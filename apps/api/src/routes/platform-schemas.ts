import { KEY_EXPIRY, MIN_PASSWORD_LENGTH, TEAM_ROLES, FACTORY_ROLES } from "@kiln/auth";
import { Appearance, DigestPrefs, NOTIFY_KINDS, LINK_PROVIDERS, NOTIFY_CHANNELS, SECRET_TYPES, TeamSettings } from "@kiln/engine";
import { z } from "zod";

const email = z.string().trim().email();
const password = z.string().min(MIN_PASSWORD_LENGTH).max(200);
const avatar = z.string().url().max(2000).nullable();
const envMap = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string());

export const Signup = z.object({ name: z.string().trim().min(1).max(100).optional(), email, password, invite: z.string().optional() }).strict();
export const Login = z.object({ email, password: z.string().min(1) }).strict();
export const ChangePassword = z.object({ current: z.string().optional(), next: password }).strict();

const channelPrefs = z.object(Object.fromEntries(NOTIFY_CHANNELS.map((c) => [c, z.boolean()])) as Record<(typeof NOTIFY_CHANNELS)[number], z.ZodBoolean>).strict();
export const UpdateMe = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: email.optional(),
    avatar: avatar.optional(),
    appearance: Appearance.optional(),
    digest: DigestPrefs.partial().optional(),
    notifications: z.object(Object.fromEntries(NOTIFY_KINDS.map((k) => [k, channelPrefs.optional()])) as Record<(typeof NOTIFY_KINDS)[number], z.ZodOptional<typeof channelPrefs>>).strict().optional(),
  })
  .strict();
export const LinkAccount = z.object({ provider: z.enum(LINK_PROVIDERS), externalId: z.string().trim().min(1).max(200), handle: z.string().trim().max(200).optional() }).strict();

export const ApiKey = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(["personal", "agent", "worker"]).default("personal"),
    expiresIn: z.enum(Object.keys(KEY_EXPIRY) as [keyof typeof KEY_EXPIRY, ...(keyof typeof KEY_EXPIRY)[]]).default("30d"),
  })
  .strict();

export const CreateTeam = z.object({ name: z.string().trim().min(1).max(100), slug: z.string().trim().min(1).max(40).optional() }).strict();
export const UpdateTeam = z.object({ name: z.string().trim().min(1).max(100).optional(), slug: z.string().trim().min(1).max(40).optional(), avatar: avatar.optional() }).strict();
export const MemberRole = z.object({ role: z.enum(TEAM_ROLES) }).strict();
export const CreateInvite = z.object({ email, role: z.enum(TEAM_ROLES).default("member") }).strict();
export const AcceptInvite = z.object({ token: z.string().min(1) }).strict();
export const TeamSettingsPatch = TeamSettings.partial();
export const ChatgptSignIn = z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "use letters, digits and underscores"), scope: z.enum(["team", "personal"]).default("team") }).strict();
export const ModelKey = z.object({ value: z.union([z.string().min(1), z.record(z.string(), z.string())]) }).strict();

export const FactoryMemberInput = z
  .object({ userId: z.string().optional(), email: email.optional(), role: z.enum(FACTORY_ROLES) })
  .strict()
  .refine((m) => Boolean(m.userId) !== Boolean(m.email), { message: "give exactly one of userId or email" });
export const FactoryRoleInput = z.object({ role: z.enum(FACTORY_ROLES) }).strict();

export const CreateSecret = z
  .object({
    scope: z.enum(["team", "personal"]).default("team"),
    name: z.string().min(1).max(128),
    type: z.enum(SECRET_TYPES).default("raw"),
    value: z.unknown(),
    description: z.string().max(500).optional(),
  })
  .strict();
export const UpdateSecret = z.object({ value: z.unknown().optional(), description: z.string().max(500).optional() }).strict();

const mcpShape = {
  description: z.string().max(500).optional(),
  mode: z.enum(["managed", "direct"]).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: envMap.optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
};
export const CreateMcpServer = z.object({ name: z.string().min(1).max(63), ...mcpShape }).strict();
export const UpdateMcpServer = z.object({ name: z.string().min(1).max(63).optional(), ...mcpShape }).strict();
export const TestMcpServers = z.object({ factory: z.string().min(1).optional(), agent: z.string().min(1).optional(), servers: z.array(z.string().min(1)).max(50).optional() }).strict();

const envShape = {
  description: z.string().max(500).optional(),
  image: z.string().min(1).optional(),
  repos: z.array(z.object({ owner: z.string().min(1), name: z.string().min(1) }).strict()).optional(),
  setupCommands: z.array(z.string().min(1)).optional(),
  secrets: z.array(z.string().min(1)).optional(),
  registryCredentialSecretName: z.string().min(1).optional(),
};
export const CreateEnvironment = z.object({ name: z.string().trim().min(1).max(100), ...envShape }).strict();
export const UpdateEnvironment = z.object({ name: z.string().trim().min(1).max(100).optional(), ...envShape }).strict();
