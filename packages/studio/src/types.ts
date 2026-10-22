import { HarnessType } from "@kiln/schema";
import { z } from "zod";

/** When a chat's work reaches the app's main line (ADR-012). Forge behavior per mode is not built yet. */
export const ShipMode = z.enum(["safe", "review", "cowboy"]);
export type ShipMode = z.infer<typeof ShipMode>;

/** What the agent may do in a turn. Modes are permissions, not versioning rules. */
export const ChatMode = z.enum(["build", "chat", "plan"]);
export type ChatMode = z.infer<typeof ChatMode>;

export const Priority = z.enum(["needs_you", "finished", "progress"]);
export type Priority = z.infer<typeof Priority>;

export const AppStatus = z.enum(["creating", "ready", "paused", "failed"]);
export type AppStatus = z.infer<typeof AppStatus>;

export const ChatStatus = z.enum(["idle", "working", "needs_you", "conflict", "failed"]);
export type ChatStatus = z.infer<typeof ChatStatus>;

export const TurnStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

export const VersionKind = z.enum(["initial", "apply", "restore"]);
export type VersionKind = z.infer<typeof VersionKind>;

export const Via = z.enum(["web", "mcp", "api", "voice"]);
export type Via = z.infer<typeof Via>;

export const SnapshotRefSchema = z.object({
  key: z.string(),
  provider: z.string(),
  sandboxId: z.string(),
  createdAt: z.string(),
  workspaceSha: z.string(),
  processState: z.boolean(),
});

export const TemplateSource = z.object({ kind: z.literal("template"), template: z.string().min(1) });
/** `repo` is "owner/name"; `connection` defaults to the server's forge. */
export const RepoSource = z.object({
  kind: z.literal("repo"),
  connection: z.string().optional(),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "a repository as owner/name"),
  branch: z.string().min(1).optional(),
});
export type RepoSource = z.infer<typeof RepoSource>;
export const AppSource = z.discriminatedUnion("kind", [TemplateSource, RepoSource]);
export type AppSource = z.infer<typeof AppSource>;

export const PackageManager = z.enum(["pnpm", "npm", "yarn", "bun"]);
export type PackageManager = z.infer<typeof PackageManager>;

/** What Studio detected when it created the workspace. */
export const AppSetup = z.object({
  mainBranch: z.string(),
  packageManager: PackageManager,
  install: z.array(z.string()),
  dev: z.string().optional(),
  devDetected: z.string().optional(),
  devOverride: z.string().optional(),
  envRequired: z.array(z.string()),
  envMissing: z.array(z.string()),
});
export type AppSetup = z.infer<typeof AppSetup>;

export const App = z.object({
  id: z.string(),
  team: z.string(),
  /** The Kiln Project this App belongs to, if any. An App needs no factory. */
  projectId: z.string().optional(),
  name: z.string(),
  source: AppSource,
  setup: AppSetup.optional(),
  shipMode: ShipMode,
  harness: HarnessType,
  model: z.string().optional(),
  status: AppStatus,
  error: z.string().optional(),
  snapshot: SnapshotRefSchema.optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type App = z.infer<typeof App>;

export const Chat = z.object({
  id: z.string(),
  appId: z.string(),
  title: z.string(),
  /** The App agent the chat runs (`general` unless named). */
  agent: z.string(),
  /** The chat's latest run; a person's next message follows up on it. */
  runId: z.string().optional(),
  /** For a chat an agent started: the run that spawned it. */
  parentRunId: z.string().optional(),
  mode: ChatMode,
  harness: HarnessType,
  model: z.string().optional(),
  branch: z.string(),
  path: z.string(),
  port: z.number().int(),
  status: ChatStatus,
  question: z.string().optional(),
  appliedSha: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Chat = z.infer<typeof Chat>;

export const Activity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("reasoning"), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("tool"), name: z.string(), text: z.string().optional(), at: z.string() }),
  z.object({ kind: z.literal("subagent"), name: z.string(), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("error"), text: z.string(), at: z.string() }),
]);
export type Activity = z.infer<typeof Activity>;

export const Turn = z.object({
  id: z.string(),
  appId: z.string(),
  chatId: z.string(),
  /** The run this turn is (set once the run has its workspace). */
  runId: z.string().optional(),
  prompt: z.string(),
  mode: ChatMode,
  via: Via,
  by: z.string(),
  status: TurnStatus,
  reply: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  question: z.string().optional(),
  plan: z.string().optional(),
  checkpoint: z.string().optional(),
  discarded: z.boolean(),
  resolve: z.boolean().optional(),
  activity: z.array(Activity),
  costUsd: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type Turn = z.infer<typeof Turn>;

export const Version = z.object({
  id: z.string(),
  appId: z.string(),
  sha: z.string(),
  title: z.string(),
  kind: VersionKind,
  chatId: z.string().optional(),
  restoredFrom: z.string().optional(),
  bookmarked: z.boolean(),
  createdAt: z.string(),
});
export type Version = z.infer<typeof Version>;

export const Preview = z.object({ target: z.string(), url: z.string(), status: z.enum(["starting", "ready", "failed"]) });
export type Preview = z.infer<typeof Preview>;

export type StatusReport = {
  apps: { id: string; name: string; working: string[]; needsYou: { chatId: string; question: string }[]; latest?: { title: string; at: string } }[];
};

export type ApplyResult = { ok: true; version: Version } | { ok: false; conflict: string[] } | { ok: false; nothing: true };

/** Store collections; runtime state only. Code lives in the app's Git repository. */
export const COLLECTIONS = { apps: "studio_apps", chats: "studio_chats", turns: "studio_turns", versions: "studio_versions" } as const;

export type StudioErrorCode = "not_found" | "invalid" | "busy" | "conflict" | "unavailable";

export class StudioError extends Error {
  constructor(
    readonly code: StudioErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}
