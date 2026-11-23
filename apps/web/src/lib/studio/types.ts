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
  /** The prompt the App was created with, until its first chat starts. */
  firstPrompt: z.object({ text: z.string(), via: z.string() }).optional(),
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

/** A command the run's guard asked a person about: `waiting` while its gate is open, then `allowed` or `blocked`. */
export const CommandApproval = z.object({
  gateId: z.string(),
  command: z.string(),
  state: z.enum(["waiting", "allowed", "blocked"]),
  by: z.string().optional(),
});
export type CommandApproval = z.infer<typeof CommandApproval>;

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
  /** The turn's latest command approval (docs/specs/studio.md, "Command approvals"). */
  approval: CommandApproval.optional(),
  costUsd: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  /** The run this turn is (docs/specs/studio.md, "Chats reuse runs"). */
  runId: z.string().optional(),
  /** The run's trace id in the tracing backend, shown muted under the turn. */
  traceId: z.string().optional(),
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

/** A failed preview says why (`reason`) and carries the dev server's last output lines. */
export const Preview = z.object({
  target: z.string(),
  url: z.string(),
  status: z.enum(["starting", "ready", "failed"]),
  reason: z.string().optional(),
  output: z.string().optional(),
});
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
  reviewReasons: z.array(z.string()).optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AppPullRequest = z.infer<typeof AppPullRequest>;

/** `prompt` starts the App's first chat once setup is done. */
export type CreateAppInput = { name: string; source?: AppSource; harness?: string; model?: string; prompt?: string };
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

// ---------------------------------------------------------------------------------------------
// The Context (docs/specs/studio-context.md, section 5): the document, its fragments, questions,
// proposals and members. The document is the truth; fragments and questions are derived from it.
// ---------------------------------------------------------------------------------------------

export const FragmentType = z.enum(["text", "section", "requirement", "decision", "assumption", "constraint", "question", "flow", "risk", "metric", "image"]);
export type FragmentType = z.infer<typeof FragmentType>;
export const FunctionalRole = z.enum(["product", "design", "engineering", "security", "legal", "data", "qa"]);
export type FunctionalRole = z.infer<typeof FunctionalRole>;
export const Permission = z.enum(["owner", "editor", "viewer"]);
export type Permission = z.infer<typeof Permission>;

export const Provenance = z.object({
  by: z.string(),
  kind: z.enum(["person", "agent"]),
  onBehalfOf: z.string().optional(),
  turnId: z.string().optional(),
  questionId: z.string().optional(),
  at: z.string(),
});
export type Provenance = z.infer<typeof Provenance>;

/** Derived from the Context document; the document is the truth. */
export const Fragment = z.object({
  /** The BlockNote block id. */
  id: z.string(),
  appId: z.string(),
  type: FragmentType,
  parent: z.string().optional(),
  ownerRole: FunctionalRole,
  reviewerRoles: z.array(FunctionalRole),
  /** Plain text of the block, for search, briefs and exports. */
  content: z.string(),
  /** +1 each time its content settles. */
  version: z.number(),
  /** Newest last. */
  provenance: z.array(Provenance),
  previewReference: z.object({ route: z.string(), selector: z.string().optional() }).optional(),
});
export type Fragment = z.infer<typeof Fragment>;

export const Member = z.object({
  appId: z.string(),
  user: z.string(),
  /** Shown in presence and "Decided by". */
  name: z.string(),
  permission: Permission,
  role: FunctionalRole,
  invitedBy: z.string(),
  lastSeenAt: z.string().optional(),
  lastSeenVersion: z.number().optional(),
});
export type Member = z.infer<typeof Member>;

const QuestionBase = { title: z.string().min(1), detail: z.string().optional() };
export const QuestionOption = z.object({ id: z.string(), label: z.string(), consequence: z.string().optional(), recommended: z.boolean().optional() });
export type QuestionOption = z.infer<typeof QuestionOption>;
/** The fixed set of layout primitives a `sketch` option draws. */
export const Wireframe = z.enum(["list", "grid", "split", "feed"]);
export type Wireframe = z.infer<typeof Wireframe>;
const Options = z.array(QuestionOption).min(2).max(4);

