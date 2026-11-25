/**
 * The Context (ADR-019, docs/specs/studio-context.md section 5): the document's fragments, the
 * questions the agent asks, proposals, members and sign-offs. The document is the truth; fragments
 * and questions are derived from it. apps/web/src/lib/studio/types.ts mirrors these shapes.
 */
import { z } from "zod";

/** One step of a turn, as Activity shows it. */
export const ContextActivity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("reasoning"), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("tool"), name: z.string(), text: z.string().optional(), at: z.string() }),
  z.object({ kind: z.literal("subagent"), name: z.string(), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal("error"), text: z.string(), at: z.string() }),
]);
export type ContextActivity = z.infer<typeof ContextActivity>;

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

/** A comment thread on a fragment. Anyone who can open the Context can comment. */
export const ThreadComment = z.object({ id: z.string(), by: z.string(), text: z.string(), at: z.string() });
export type ThreadComment = z.infer<typeof ThreadComment>;
export const Thread = z.object({
  id: z.string(),
  appId: z.string(),
  fragmentId: z.string(),
  /** The fragment in one line when the thread started, so the thread reads on its own. */
  title: z.string(),
  comments: z.array(ThreadComment),
  status: z.enum(["open", "resolved"]),
  resolvedBy: z.string().optional(),
  at: z.string(),
});
export type Thread = z.infer<typeof Thread>;

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
  activity: z.array(ContextActivity),
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
  threads: Thread[];
  signoffs: SignOff[];
  /** Per fragment id: how many times its content settled. A sign-off on an older version is stale. */
  versions: Record<string, number>;
  /** Set while the Context is empty and the agent can draft it from the App's code or earlier conversations (`POST …/context/draft`). */
  draft?: "code" | "conversations";
};
