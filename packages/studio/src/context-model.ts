/**
 * The Context's rules as pure functions (ADR-019): what an answer must be, what a document's blocks
 * are as fragments, whether the prototype is behind, who lands on the Brief, and what a viewer's
 * write becomes. apps/web/src/lib/studio/context-model.ts mirrors this for the page.
 */
import { questionFromBlock, QUESTION_BLOCK, TYPED_FRAGMENTS, type DocBlock } from "./context-doc";
import {
  FunctionalRole,
  type ContextChange,
  type ContextState,
  type Fragment,
  type FragmentType,
  type Member,
  type Permission,
  type Proposal,
  type Question,
  type QuestionAnswer,
  type QuestionSpec,
  type QuestionStatus,
} from "./context-types";

// --- Questions -------------------------------------------------------------------------------

export type AnswerCheck = { ok: true; answer: QuestionAnswer } | { ok: false; error: string };

const bad = (error: string): AnswerCheck => ({ ok: false, error });
const unique = (list: string[]) => new Set(list).size === list.length;

/** Checks an answer against its question and returns it trimmed. Every kind takes Something else, You decide and Skip. */
export function validateAnswer(spec: QuestionSpec, answer: QuestionAnswer): AnswerCheck {
  if (answer.type === "delegated" || answer.type === "skipped") return { ok: true, answer };
  if (answer.type === "other") {
    const text = answer.text.trim();
    return text ? { ok: true, answer: { type: "other", text } } : bad("Write an answer");
  }
  const v = answer.value;
  switch (spec.kind) {
    case "single":
    case "sketch":
      return typeof v === "string" && spec.options.some((o) => o.id === v) ? { ok: true, answer } : bad("Pick one of the options");
    case "multi": {
      if (!Array.isArray(v) || !unique(v) || v.some((id) => !spec.options.some((o) => o.id === id))) return bad("Pick from the options");
      if (v.length < (spec.min ?? 1)) return bad(spec.min && spec.min > 1 ? `Pick at least ${spec.min}` : "Pick at least one");
      if (spec.max !== undefined && v.length > spec.max) return bad(`Pick at most ${spec.max}`);
      return { ok: true, answer };
    }
    case "boolean":
      return typeof v === "boolean" ? { ok: true, answer } : bad("Pick yes or no");
    case "scale": {
      const step = spec.step ?? 1;
      const onStep = typeof v === "number" && Math.abs((v - spec.min) / step - Math.round((v - spec.min) / step)) < 1e-9;
      return typeof v === "number" && v >= spec.min && v <= spec.max && onStep ? { ok: true, answer } : bad(`Pick a value from ${spec.min} to ${spec.max}`);
    }
    case "rank":
      return Array.isArray(v) && unique(v) && v.length === spec.options.length && v.every((id) => spec.options.some((o) => o.id === id))
        ? { ok: true, answer }
        : bad("Rank every option once");
    case "text": {
      const text = typeof v === "string" ? v.trim() : "";
      return text ? { ok: true, answer: { type: "value", value: text } } : bad("Write an answer");
    }
  }
}

/** The answer in words, as the decision shows it. */
export function answerText(spec: QuestionSpec, answer: QuestionAnswer): string {
  if (answer.type === "skipped") return "Skipped";
  if (answer.type === "delegated") return "You decide";
  if (answer.type === "other") return answer.text;
  const v = answer.value;
  const label = (id: string) => ("options" in spec ? (spec.options.find((o) => o.id === id)?.label ?? id) : id);
  switch (spec.kind) {
    case "single":
    case "sketch":
      return label(String(v));
    case "multi":
      return (Array.isArray(v) ? v : []).map(label).join(", ");
    case "boolean":
      return v ? (spec.yes ?? "Yes") : (spec.no ?? "No");
    case "scale": {
      const end = v === spec.max ? spec.maxLabel : v === spec.min ? spec.minLabel : undefined;
      return `${v}${spec.unit ? ` ${spec.unit}` : ""} of ${spec.max}${end ? ` (${end})` : ""}`;
    }
    case "rank":
      return (Array.isArray(v) ? v : []).map((id, i) => `${i + 1}. ${label(id)}`).join("  ");
    case "text":
      return String(v);
  }
}

export function statusFor(answer: QuestionAnswer): QuestionStatus {
  return answer.type === "delegated" ? "delegated" : answer.type === "skipped" ? "skipped" : "answered";
}

/** "You decide": the value the agent assumes. The recommended option, the default, or a sensible middle. */
export function delegatedAnswer(spec: QuestionSpec): QuestionAnswer {
  switch (spec.kind) {
    case "single":
    case "sketch":
      return { type: "value", value: (spec.options.find((o) => o.recommended) ?? spec.options[0]!).id };
    case "multi": {
      const recommended = spec.options.filter((o) => o.recommended).map((o) => o.id);
      const pick = recommended.length ? recommended : spec.options.slice(0, Math.max(spec.min ?? 1, Math.min(2, spec.options.length))).map((o) => o.id);
      return { type: "value", value: pick.slice(0, spec.max ?? pick.length) };
    }
    case "boolean":
      return { type: "value", value: spec.recommended ?? true };
    case "scale": {
      const step = spec.step ?? 1;
      const middle = spec.min + Math.round((spec.max - spec.min) / 2 / step) * step;
      return { type: "value", value: spec.default ?? middle };
    }
    case "rank":
      return { type: "value", value: spec.options.map((o) => o.id) };
    case "text":
      return { type: "value", value: spec.suggestion ?? "To be decided" };
  }
}

