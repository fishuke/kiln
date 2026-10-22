/**
 * Studio types as the web page sees them: the shapes in docs/specs/studio.md, re-declared so the
 * page doesn't depend on packages/studio. Every API response is parsed with these schemas.
 */
import { z } from "zod";

export const ShipMode = z.enum(["safe", "review", "cowboy"]);
export type ShipMode = z.infer<typeof ShipMode>;
export const ChatMode = z.enum(["build", "chat", "plan"]);
export type ChatMode = z.infer<typeof ChatMode>;
export const ProjectStatus = z.enum(["creating", "ready", "paused", "failed"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export const ChatStatus = z.enum(["idle", "working", "needs_you", "conflict", "failed"]);
export type ChatStatus = z.infer<typeof ChatStatus>;
export const TurnStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type TurnStatus = z.infer<typeof TurnStatus>;
export const VersionKind = z.enum(["initial", "apply", "restore"]);
export type VersionKind = z.infer<typeof VersionKind>;
export const Via = z.enum(["web", "mcp", "api", "voice"]);
export type Via = z.infer<typeof Via>;
export const HarnessType = z.string();

/** Where a project's code came from: a template, or an existing repository on a connected forge. */
export const ProjectSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), template: z.string() }),
  z.object({ kind: z.literal("repo"), repo: z.string(), branch: z.string(), forge: z.string().optional() }),
]);
export type ProjectSource = z.infer<typeof ProjectSource>;

export const SetupStepId = z.enum(["clone", "install", "dev", "preview"]);
export type SetupStepId = z.infer<typeof SetupStepId>;
/** How far an imported project got: steps, what was detected, and what it still needs. */
export const ProjectSetup = z.object({
  steps: z.array(z.object({ id: SetupStepId, status: z.enum(["pending", "running", "done", "failed"]), detail: z.string().optional() })),
  packageManager: z.string().optional(),
  devCommand: z.string().optional(),
  missingEnv: z.array(z.string()).default([]),
});
export type ProjectSetup = z.infer<typeof ProjectSetup>;

export const Project = z.object({
  id: z.string(),
  team: z.string(),
  name: z.string(),
  template: z.string(),
  source: ProjectSource.optional(),
  setup: ProjectSetup.optional(),
  shipMode: ShipMode,
  harness: HarnessType,
  model: z.string().optional(),
  status: ProjectStatus,
  error: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Chat = z.object({
  id: z.string(),
  projectId: z.string(),
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
  projectId: z.string(),
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
});
export type Turn = z.infer<typeof Turn>;

export const Version = z.object({
  id: z.string(),
  projectId: z.string(),
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
  projects: z.array(
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

export const ProjectDetail = z.object({ project: Project, chats: z.array(Chat), versions: z.array(Version) });
export type ProjectDetail = z.infer<typeof ProjectDetail>;
export const ChatDetail = z.object({ chat: Chat, turns: z.array(Turn) });
export type ChatDetail = z.infer<typeof ChatDetail>;
export const NewChatResult = z.object({ chat: Chat, turn: Turn.optional() });
export type NewChatResult = z.infer<typeof NewChatResult>;
export const SendResult = z.object({ turn: Turn, steered: z.boolean() });
export type SendResult = z.infer<typeof SendResult>;
export const Diff = z.object({ diff: z.string() });

export type CreateProjectInput = {
  name: string;
  template?: string;
  source?: ProjectSource;
  shipMode?: ShipMode;
  harness?: string;
  model?: string;
};
export type UpdateProjectInput = { name?: string; shipMode?: ShipMode; devCommand?: string; env?: Record<string, string> };
export type NewChatInput = { prompt?: string; mode?: ChatMode; harness?: string; model?: string; title?: string };
export type ForgeRepository = { owner: string; name: string; forge: string };
