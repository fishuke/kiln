/**
 * Studio types as the web page sees them: the shapes in docs/specs/studio.md, re-declared so the
 * page doesn't depend on packages/studio. Every API response is parsed with these schemas.
 */
import { z } from "zod";

export const ShipMode = z.enum(["safe", "review", "cowboy"]);
export type ShipMode = z.infer<typeof ShipMode>;
export const ChatMode = z.enum(["build", "chat", "plan"]);
export type ChatMode = z.infer<typeof ChatMode>;
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
export const HarnessType = z.string();

/** Where an app's code came from: a template, or an existing repository on a connected forge. */
export const AppSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), template: z.string() }),
  z.object({ kind: z.literal("repo"), connection: z.string().optional(), repo: z.string(), branch: z.string().optional() }),
]);
export type AppSource = z.infer<typeof AppSource>;

/** What Studio detected when it created the workspace. */
export const AppSetup = z.object({
  mainBranch: z.string(),
  packageManager: z.enum(["pnpm", "npm", "yarn", "bun"]),
  install: z.array(z.string()),
  dev: z.string().optional(),
  devDetected: z.string().optional(),
  devOverride: z.string().optional(),
  envRequired: z.array(z.string()),
  envMissing: z.array(z.string()),
});
export type AppSetup = z.infer<typeof AppSetup>;

/** A Studio App: one repository in one sandbox. (Kiln Projects group factories; an App may belong to one.) */
export const StudioApp = z.object({
  id: z.string(),
  team: z.string(),
  projectId: z.string().optional(),
  name: z.string(),
  source: AppSource,
  setup: AppSetup.optional(),
  shipMode: ShipMode,
  harness: HarnessType,
  model: z.string().optional(),
  status: AppStatus,
  error: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudioApp = z.infer<typeof StudioApp>;

export const Chat = z.object({
  id: z.string(),
  appId: z.string(),
  title: z.string(),
  mode: ChatMode,
  harness: HarnessType,
  model: z.string().optional(),
  branch: z.string(),
  path: z.string(),
  port: z.number(),
  status: ChatStatus,
  question: z.string().optional(),
  appliedSha: z.string().optional(),
  /** The latest run of this chat (docs/specs/studio.md, "Chats reuse runs"): Stop interrupts it. */
  runId: z.string().optional(),
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
  /** The run this turn is (docs/specs/studio.md, "Chats reuse runs"). */
  runId: z.string().optional(),
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

export const StatusReport = z.object({
  apps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      working: z.array(z.string()),
      needsYou: z.array(z.object({ chatId: z.string(), question: z.string() })),
      latest: z.object({ title: z.string(), at: z.string() }).optional(),
    }),
  ),
});
export type StatusReport = z.infer<typeof StatusReport>;

export const ApplyResult = z.union([
  z.object({ ok: z.literal(true), version: Version }),
  z.object({ ok: z.literal(false), conflict: z.array(z.string()) }),
  z.object({ ok: z.literal(false), nothing: z.literal(true) }),
]);
export type ApplyResult = z.infer<typeof ApplyResult>;

/** An app with its chats and versions (versions newest first). */
export type AppDetail = { app: StudioApp; chats: Chat[]; versions: Version[]; pullRequest?: AppPullRequest };
export const ChatDetail = z.object({ chat: Chat, turns: z.array(Turn) });
export type ChatDetail = z.infer<typeof ChatDetail>;
export const NewChatResult = z.object({ chat: Chat, turn: Turn.optional() });
export type NewChatResult = z.infer<typeof NewChatResult>;
export const SendResult = z.object({ turn: Turn, steered: z.boolean() });
export type SendResult = z.infer<typeof SendResult>;
export const Diff = z.object({ diff: z.string() });

/** The App's pull request (docs/specs/studio.md, Shipping). */
export const PullRequestState = z.enum(["uat", "ready_for_review", "merged", "waiting_for_review", "cancelled"]);
export type PullRequestState = z.infer<typeof PullRequestState>;
export const AppPullRequest = z.object({
  id: z.string(),
  appId: z.string(),
  forge: z.string(),
  repo: z.string(),
  number: z.number(),
  url: z.string(),
  branch: z.string(),
  base: z.string(),
  state: PullRequestState,
  versionId: z.string(),
  builtInPreview: z.string().optional(),
  previewUrl: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AppPullRequest = z.infer<typeof AppPullRequest>;

export type CreateAppInput = { name: string; source?: AppSource; harness?: string; model?: string };
/** `devCommand: null` clears an override. */
export type UpdateAppInput = { name?: string; devCommand?: string | null };
export type NewChatInput = { prompt?: string; mode?: ChatMode; harness?: string; model?: string; title?: string };
export type ForgeRepository = { owner: string; name: string; forge: string };

/** The merge gate's record of a pull request (docs/specs/merge-gate.md). */
export const MergeReview = z.object({
  id: z.string(),
  scope: z.union([z.object({ kind: z.literal("app"), appId: z.string(), team: z.string() }), z.object({ kind: z.literal("factory"), factory: z.string() })]),
  repo: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  author: z.string(),
  by: z.string(),
  state: z.enum(["deciding", "merged", "needs_review", "closed"]),
  reasons: z.array(z.string()),
  decision: z.object({ action: z.string() }).passthrough().optional(),
  mergedBy: z.string().optional(),
  previewUrl: z.string().optional(),
  link: z.string().optional(),
  pullRequestId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MergeReview = z.infer<typeof MergeReview>;