/** "Accept all recommended": the answer a question recommends, or undefined when it recommends none (an open question). */
export function recommendedAnswer(spec: QuestionSpec): QuestionAnswer | undefined {
  switch (spec.kind) {
    case "single":
    case "sketch": {
      const r = spec.options.find((o) => o.recommended);
      return r ? { type: "value", value: r.id } : undefined;
    }
    case "multi": {
      const r = spec.options.filter((o) => o.recommended).map((o) => o.id);
      return r.length ? { type: "value", value: r } : undefined;
    }
    case "boolean":
      return spec.recommended === undefined ? undefined : { type: "value", value: spec.recommended };
    case "scale":
      return spec.default === undefined ? undefined : { type: "value", value: spec.default };
    case "rank":
      return undefined;
    case "text":
      return spec.suggestion ? { type: "value", value: spec.suggestion } : undefined;
  }
}

/** At most this many questions of one `ask` are open on screen; a larger batch becomes a stepper. */
export const MAX_QUESTIONS_ON_SCREEN = 3;

export type QuestionDisplay = "expanded" | "collapsed" | "settled";

/** How a question block shows: settled once answered, and in a batch of more than three only the next open one is expanded. */
export function questionDisplay(q: Question, all: Question[]): QuestionDisplay {
  if (q.status !== "open") return "settled";
  if (q.batch.total <= MAX_QUESTIONS_ON_SCREEN) return "expanded";
  const next = all.filter((x) => x.batch.id === q.batch.id && x.status === "open").sort((a, b) => a.batch.index - b.batch.index)[0];
  return next?.id === q.id ? "expanded" : "collapsed";
}

export function batchProgress(all: Question[], batchId: string): { done: number; total: number; complete: boolean } {
  const batch = all.filter((q) => q.batch.id === batchId);
  const done = batch.filter((q) => q.status !== "open").length;
  return { done, total: batch.length, complete: batch.length > 0 && done === batch.length };
}

// --- Fragments -------------------------------------------------------------------------------

const TYPED = new Set<string>(TYPED_FRAGMENTS);

function roles(value: unknown): FunctionalRole[] {
  return String(value ?? "")
    .split(",")
    .map((r) => FunctionalRole.safeParse(r.trim()))
    .flatMap((r) => (r.success ? [r.data] : []));
}

/** The fragment type a document block is. A decided question is a decision; one left to the agent is an assumption. */
export function fragmentType(block: Pick<DocBlock, "type" | "props">): FragmentType {
  if (TYPED.has(block.type)) return block.type as FragmentType;
  if (block.type === "heading") return "section";
  if (block.type === "image") return "image";
  if (block.type === QUESTION_BLOCK) return block.props.status === "answered" ? "decision" : block.props.status === "delegated" ? "assumption" : "question";
  return "text";
}

/** The Context's fragments, in document order. Empty plain text isn't a fragment. */
export function fragmentsFrom(appId: string, blocks: DocBlock[], versions: Record<string, number> = {}): Fragment[] {
  const out: Fragment[] = [];
  for (const b of blocks) {
    const type = fragmentType(b);
    const q = questionFromBlock(appId, b);
    const content = q ? `${q.spec.title}${q.answer && q.status !== "open" ? ` ${answerText(q.spec, q.answer)}` : ""}` : b.text.trim();
    if (!content && type !== "image") continue;
    const by = String(b.props.by || q?.answeredBy || "");
    const owner = FunctionalRole.safeParse(b.props.ownerRole);
    out.push({
      id: b.id,
      appId,
      type,
      ...(b.parent ? { parent: b.parent } : {}),
      ownerRole: owner.success ? owner.data : "product",
      reviewerRoles: roles(b.props.reviewerRoles),
      content,
      version: versions[b.id] ?? 1,
      provenance: by ? [{ by, kind: by === "agent" ? "agent" : "person", ...(q ? { questionId: q.id } : {}), at: String(b.props.at ?? "") }] : [],
      ...(b.props.route ? { previewReference: { route: String(b.props.route), ...(b.props.selector ? { selector: String(b.props.selector) } : {}) } } : {}),
    });
  }
  return out;
}

export function questionsFrom(appId: string, blocks: DocBlock[]): Question[] {
  return blocks.flatMap((b) => questionFromBlock(appId, b) ?? []);
}

/** A fragment in one line, for lists and links. */
export function fragmentTitle(content: string, max = 64): string {
  const line = content.split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line || "Untitled";
}

// --- Freshness -------------------------------------------------------------------------------

export type Freshness =
  | { kind: "never" }
  | { kind: "fresh" }
  | { kind: "behind"; count: number; fragments: { id: string; title: string; type: FragmentType; change: ContextChange["change"] }[] };