/** What the agent's `ask` tool sends: a typed spec the page renders from a fixed registry. Never markup. */
export const QuestionSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), ...QuestionBase, options: Options }),
  z.object({ kind: z.literal("multi"), ...QuestionBase, options: Options, min: z.number().optional(), max: z.number().optional() }),
  z.object({ kind: z.literal("boolean"), ...QuestionBase, yes: z.string().optional(), no: z.string().optional(), recommended: z.boolean().optional() }),
  z.object({
    kind: z.literal("scale"),
    ...QuestionBase,
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    minLabel: z.string(),
    maxLabel: z.string(),
    default: z.number().optional(),
    unit: z.string().optional(),
  }),
  z.object({ kind: z.literal("rank"), ...QuestionBase, options: Options }),
  z.object({ kind: z.literal("text"), ...QuestionBase, placeholder: z.string().optional(), multiline: z.boolean().optional(), suggestion: z.string().optional() }),
  z.object({ kind: z.literal("sketch"), ...QuestionBase, options: z.array(QuestionOption.extend({ layout: Wireframe })).min(2).max(4) }),
]);
export type QuestionSpec = z.infer<typeof QuestionSpec>;
export type QuestionKind = QuestionSpec["kind"];

/** An answer as the person gave it: a value for the spec, "Something else", "You decide" or a skip. */
export const QuestionAnswer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("value"), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]) }),
  z.object({ type: z.literal("other"), text: z.string() }),
  z.object({ type: z.literal("delegated") }),
  z.object({ type: z.literal("skipped") }),
]);
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;
export const QuestionStatus = z.enum(["open", "answered", "skipped", "delegated"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const Question = z.object({
  /** "sq_…" */
  id: z.string(),
  appId: z.string(),
  chatId: z.string(),
  turnId: z.string(),
  /** The question block in the document. */
  fragmentId: z.string(),
  spec: QuestionSpec,
  status: QuestionStatus,
  /** Validated against `spec`. For "You decide" it is the value the agent assumed. */
  answer: QuestionAnswer.optional(),
  answeredBy: z.string().optional(),
  answeredAt: z.string().optional(),
  /** The `ask` call this question came in, and its place in it. */
  batch: z.object({ id: z.string(), index: z.number(), total: z.number() }),
});
export type Question = z.infer<typeof Question>;

export const Proposal = z.object({
  id: z.string(),
  appId: z.string(),
  by: z.string(),
  kind: z.enum(["edit", "add", "remove", "answer"]),
  fragmentId: z.string().optional(),
  parent: z.string().optional(),
  /** One line a reviewer reads: what would change. */
  summary: z.string(),
  patch: z.unknown(),
  status: z.enum(["open", "accepted", "rejected"]),
  decidedBy: z.string().optional(),
  reason: z.string().optional(),
  at: z.string(),
});
export type Proposal = z.infer<typeof Proposal>;

export const SignOff = z.object({
  appId: z.string(),
  fragmentId: z.string(),
  role: FunctionalRole,
  by: z.string(),
  state: z.enum(["approved", "changes"]),
  version: z.number(),
  at: z.string(),
});
export type SignOff = z.infer<typeof SignOff>;

export const ContextState = z.object({
  appId: z.string(),
  version: z.number(),
  builtVersion: z.number().optional(),
  briefVersion: z.number().optional(),
  brief: z.string().optional(),
});
export type ContextState = z.infer<typeof ContextState>;

/** One fragment changing at one Context version: what the freshness chip and "since your last visit" list. */
export const ContextChange = z.object({
  version: z.number(),
  fragmentId: z.string(),
  type: FragmentType,
  title: z.string(),
  change: z.enum(["added", "edited", "removed"]),
  by: z.string(),
  at: z.string(),
});
export type ContextChange = z.infer<typeof ContextChange>;

/** What the agent is doing now, for the activity line and its cursor. */
export const AgentStatus = z.object({
  state: z.enum(["idle", "thinking", "asking", "writing", "building", "waiting"]),
  /** "Writing", "Building the prototype". */
  label: z.string(),
  /** "Requirements › Sign-in", "3 of 7 files". */
  object: z.string().optional(),
  done: z.number().optional(),
  total: z.number().optional(),
  /** The fragment its cursor is in. */
  fragmentId: z.string().optional(),
  turnId: z.string().optional(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

/** A turn on the App's one thread, as the Activity panel shows it. */
export const ContextTurn = z.object({
  id: z.string(),
  appId: z.string(),
  by: z.string(),
  kind: z.enum(["prompt", "answers", "build", "ask"]),
  prompt: z.string(),
  status: z.enum(["running", "needs_you", "succeeded", "cancelled", "failed"]),
  reply: z.string().optional(),
  activity: z.array(Activity),
  costUsd: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type ContextTurn = z.infer<typeof ContextTurn>;

/** Everything about a Context that is not the document itself. */
export type ContextSnapshot = {
  state: ContextState;
  me: Member;
  members: Member[];
  proposals: Proposal[];
  changes: ContextChange[];
  agent: AgentStatus;
  turns: ContextTurn[];
};