/** Whether the prototype reflects the Context: the version the last build read against the current one. */
export function freshness(state: ContextState, changes: ContextChange[]): Freshness {
  if (state.builtVersion === undefined) return { kind: "never" };
  if (state.builtVersion >= state.version) return { kind: "fresh" };
  const seen = new Set<string>();
  const fragments = [...changes]
    .filter((c) => c.version > state.builtVersion!)
    .sort((a, b) => b.version - a.version)
    .filter((c) => !seen.has(c.fragmentId) && seen.add(c.fragmentId))
    .map((c) => ({ id: c.fragmentId, title: c.title, type: c.type, change: c.change }));
  return { kind: "behind", count: Math.max(fragments.length, 1), fragments };
}

// --- Catch-up --------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a person lands on the Brief: anyone who didn't start the App and hasn't opened it, or is back after more than a day. */
export function catchUp({ member, createdBy, now }: { member: Member; createdBy: string; now: Date }): { open: boolean; reason: "new" | "returning" | "current" } {
  if (!member.lastSeenAt) return member.user === createdBy ? { open: false, reason: "current" } : { open: true, reason: "new" };
  return now.getTime() - new Date(member.lastSeenAt).getTime() > DAY_MS ? { open: true, reason: "returning" } : { open: false, reason: "current" };
}

/** What other people and the agent changed after the member's last visit: the newest change per fragment, newest first. */
export function sinceLastVisit(changes: ContextChange[], member: Member): ContextChange[] {
  const seen = new Set<string>();
  return [...changes]
    .filter((c) => c.version > (member.lastSeenVersion ?? 0))
    .sort((a, b) => b.version - a.version)
    .filter((c) => !seen.has(c.fragmentId) && seen.add(c.fragmentId))
    .filter((c) => c.by !== member.user);
}

export function needsYou({ member, questions, proposals, fragments }: { member: Member; questions: Question[]; proposals: Proposal[]; fragments: Fragment[] }): {
  questions: Question[];
  proposals: Proposal[];
  reviews: Fragment[];
} {
  return {
    questions: questions.filter((q) => q.status === "open"),
    proposals: proposals.filter((p) => canDecide(member, p)),
    reviews: fragments.filter((f) => f.reviewerRoles.includes(member.role)),
  };
}

/** The Brief's five lines: what this is, who it is for, the decisions that matter, the prototype, what is open. */
export function briefLines({
  app,
  fragments,
  questions,
  proposals,
  fresh,
}: {
  app: string;
  fragments: Fragment[];
  questions: Question[];
  proposals: Proposal[];
  fresh: Freshness;
}): string[] {
  const intro = fragments.find((f) => f.type === "text")?.content;
  const decided = questions.filter((q) => q.answer && (q.status === "answered" || q.status === "delegated"));
  const audience = decided[0];
  const count = (type: FragmentType) => fragments.filter((f) => f.type === type).length;
  const open = questions.filter((q) => q.status === "open").length;
  const waiting = proposals.filter((p) => p.status === "open").length;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [
    intro ? `${app}: ${fragmentTitle(intro, 140)}` : `${app} has no description yet.`,
    audience ? `${audience.spec.title} ${answerText(audience.spec, audience.answer!)}.` : "Who it is for is not decided yet.",
    decided.length > 1
      ? `Decided: ${decided
          .slice(1, 4)
          .map((q) => answerText(q.spec, q.answer!))
          .join("; ")}.`
      : `${plural(count("requirement"), "requirement")} and ${plural(count("constraint"), "constraint")} so far.`,
    fresh.kind === "never"
      ? "No prototype has been built yet."
      : fresh.kind === "fresh"
        ? `The prototype is up to date with ${plural(count("requirement"), "requirement")}.`
        : `The prototype is ${plural(fresh.count, "change")} behind the Context.`,
    open || waiting ? `Still open: ${[open && plural(open, "question"), waiting && plural(waiting, "proposal")].filter(Boolean).join(" and ")}.` : "Nothing is open right now.",
  ];
}

// --- Permissions and proposals ---------------------------------------------------------------

export const VIEWER_NOTE = "Viewers can comment and propose";

export function canEdit(permission: Permission): boolean {
  return permission !== "viewer";
}

/** What a write by this person (or by the agent on their turn) becomes. */
export function writeOutcome(permission: Permission): "apply" | "propose" {
  return canEdit(permission) ? "apply" : "propose";
}

export function canDecide(member: Member, proposal: Proposal): boolean {
  return canEdit(member.permission) && proposal.status === "open";
}

export function decide(proposal: Proposal, member: Member, decision: "accept" | "reject", reason?: string): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  if (!canEdit(member.permission)) return { ok: false, error: `${VIEWER_NOTE}; an editor decides` };
  if (proposal.status !== "open") return { ok: false, error: `This proposal is already ${proposal.status}` };
  return {
    ok: true,
    proposal: { ...proposal, status: decision === "accept" ? "accepted" : "rejected", decidedBy: member.user, ...(decision === "reject" && reason ? { reason } : {}) },
  };
}
