/**
 * The Context on the server (ADR-019, docs/specs/studio-context.md): each App's shared document,
 * held as a Yjs document and synced to the pages that have it open, with what is not the document
 * (state, proposals, members) in the Store. People change the document through `applyUpdate`; the
 * agent changes it only through `tool`, and every write is checked against the permission of the
 * person who prompted the turn. A viewer's write becomes a proposal.
 */
import type { EventBus } from "@kiln/events";
import type { ObjectStore, Store } from "@kiln/store";
import { z } from "zod";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { questionProps, QUESTION_BLOCK, TYPED_FRAGMENTS, type DocBlock, type DocProps } from "./context-doc";
import { answerText, batchProgress, briefLines, canEdit, decide, delegatedAnswer, recommendedAnswer, fragmentTitle, fragmentsFrom, freshness, questionsFrom, statusFor, validateAnswer, VIEWER_NOTE } from "./context-model";
import {
  FragmentType,
  FunctionalRole,
  QuestionSpec,
  type AgentStatus,
  type ContextChange,
  type Fragment,
  type ContextSnapshot,
  type ContextState,
  type ContextTurn,
  type Member,
  type Permission,
  type Proposal,
  type Question,
  type SignOff,
  type Thread,
  type QuestionAnswer,
} from "./context-types";
import { WRITABLE_BLOCKS, YContextDoc } from "./context-ydoc";
import type { Clock, Studio } from "./studio";
import { StudioError, type App, type Chat, type Preview, type Turn } from "./types";

export const CONTEXT_COLLECTIONS = { context: "studio_context", members: "studio_members", proposals: "studio_proposals", threads: "studio_threads", signoffs: "studio_signoffs" } as const;
const C = CONTEXT_COLLECTIONS;

/** The person a call is made by, or made for (the one who prompted the agent's turn). */
export type ContextPerson = { user: string; name?: string; team: string; mayWrite: boolean };

type Hash = { h: string; title: string; type: FragmentType };
type Row = {
  id: string;
  team: string;
  state: ContextState;
  /** The App's one thread on the Context page. */
  chatId?: string;
  hashes: Record<string, Hash>;
  /** Per fragment: how many times its content settled. */
  versions?: Record<string, number>;
  changes: ContextChange[];
  /** Each `ask` call: whether its answers were sent to the agent yet. */
  batches: Record<string, { state: "asked" | "sent"; turnId: string }>;
  seen: Record<string, { at: string; version: number }>;
  /** Per turn: the Context version it read, for `mark_built`. */
  read: Record<string, number>;
  /** When the agent was started on drafting an empty Context from the App's code and earlier chats. Once per App. */
  drafted?: string;
};
type MemberRow = Member & { id: string };
type ProposalRow = Proposal;

export type ContextEvent = { type: "update"; update: Uint8Array; from?: string } | { type: "awareness"; update: Uint8Array; from?: string } | { type: "changed" };
type Listener = (e: ContextEvent) => void;

type Live = {
  doc: Y.Doc;
  y: YContextDoc;
  awareness: Awareness;
  listeners: Set<Listener>;
  /** Blocks the agent wrote since the document last settled. */
  agentTouched: Set<string>;
  /** Who else changed the document since it last settled. */
  people: Set<string>;
  agent?: AgentStatus;
  cancelSave?: () => void;
  cancelSettle?: () => void;
};

/**
 * The Context's sections in reading order: the story first (what, why, who, how), then what is
 * built and in what order, then the log. A new section goes in at its place in this order.
 */
export const SECTION_ORDER = ["Why", "Who it's for", "How it works", "Requirements", "Plan", "Constraints", "Risks", "Success", "Not doing", "Decisions"] as const;

/** Led into every turn on the Context's thread: how the agent works with the Context. */
export const CONTEXT_NOTES = [
  "This App has a Context (the `context_*` tools of the Kiln MCP server): one living document that is the source of truth for what is being built. The person reads and edits it next to the prototype, and so does everyone who joins later.",
  "",
  "Write it as a document a person wants to read, not as a list of settings. Its reader is a teammate who joins next week, has five minutes, and asks: what are we making, why, for whom, how does it work, what is the plan, what is left out. They must find each answer in plain sentences. Use this shape, in this order:",
  "- `title`: the product's name. Then one or two paragraphs of `text` right under it: what this is and what it is for, in words a non-engineer would use.",
  "- **Why** (`text`): the problem, who has it today, and what gets better. No bullet points; write it.",
  "- **Who it's for** (`text`): the people who use it and what they come to do.",
  "- **How it works** (`flow`, with `text` around them): each main journey, step by step, as a person lives it.",
  "- **Requirements** (`requirement`): what it must do, one statement each, each one testable.",
  "- **Plan** (`step`): what gets built, in order, small enough to tick off. Mark a step `done: true` (pass its id) when the prototype has it. This is what tells a newcomer where things stand.",
  "- **Constraints**, **Risks** (`constraint`, `risk`), **Success** (`metric`): only what is real for this product.",
  "- **Not doing** (`bullet`): what was left out on purpose, and why, so nobody asks again.",
  "- **Decisions**: your questions and their answers land here by themselves. Don't copy them elsewhere as a list; let the sections above say what follows from them.",
  "",
  "How to work:",
  "- Call `context_read` first, every turn. Build only from what the Context says.",
  "- On a new Context, write the title and one or two sentences of what the person asked for, in their words, so they see their idea taking shape. Never invent why they want it. Unless they already said why, your first `context_ask` starts with an open `text` question: why they want this, what problem it solves and for whom. Write **Why** only from their answer.",
  "- Ask before assuming: `context_ask` with 1 to 5 typed questions, then end your turn. The answers arrive as your next message. Use options when the answer is one of a few choices, and mark the one you recommend. Use an open `text` question when only the person can know the answer: why they want it, who it is for, what success looks like.",
  "- After answers, write the rest of the document before you build: who it's for, how it works, requirements, the plan, what is not being done. Then build, tick off the plan's steps, and call `context_mark_built`.",
  "- Keep it true. When direction changes, rewrite the paragraphs that are now wrong (pass the fragment's id) instead of adding a note under them. Short sections beat long ones; cut what no longer matters.",
  "- When a fragment is implemented on a route, put `data-kiln-fragment=\"<fragment id>\"` on the element that implements it and call `context_link_preview`.",
  "- You can't edit the Context as a file. If a tool answers that a change was proposed, the person who asked is a viewer: say so and don't retry.",
].join("\n");

const Section = z.string().min(1).max(80);
const Roles = z.array(FunctionalRole).max(7);
/** The agent's tools on the Context (docs/specs/studio-context.md, section 6). */
export const CONTEXT_TOOLS = {
  context_read: {
    description: "Read the App's Context: the document as Markdown, each fragment with its id and type. Call it before anything else.",
    input: z.object({ fragment: z.string().optional().describe("A fragment id: read only it and what is nested under it") }),
  },
  context_write: {
    description:
      "Write into the Context document, or replace a fragment (pass its id). `title` is the document's title. `text` is a paragraph of plain prose: use it for the story (what, why, for whom). `section` is a heading. `step` is one item of the plan, with `done`. `bullet` is a list item. The typed kinds (requirement, flow, constraint, risk, metric, decision, assumption) are one statement each.",
    input: z.object({
      id: z.string().optional().describe("Replace this fragment instead of inserting"),
      type: z.enum(["title", "text", "section", "step", "bullet", ...TYPED_FRAGMENTS]),
      done: z.boolean().optional().describe("For a step: whether the prototype has it"),
      content: z.string().min(1).max(2000),
      section: Section.optional().describe("The section heading to write under; it is made when it doesn't exist"),
      after: z.string().optional().describe("Insert right after this fragment id"),
      parent: z.string().optional().describe("Nest under this fragment id"),
      ownerRole: FunctionalRole.optional(),
      reviewerRoles: Roles.optional(),
      previewReference: z.object({ route: z.string(), selector: z.string().optional() }).optional(),
    }),
  },
  context_remove: { description: "Remove a fragment from the Context, with what is nested under it.", input: z.object({ id: z.string() }) },
  ask: {
    description: "Ask the person 1 to 5 questions with typed answers (single, multi, boolean, scale, rank, text, sketch). They appear in the Context under Decisions. End your turn after calling it.",
    input: z.object({ questions: z.array(QuestionSpec).min(1).max(5), section: Section.optional() }),
  },
  link_preview: { description: "Record where the prototype implements a fragment.", input: z.object({ fragment: z.string(), route: z.string().min(1), selector: z.string().optional() }) },
  mark_built: { description: "Record that the prototype now reflects the Context as you last read it.", input: z.object({}) },
} as const;
export type ContextToolName = keyof typeof CONTEXT_TOOLS;
export const CONTEXT_TOOL_NAMES = Object.keys(CONTEXT_TOOLS) as ContextToolName[];

export type ContextServiceOptions = {
  store: Store;
  objects: ObjectStore;
  bus: EventBus;
  clock: Clock;
  studio: Pick<Studio, "getApp" | "getChat" | "newChat" | "send" | "stop" | "preview">;
  /** Runs `fn` after `ms` and returns a cancel; tests pass a manual one. */
  schedule?: (fn: () => void, ms: number) => () => void;
  id?: (prefix: string) => string;
};

const SETTLE_MS = 2000;
const SAVE_MS = 2000;
const IDLE: AgentStatus = { state: "idle", label: "" };
const key = (appId: string) => `studio/context/${appId}/doc`;
/** What ships into the App's repository: the document as Markdown, and its fragments and questions as data. */
export type ContextExport = { markdown: string; json: { version: number; builtVersion: number | null; fragments: Fragment[]; questions: Question[] } };

/** What an empty Context can be drafted from: the App's own code, or its earlier conversations (and code). */
export type DraftSource = "code" | "conversations";
/** One earlier conversation on the App, as the draft prompt quotes it. */
export type DraftConversation = { title: string; turns: { prompt: string; reply?: string }[] };

const DRAFT_BUDGET = 8000;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * The prompt that starts the agent on an App whose Context is empty but which has a past: code
 * beyond its template (an imported repository, applied changes) or earlier conversations. Earlier
 * conversations are quoted, newest last, within a budget, so the agent can record what was decided.
 */
export function draftPrompt(input: { repository: boolean; conversations: DraftConversation[] }): string {
  const lines = [
    "This App has no Context yet. Draft it now, before anyone asks for anything:",
    input.repository ? "- Read the App's code: what it is, who it is for, how it works and what looks unfinished." : "- Read the App's code to see what is already built.",
  ];
  if (input.conversations.length) lines.push("- Read the earlier conversations below: what people asked for and what was decided. Record each decision that still holds, and the plan with what is already done ticked off.");
  lines.push("- Write the Context in its usual shape from what you found. Only write what the code or the conversations support; don't invent requirements, and don't invent why people want it: code shows what an App does, not why.", "- Then ask about what neither can tell you. If nobody said why, start with an open `text` question asking why. Don't change any code in this turn.");
  if (!input.conversations.length) return lines.join("\n");
  // Newest conversations matter most: fill the budget from the end, then put them back in order.
  const quoted: string[] = [];
  let left = DRAFT_BUDGET;
  for (const c of [...input.conversations].reverse()) {
    const turns = c.turns.map((t) => `> ${clip(t.prompt.replace(/\s+/g, " ").trim(), 600)}${t.reply ? `\n${clip(t.reply.replace(/\s+/g, " ").trim(), 600)}` : ""}`);
    const block = `### ${c.title}\n${turns.join("\n\n")}`;
    if (block.length > left) {
      if (left > 400) quoted.unshift(clip(block, left));
      break;
    }
    quoted.unshift(block);
    left -= block.length;
  }
  return [...lines, "", "## Earlier conversations", "", quoted.join("\n\n")].join("\n");
}

const markdownMark: Record<string, string> = { heading: "#", paragraph: "", bulletListItem: "-", numberedListItem: "1.", checkListItem: "- [ ]", quote: ">" };

export class ContextService {
  private live = new Map<string, Promise<Live>>();
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly id: (prefix: string) => string;
  private seq = 0;
  private offBus: () => void;

  constructor(private readonly opts: ContextServiceOptions) {
    this.schedule =
      opts.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return () => clearTimeout(t);
      });
    this.id = opts.id ?? ((prefix) => `${prefix}_${Date.now().toString(36)}${(this.seq += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    // A turn on a Context's thread starting or ending changes what its pages show.
    const offs = (["studio.turn_started", "studio.turn_finished", "studio.needs_you"] as const).map((type) =>
      opts.bus.subscribe(type, (e) => {
        const payload = (e as { payload?: { appId?: string; chatId?: string } }).payload ?? (e as { appId?: string; chatId?: string });
        const row = payload.appId ? this.opts.store.get<Row>(C.context, payload.appId) : undefined;
        if (!row || row.chatId !== payload.chatId) return;
        void this.open(row.id).then((l) => {
          if (type !== "studio.turn_started") l.agent = undefined;
          this.emit(l, { type: "changed" });
        });
      }),
    );
    this.offBus = () => offs.forEach((off) => off());
  }

  // --- the document, live -----------------------------------------------------------------------

  private now() {
    return this.opts.clock.now().toISOString();
  }

  private app(appId: string, team: string) {
    const found = this.opts.studio.getApp(appId);
    if (!found || found.app.team !== team) throw new StudioError("not_found", "App not found");
    return found.app;
  }

  private row(appId: string, team: string): Row {
    return this.opts.store.get<Row>(C.context, appId) ?? { id: appId, team, state: { appId, version: 0 }, hashes: {}, changes: [], batches: {}, seen: {}, read: {} };
  }

  private save(row: Row): Row {
    return this.opts.store.put<Row>(C.context, row);
  }

  private open(appId: string): Promise<Live> {
    let p = this.live.get(appId);
    if (!p) {
      p = (async () => {
        const doc = new Y.Doc();
        const saved = await this.opts.objects.get(key(appId));
        if (saved?.length) Y.applyUpdate(doc, saved, "load");
        const awareness = new Awareness(doc);
        awareness.setLocalState(null);
        const l: Live = { doc, y: new YContextDoc(doc, "agent"), awareness, listeners: new Set(), agentTouched: new Set(), people: new Set() };
        doc.on("update", (update: Uint8Array, origin: unknown) => {
          if (origin === "load") return;
          const from = typeof origin === "object" && origin && "client" in origin ? String((origin as { client?: string }).client ?? "") : undefined;
          this.emit(l, { type: "update", update, ...(from ? { from } : {}) });
          l.cancelSave?.();
          l.cancelSave = this.schedule(() => void this.persist(appId, l), SAVE_MS);
          l.cancelSettle?.();
          l.cancelSettle = this.schedule(() => this.settle(appId, l), SETTLE_MS);
        });
        awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
          const from = typeof origin === "string" ? origin : undefined;
          this.emit(l, { type: "awareness", update: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]), ...(from ? { from } : {}) });
        });
        return l;
      })();
      this.live.set(appId, p);
    }
    return p;
  }

  private emit(l: Live, e: ContextEvent) {
    for (const listener of [...l.listeners]) listener(e);
  }

  private async persist(appId: string, l: Live) {
    l.cancelSave = undefined;
    await this.opts.objects.put(key(appId), Y.encodeStateAsUpdate(l.doc), "application/octet-stream");
  }

  /** The document settled: bump the version and record which fragments moved, and by whom. */
  private settle(appId: string, l: Live) {
    l.cancelSettle = undefined;
    const row = this.opts.store.get<Row>(C.context, appId);
    if (!row) return;
    const fragments = fragmentsFrom(appId, l.y.read());
    const version = row.state.version + 1;
    const person = [...l.people].at(-1) ?? "agent";
    const after: Record<string, Hash> = {};
    const changes: ContextChange[] = [];
    const versions = { ...row.versions };
    const record = (fragmentId: string, x: Hash, change: ContextChange["change"]) =>
      changes.push({ version, fragmentId, type: x.type, title: x.title, change, by: l.agentTouched.has(fragmentId) ? "agent" : person, at: this.now() });
    for (const f of fragments) {
      const x: Hash = { h: `${f.type}|${f.content}`, title: fragmentTitle(f.content), type: f.type };
      after[f.id] = x;
      const was = row.hashes[f.id];
      if (was?.h === x.h) continue;
      versions[f.id] = (versions[f.id] ?? 0) + 1;
      record(f.id, x, was ? "edited" : "added");
    }
    for (const [id, was] of Object.entries(row.hashes)) if (!after[id]) record(id, was, "removed");
    l.agentTouched.clear();
    l.people.clear();
    if (!changes.length) return;
    this.save({ ...row, hashes: after, versions, changes: [...row.changes, ...changes].slice(-300), state: { ...row.state, version } });
    this.opts.bus.publish("studio.context_changed", { appId, version, fragments: fragments.length, priority: "progress" });
    this.emit(l, { type: "changed" });
  }

  /** Settles and saves every open document now (shutdown, and tests). */
  async flush(): Promise<void> {
    for (const [appId, p] of this.live) {
      const l = await p;
      l.cancelSettle?.();
      this.settle(appId, l);
      l.cancelSave?.();
      await this.persist(appId, l);
    }
  }

  /** Forgets a deleted App's Context: its live document and its rows (the saved document blob stays unreadable by id). */
  async forget(appId: string): Promise<void> {
    const live = this.live.get(appId);
    this.live.delete(appId);
    if (live) {
      const l = await live.catch(() => undefined);
      l?.cancelSave?.();
      l?.cancelSettle?.();
      l?.awareness.destroy();
    }
    this.opts.store.delete(C.context, appId);
    for (const c of [C.members, C.proposals, C.threads, C.signoffs])
      for (const r of this.opts.store.list<{ id: string; appId: string }>(c, (x) => x.appId === appId)) this.opts.store.delete(c, r.id);
  }

  async shutdown(): Promise<void> {
    this.offBus();
    await this.flush();
    for (const p of this.live.values()) (await p).awareness.destroy();
    this.live.clear();
  }

  // --- people -----------------------------------------------------------------------------------

  private members(appId: string, createdBy: string, me?: ContextPerson): Member[] {
    const lower = (u: string) => u.toLowerCase();
    // A stored row is keyed by the lower-cased email; it shows under the email the person signs in with.
    const rows = this.opts.store.list<MemberRow>(C.members, (m) => m.appId === appId).map(({ id: _, ...m }) => (me && lower(me.user) === m.user ? { ...m, user: me.user } : lower(createdBy) === m.user ? { ...m, user: createdBy } : m));
    const seen = this.opts.store.get<Row>(C.context, appId)?.seen ?? {};
    const out = [...rows];
    const implicit = (user: string, name: string | undefined, permission: Permission) => {
      if (!out.some((m) => m.user === user)) out.push({ appId, user, name: name || user.split("@")[0]!, permission, role: "product", invitedBy: createdBy });
    };
    implicit(createdBy, me?.user === createdBy ? me.name : undefined, "owner");
    // Until members are invited (Phase 3), a teammate who may send to the App edits; one who may only read views.
    if (me) implicit(me.user, me.name, me.mayWrite ? "editor" : "viewer");
    return out.map((m) => (seen[m.user] ? { ...m, lastSeenAt: seen[m.user]!.at, lastSeenVersion: seen[m.user]!.version } : m));
  }

  /** The person's place in the App's Context. */
  member(appId: string, who: ContextPerson): Member {
    const app = this.app(appId, who.team);
    return this.members(appId, app.createdBy, who).find((m) => m.user === who.user)!;
  }

  private editor(appId: string, who: ContextPerson, what: string): Member {
    const m = this.member(appId, who);
    if (!canEdit(m.permission)) throw new StudioError("forbidden", `${VIEWER_NOTE}; an editor ${what}`);
    return m;
  }

  /** The owner sets who edits and who views, and each person's role. Nobody changes the owner's permission. */
  async setMember(appId: string, who: ContextPerson, input: { user: string; name?: string; permission: "editor" | "viewer"; role: FunctionalRole }): Promise<Member> {
    const app = this.app(appId, who.team);
    if (this.member(appId, who).permission !== "owner") throw new StudioError("forbidden", "Only the owner invites members and changes what they may do");
    const user = input.user.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(user)) throw new StudioError("invalid", "A member is added by their email address");
    if (user === app.createdBy.toLowerCase()) throw new StudioError("invalid", "The owner stays the owner");
    const was = this.opts.store.get<MemberRow>(C.members, `${appId}:${user}`);
    const row: MemberRow = { id: `${appId}:${user}`, appId, user, name: input.name?.trim() || was?.name || user.split("@")[0]!, permission: input.permission, role: input.role, invitedBy: was?.invitedBy ?? who.user };
    this.opts.store.put<MemberRow>(C.members, row);
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    const { id: _, ...member } = row;
    return member;
  }

  async removeMember(appId: string, who: ContextPerson, user: string): Promise<void> {
    this.app(appId, who.team);
    if (this.member(appId, who).permission !== "owner") throw new StudioError("forbidden", "Only the owner removes members");
    this.opts.store.delete(C.members, `${appId}:${user.trim().toLowerCase()}`);
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
  }

  /** A person's own functional role: what they review. It never changes what they may do. */
  async setRole(appId: string, who: ContextPerson, role: FunctionalRole): Promise<Member> {
    const me = this.member(appId, who);
    const row: MemberRow = { ...me, id: `${appId}:${who.user.toLowerCase()}`, role };
    delete (row as Partial<Member>).lastSeenAt;
    delete (row as Partial<Member>).lastSeenVersion;
    this.opts.store.put<MemberRow>(C.members, row);
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    return { ...me, role };
  }

  async markSeen(appId: string, who: ContextPerson): Promise<void> {
    this.app(appId, who.team);
    const row = this.row(appId, who.team);
    this.save({ ...row, seen: { ...row.seen, [who.user]: { at: this.now(), version: row.state.version } } });
  }

  // --- reading ----------------------------------------------------------------------------------

  private chat(row: Row): { chat: Chat; turns: Turn[] } | undefined {
    return row.chatId ? this.opts.studio.getChat(row.chatId) : undefined;
  }

  private agentStatus(row: Row, l: Live, open: number): AgentStatus {
    const thread = this.chat(row);
    const turn = thread?.turns.at(-1);
    if (thread?.chat.status === "working" && turn?.status === "running") {
      if (l.agent?.turnId === turn.id) return l.agent;
      const last = turn.activity.at(-1);
      const building = last?.kind === "tool" && !(last.name in CONTEXT_TOOLS) && !last.name.includes("context_");
      return building ? { state: "building", label: "Building the prototype", turnId: turn.id } : { state: "thinking", label: "Reading the Context", turnId: turn.id };
    }
    return open ? { state: "waiting", label: "Waiting", ...(turn ? { turnId: turn.id } : {}) } : IDLE;
  }

  private turns(row: Row, open: number): ContextTurn[] {
    const turns = this.chat(row)?.turns ?? [];
    return turns.map((t, i) => ({
      id: t.id,
      appId: row.id,
      by: t.by,
      kind: /^(Build|Update) the prototype/.test(t.prompt) ? "build" : t.prompt.startsWith("Answers:") ? "answers" : "prompt",
      prompt: t.prompt,
      status: t.status === "running" ? "running" : t.status === "succeeded" ? (open && i === turns.length - 1 ? "needs_you" : "succeeded") : t.status,
      ...(t.reply ? { reply: t.reply } : {}),
      activity: t.activity,
      costUsd: t.costUsd,
      startedAt: t.startedAt,
      ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
    }));
  }

  async snapshot(appId: string, who: ContextPerson): Promise<ContextSnapshot> {
    const app = this.app(appId, who.team);
    const row = this.row(appId, who.team);
    const l = await this.open(appId);
    const open = questionsFrom(appId, l.y.read()).filter((q) => q.status === "open").length;
    const members = this.members(appId, app.createdBy, who);
    const draft = this.draftable(app, row, l.y.read());
    return {
      state: row.state,
      me: members.find((m) => m.user === who.user)!,
      members,
      proposals: this.opts.store.list<ProposalRow>(C.proposals, (p) => p.appId === appId).sort((a, b) => a.at.localeCompare(b.at)),
      changes: row.changes,
      agent: this.agentStatus(row, l, open),
      turns: this.turns(row, open),
      threads: this.opts.store.list<Thread>(C.threads, (t) => t.appId === appId).sort((a, b) => a.at.localeCompare(b.at)),
      signoffs: this.opts.store.list<SignOff & { id: string }>(C.signoffs, (x) => x.appId === appId).map(({ id: _, ...x }) => x),
      versions: row.versions ?? {},
      ...(draft ? { draft: draft.from } : {}),
    };
  }

  /**
   * What an empty Context could be drafted from, if anything: nothing for an App the agent already
   * drafted, one with a first prompt still on its way, or a fresh template App nobody has talked to.
   */
  private draftable(app: App, row: Row, blocks: DocBlock[]): { from: DraftSource; conversations: DraftConversation[] } | undefined {
    if (row.drafted || app.firstPrompt || app.status !== "ready") return undefined;
    if (blocks.some((b) => b.text.trim()) || questionsFrom(app.id, blocks).length) return undefined;
    const found = this.opts.studio.getApp(app.id);
    if (!found) return undefined;
    const thread = this.chat(row);
    if (thread?.chat.status === "working") return undefined;
    const conversations: DraftConversation[] = [];
    for (const c of [...found.chats].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const turns = (this.opts.studio.getChat(c.id)?.turns ?? []).filter((t) => t.prompt.trim()).map((t) => ({ prompt: t.prompt, ...(t.reply?.trim() ? { reply: t.reply } : {}) }));
      if (turns.length) conversations.push({ title: c.id === row.chatId ? "This page's thread" : c.title, turns });
    }
    if (conversations.length) return { from: "conversations", conversations };
    const changed = found.versions.some((v) => v.kind !== "initial");
    return app.source.kind === "repo" || changed ? { from: "code", conversations } : undefined;
  }

  /**
   * Starts the agent on drafting an empty Context from the App's code and earlier conversations, so
   * opening such an App never lands on an empty page. Once per App; an editor's call; a no-op when
   * there is nothing to draft from or the Context already has something in it.
   */
  async draft(appId: string, who: ContextPerson): Promise<{ started: boolean }> {
    const app = this.app(appId, who.team);
    const me = this.member(appId, who);
    if (!canEdit(me.permission)) return { started: false };
    const l = await this.open(appId);
    const row = this.row(appId, who.team);
    const draft = this.draftable(app, row, l.y.read());
    if (!draft) return { started: false };
    // Recorded before the turn starts, so a second page opening at the same moment doesn't start another.
    this.save({ ...row, drafted: this.now() });
    try {
      await this.send(appId, who, draftPrompt({ repository: app.source.kind === "repo", conversations: draft.conversations }), me.permission);
    } catch (err) {
      const now = this.row(appId, who.team);
      const { drafted: _, ...rest } = now;
      this.save(rest);
      throw err;
    }
    this.emit(l, { type: "changed" });
    return { started: true };
  }

  /** The Brief: five lines from the Context at its current version, cached per version. */
  async brief(appId: string, who: ContextPerson): Promise<{ version: number; lines: string[] }> {
    const app = this.app(appId, who.team);
    const row = this.row(appId, who.team);
    if (row.state.brief && row.state.briefVersion === row.state.version) return { version: row.state.version, lines: JSON.parse(row.state.brief) as string[] };
    const blocks = (await this.open(appId)).y.read();
    const lines = briefLines({
      app: app.name,
      fragments: fragmentsFrom(appId, blocks),
      questions: questionsFrom(appId, blocks),
      proposals: this.opts.store.list<ProposalRow>(C.proposals, (p) => p.appId === appId),
      fresh: freshness(row.state, row.changes),
    });
    if (this.opts.store.get<Row>(C.context, appId)) this.save({ ...row, state: { ...row.state, brief: JSON.stringify(lines), briefVersion: row.state.version } });
    return { version: row.state.version, lines };
  }

  async preview(appId: string, who: ContextPerson): Promise<Preview> {
    this.app(appId, who.team);
    const row = this.row(appId, who.team);
    if (!row.chatId || !this.opts.studio.getChat(row.chatId)) throw new StudioError("not_found", "Nothing has been built yet");
    return this.opts.studio.preview({ chatId: row.chatId });
  }

  /** The Context as Markdown, each fragment with its id: what `context_read` returns and what ships as docs/context.md. */
  async markdown(appId: string, fragment?: string): Promise<string> {
    const blocks = (await this.open(appId)).y.read();
    const depth = (b: DocBlock): number => (b.parent ? 1 + depth(blocks.find((x) => x.id === b.parent) ?? { ...b, parent: undefined }) : 0);
    const under = (b: DocBlock): boolean => !fragment || b.id === fragment || (b.parent ? under(blocks.find((x) => x.id === b.parent) ?? { ...b, parent: undefined }) : false);
    const lines: string[] = [];
    for (const b of blocks.filter(under)) {
      const pad = "  ".repeat(depth(b));
      if (b.type === QUESTION_BLOCK) {
        const q = questionsFrom(appId, [b])[0];
        if (!q) continue;
        const said = q.answer && q.status !== "open" ? answerText(q.spec, q.answer) : undefined;
        lines.push(`${pad}- [${q.status === "answered" ? "decision" : q.status === "delegated" ? "assumption" : `question, ${q.status}`}] ${q.spec.title}${said ? ` → ${said}` : ""} <!-- ${b.id} -->`);
      } else if (b.type === "heading") lines.push("", `${"#".repeat(Number(b.props.level ?? 1))} ${b.text} <!-- ${b.id} -->`);
      else if (b.type === "checkListItem") lines.push(`${pad}- [${b.props.checked ? "x" : " "}] ${b.text} <!-- ${b.id} -->`);
      else if (b.text.trim()) lines.push(`${pad}${b.type in markdownMark ? (markdownMark[b.type] ? `${markdownMark[b.type]} ` : "") : `- [${b.type}] `}${b.text} <!-- ${b.id} -->`);
    }
    return lines.join("\n").trim() || "(The Context is empty.)";
  }

  /**
   * The Context for the App's repository (docs/context.md and docs/context.json), or undefined
   * while it has no fragment. Not checked against a person: the caller is Kiln itself, or a route that checked.
   */
  async export(appId: string): Promise<ContextExport | undefined> {
    const row = this.opts.store.get<Row>(C.context, appId);
    const blocks = (await this.open(appId)).y.read();
    const fragments = fragmentsFrom(appId, blocks, row?.versions ?? {});
    if (!fragments.length) return undefined;
    const json = { version: row?.state.version ?? 0, builtVersion: row?.state.builtVersion ?? null, fragments, questions: questionsFrom(appId, blocks) };
    return { markdown: await this.markdown(appId), json };
  }

  // --- sync -------------------------------------------------------------------------------------

  /** The whole document and everyone's presence, for a page that just opened. */
  async syncState(appId: string, who: ContextPerson): Promise<{ update: Uint8Array; awareness: Uint8Array }> {
    this.app(appId, who.team);
    const l = await this.open(appId);
    return { update: Y.encodeStateAsUpdate(l.doc), awareness: encodeAwarenessUpdate(l.awareness, [...l.awareness.getStates().keys()]) };
  }

  /** Calls `listener` with every change to the App's document and presence, and when its snapshot changed. */
  async subscribe(appId: string, who: ContextPerson, listener: Listener): Promise<() => void> {
    this.app(appId, who.team);
    const l = await this.open(appId);
    l.listeners.add(listener);
    return () => void l.listeners.delete(listener);
  }

  /** A page's change to the document. Only an editor's is applied: this is the gate, whatever the page allows. */
  async applyUpdate(appId: string, who: ContextPerson, update: Uint8Array, client?: string): Promise<void> {
    this.editor(appId, who, "edits the Context");
    const row = this.row(appId, who.team);
    if (!this.opts.store.get<Row>(C.context, appId)) this.save(row);
    const l = await this.open(appId);
    l.people.add(who.user);
    try {
      Y.applyUpdate(l.doc, update, { client, user: who.user });
    } catch {
      throw new StudioError("invalid", "That is not a valid document update");
    }
  }

  /** A page's presence (its cursor and name). Everyone's is shared, viewers' too. */
  async applyAwareness(appId: string, who: ContextPerson, update: Uint8Array, client?: string): Promise<void> {
    this.app(appId, who.team);
    const l = await this.open(appId);
    try {
      applyAwarenessUpdate(l.awareness, update, client ?? "page");
    } catch {
      throw new StudioError("invalid", "That is not a valid presence update");
    }
  }

  /** A page closed: its presence goes. */
  async leave(appId: string, clientIds: number[]): Promise<void> {
    const l = await this.live.get(appId);
    if (l) removeAwarenessStates(l.awareness, clientIds, "leave");
  }

  // --- the thread -------------------------------------------------------------------------------

  private async send(appId: string, who: ContextPerson, text: string, permission: Permission): Promise<{ turn: Turn; steered: boolean }> {
    let row = this.row(appId, who.team);
    // A viewer's turn may read and propose; Studio discards any code it changes.
    const mode = canEdit(permission) ? "build" : "chat";
    if (!row.chatId || !this.opts.studio.getChat(row.chatId)) {
      const { chat } = await this.opts.studio.newChat(appId, { by: who.user, via: "web", title: "Context", mode });
      row = this.save({ ...this.row(appId, who.team), chatId: chat.id });
    } else if (!this.opts.store.get<Row>(C.context, appId)) row = this.save(row);
    return this.opts.studio.send(row.chatId!, { by: who.user, via: "web", text, mode, note: CONTEXT_NOTES });
  }

  /** A request from the composer. The page sends no mode. While a turn runs it steers that turn. */
  async prompt(appId: string, who: ContextPerson, text: string): Promise<{ turn: ContextTurn; steered: boolean }> {
    const me = this.member(appId, who);
    const r = await this.send(appId, who, text, me.permission);
    const l = await this.open(appId);
    this.emit(l, { type: "changed" });
    const snap = await this.snapshot(appId, who);
    return { turn: snap.turns.find((t) => t.id === r.turn.id) ?? snap.turns.at(-1)!, steered: r.steered };
  }

  async build(appId: string, who: ContextPerson): Promise<void> {
    const me = this.editor(appId, who, "builds");
    const row = this.row(appId, who.team);
    if (this.chat(row)?.chat.status === "working") throw new StudioError("busy", "The agent is already working");
    await this.send(appId, who, `${row.state.builtVersion === undefined ? "Build" : "Update"} the prototype from the Context as it is now, then call context_mark_built.`, me.permission);
    this.emit(await this.open(appId), { type: "changed" });
  }

  async stop(appId: string, who: ContextPerson): Promise<void> {
    this.app(appId, who.team);
    const row = this.row(appId, who.team);
    if (row.chatId) await this.opts.studio.stop(row.chatId, who.user);
    const l = await this.open(appId);
    l.agent = undefined;
    this.emit(l, { type: "changed" });
  }

  // --- questions --------------------------------------------------------------------------------

  private async question(appId: string, id: string): Promise<{ l: Live; q: Question; all: Question[] }> {
    const l = await this.open(appId);
    const all = questionsFrom(appId, l.y.read());
    const q = all.find((x) => x.id === id);
    if (!q) throw new StudioError("not_found", "Question not found");
    return { l, q, all };
  }

  /** An editor's answer is recorded in the document at once; a viewer's is a proposal. */
  async answer(appId: string, who: ContextPerson, questionId: string, answer: QuestionAnswer): Promise<{ proposal?: Proposal }> {
    const me = this.member(appId, who);
    const { q } = await this.question(appId, questionId);
    const checked = validateAnswer(q.spec, answer);
    if (!checked.ok) throw new StudioError("invalid", checked.error);
    if (!canEdit(me.permission))
      return {
        proposal: this.addProposal(appId, who.user, { kind: "answer", fragmentId: q.fragmentId, summary: `Answer "${q.spec.title}" with: ${answerText(q.spec, checked.answer)}`, patch: { questionId, answer: checked.answer } }),
      };
    await this.applyAnswer(appId, who, q, checked.answer, who.user);
    return {};
  }

  private async applyAnswer(appId: string, who: ContextPerson, q: Question, answer: QuestionAnswer, by: string) {
    const l = await this.open(appId);
    const status = statusFor(answer);
    // "You decide" records what the agent assumed, so the assumption can be read and overturned.
    const recorded = answer.type === "delegated" ? delegatedAnswer(q.spec) : answer;
    new YContextDoc(l.doc, { user: by }).update(q.fragmentId, { props: questionProps({ ...q, status, answer: recorded, answeredBy: by, answeredAt: this.now() }) });
    l.people.add(by);
    this.opts.bus.publish("studio.question_answered", { appId, questionId: q.id, by, status: status as "answered" | "skipped" | "delegated", priority: "progress" });
    const row = this.row(appId, who.team);
    const batch = row.batches[q.batch.id];
    const all = questionsFrom(appId, l.y.read());
    if (batch?.state === "sent") await this.tell(appId, who, `Answers: the answer to "${q.spec.title}" changed.`, all.filter((x) => x.id === q.id));
    else if (batch && batchProgress(all, q.batch.id).complete) await this.sendBatch(appId, who, q.batch.id);
  }

  /** "Change answer": opens an answered question again. */
  async reopen(appId: string, who: ContextPerson, questionId: string): Promise<void> {
    this.editor(appId, who, "changes an answer");
    const { l, q } = await this.question(appId, questionId);
    new YContextDoc(l.doc, { user: who.user }).update(q.fragmentId, { props: { status: "open", by: "", at: "" } });
    l.people.add(who.user);
  }

  /**
   * Answer every open question at once. `assume` ("Decide all for me"): the agent assumes each answer,
   * marked as an assumption. `recommended` ("Accept all recommended"): each question that has a
   * recommended option, a default or a suggestion gets it as the person's answer; open-ended ones
   * stay open, and their batch goes on once they are answered.
   */
  async continueQuestions(appId: string, who: ContextPerson, how: "assume" | "recommended" = "assume"): Promise<void> {
    this.editor(appId, who, "continues");
    const l = await this.open(appId);
    const row = this.row(appId, who.team);
    const open = questionsFrom(appId, l.y.read()).filter((q) => q.status === "open");
    const y = new YContextDoc(l.doc, { user: who.user });
    for (const q of open) {
      const answer = how === "assume" ? delegatedAnswer(q.spec) : recommendedAnswer(q.spec);
      if (answer) y.update(q.fragmentId, { props: questionProps({ ...q, status: how === "assume" ? "delegated" : "answered", answer, answeredBy: who.user, answeredAt: this.now() }) });
    }
    l.people.add(who.user);
    const all = questionsFrom(appId, l.y.read());
    for (const id of new Set(open.map((q) => q.batch.id))) if (row.batches[id]?.state !== "sent" && batchProgress(all, id).complete) await this.sendBatch(appId, who, id);
  }

  /** The batch is answered: its answers start the agent's next turn. Nothing waits in memory, so a restart loses nothing. */
  private async sendBatch(appId: string, who: ContextPerson, batchId: string) {
    const row = this.row(appId, who.team);
    const batch = row.batches[batchId];
    if (!batch || batch.state === "sent") return;
    this.save({ ...row, batches: { ...row.batches, [batchId]: { ...batch, state: "sent" } } });
    const qs = questionsFrom(appId, (await this.open(appId)).y.read()).filter((q) => q.batch.id === batchId);
    await this.tell(appId, who, `Answers: ${qs.length} ${qs.length === 1 ? "question" : "questions"} answered.`, qs);
  }

  private async tell(appId: string, who: ContextPerson, lead: string, qs: Question[]) {
    const lines = qs.map((q) => {
      const said = q.status === "skipped" || !q.answer ? "skipped: don't write anything for it" : `${answerText(q.spec, q.answer)}${q.status === "delegated" ? " (you were asked to decide; this is the assumed answer, record it as an assumption)" : ""}`;
      return `- ${q.spec.title} → ${said}`;
    });
    const me = this.member(appId, who);
    try {
      await this.send(appId, who, [lead, ...lines, "", "Write what follows from these into the Context, then build or update the prototype."].join("\n"), me.permission);
    } catch (err) {
      // The answers are in the document either way; the person can press Build.
      if (!(err instanceof StudioError)) throw err;
    }
    this.emit(await this.open(appId), { type: "changed" });
  }

  // --- proposals --------------------------------------------------------------------------------

  private addProposal(appId: string, by: string, input: Pick<Proposal, "kind" | "summary" | "patch"> & { fragmentId?: string }): Proposal {
    const p: Proposal = { id: this.id("sp"), appId, by, status: "open", at: this.now(), ...input };
    this.opts.store.put<ProposalRow>(C.proposals, p);
    this.opts.bus.publish("studio.proposal_opened", { appId, proposalId: p.id, by, summary: p.summary, priority: "needs_you" });
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    return p;
  }

  async propose(appId: string, who: ContextPerson, input: Pick<Proposal, "kind" | "summary" | "patch"> & { fragmentId?: string }): Promise<Proposal> {
    this.app(appId, who.team);
    return this.addProposal(appId, who.user, input);
  }

  async decideProposal(appId: string, who: ContextPerson, proposalId: string, decision: "accept" | "reject", reason?: string): Promise<Proposal> {
    const me = this.member(appId, who);
    const p = this.opts.store.get<ProposalRow>(C.proposals, proposalId);
    if (!p || p.appId !== appId) throw new StudioError("not_found", "Proposal not found");
    const r = decide(p, me, decision, reason);
    if (!r.ok) throw new StudioError(canEdit(me.permission) ? "conflict" : "forbidden", r.error);
    this.opts.store.put<ProposalRow>(C.proposals, r.proposal);
    if (decision === "accept") await this.applyProposal(appId, who, p);
    this.emit(await this.open(appId), { type: "changed" });
    return r.proposal;
  }

  private async applyProposal(appId: string, who: ContextPerson, p: Proposal) {
    const l = await this.open(appId);
    const y = new YContextDoc(l.doc, { user: p.by });
    l.people.add(p.by);
    const patch = (p.patch ?? {}) as { type?: string; text?: string; section?: string; owner?: string; reviewers?: string[]; questionId?: string; answer?: QuestionAnswer; from?: string; to?: string };
    if (p.kind === "add" && patch.text) {
      const after = this.sectionEnd(y, patch.section ?? "Requirements");
      y.insert({ type: patch.type ?? "requirement", text: patch.text, props: { by: p.by, at: this.now(), ownerRole: patch.owner ?? "product", reviewerRoles: (patch.reviewers ?? []).join(",") } }, after ? { after } : "end");
    } else if (p.kind === "answer" && patch.questionId && patch.answer) {
      const { q } = await this.question(appId, patch.questionId);
      await this.applyAnswer(appId, who, q, patch.answer, p.by);
    } else if (p.kind === "edit" && p.fragmentId && patch.to !== undefined) {
      const block = y.read().find((b) => b.id === p.fragmentId);
      if (block) y.update(block.id, { text: patch.from && block.text.includes(patch.from) ? block.text.replace(patch.from, patch.to) : patch.to });
    } else if (p.kind === "remove" && p.fragmentId) y.remove(p.fragmentId);
  }

  // --- threads and review -------------------------------------------------------------------------

  private async fragment(appId: string, fragmentId: string) {
    const l = await this.open(appId);
    const row = this.opts.store.get<Row>(C.context, appId);
    const f = fragmentsFrom(appId, l.y.read(), row?.versions ?? {}).find((x) => x.id === fragmentId);
    if (!f) throw new StudioError("not_found", "That fragment is not in the Context");
    return { l, f };
  }

  /** A comment on a fragment: a new thread, or a reply in one. Viewers comment too. */
  async comment(appId: string, who: ContextPerson, input: { fragmentId?: string; threadId?: string; text: string }): Promise<Thread> {
    this.app(appId, who.team);
    const text = input.text.trim();
    if (!text) throw new StudioError("invalid", "Write a comment");
    const comment = { id: this.id("cm"), by: who.user, text: text.slice(0, 4000), at: this.now() };
    let thread: Thread;
    if (input.threadId) {
      const was = this.opts.store.get<Thread>(C.threads, input.threadId);
      if (!was || was.appId !== appId) throw new StudioError("not_found", "Thread not found");
      // A reply opens a resolved thread again.
      const { resolvedBy: _, ...rest } = was;
      thread = { ...rest, status: "open", comments: [...was.comments, comment] };
    } else {
      if (!input.fragmentId) throw new StudioError("invalid", "A new thread is on a fragment");
      const { f } = await this.fragment(appId, input.fragmentId);
      thread = { id: this.id("th"), appId, fragmentId: f.id, title: fragmentTitle(f.content, 80), comments: [comment], status: "open", at: comment.at };
    }
    this.opts.store.put<Thread>(C.threads, thread);
    this.opts.bus.publish("studio.comment_added", { appId, threadId: thread.id, fragmentId: thread.fragmentId, by: who.user, priority: "progress" });
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    return thread;
  }

  async resolveThread(appId: string, who: ContextPerson, threadId: string, resolved: boolean): Promise<Thread> {
    this.app(appId, who.team);
    const was = this.opts.store.get<Thread>(C.threads, threadId);
    if (!was || was.appId !== appId) throw new StudioError("not_found", "Thread not found");
    const { resolvedBy: _, ...rest } = was;
    const thread: Thread = resolved ? { ...rest, status: "resolved", resolvedBy: who.user } : { ...rest, status: "open" };
    this.opts.store.put<Thread>(C.threads, thread);
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    return thread;
  }

  /** A reviewer's verdict on a fragment at its current version, for their own role. It goes stale when the fragment changes. */
  async signOff(appId: string, who: ContextPerson, fragmentId: string, state: "approved" | "changes"): Promise<SignOff> {
    const me = this.member(appId, who);
    const { f } = await this.fragment(appId, fragmentId);
    if (!f.reviewerRoles.includes(me.role)) throw new StudioError("forbidden", `This fragment isn't waiting for ${me.role}'s review`);
    const signoff: SignOff = { appId, fragmentId, role: me.role, by: who.user, state, version: f.version, at: this.now() };
    this.opts.store.put<SignOff & { id: string }>(C.signoffs, { ...signoff, id: `${appId}:${fragmentId}:${me.role}` });
    void this.live.get(appId)?.then((l) => this.emit(l, { type: "changed" }));
    return signoff;
  }

  /** Anyone may ask another role to review a fragment. */
  async requestReview(appId: string, who: ContextPerson, fragmentId: string, role: FunctionalRole): Promise<void> {
    this.app(appId, who.team);
    const { l, f } = await this.fragment(appId, fragmentId);
    const block = l.y.read().find((b) => b.id === fragmentId)!;
    if (!(TYPED_FRAGMENTS as readonly string[]).includes(block.type)) throw new StudioError("invalid", "Only a typed fragment (a requirement, a risk, ...) is reviewed");
    if (!f.reviewerRoles.includes(role)) new YContextDoc(l.doc, { user: who.user }).update(fragmentId, { props: { reviewerRoles: [...f.reviewerRoles, role].join(",") } });
    this.opts.bus.publish("studio.review_requested", { appId, fragmentId, role, by: who.user, priority: "needs_you" });
    this.emit(l, { type: "changed" });
  }

  // --- the agent's tools ------------------------------------------------------------------------

  /** Where a new section's heading goes: before the first section that reads after it (SECTION_ORDER). Undefined puts it last. */
  private sectionPlace(y: YContextDoc, title: string): { before: string } | undefined {
    const order = SECTION_ORDER.map((x) => x.toLowerCase());
    const rank = (t: string) => {
      const at = order.indexOf(t.trim().toLowerCase());
      // A section the order doesn't name reads with the product's own sections, before the plan's log.
      return at < 0 ? order.indexOf("constraints") - 0.5 : at;
    };
    const mine = rank(title);
    const later = y.read().find((b) => !b.parent && b.type === "heading" && Number(b.props.level ?? 1) > 1 && rank(b.text) > mine);
    return later ? { before: later.id } : undefined;
  }

  /** The last block of a section (its heading when it is empty), making the heading when it isn't there. */
  private sectionEnd(y: YContextDoc, title: string, touched?: Set<string>): string | undefined {
    const blocks = y.read().filter((b) => !b.parent);
    let i = blocks.findIndex((b) => b.type === "heading" && b.text.trim().toLowerCase() === title.trim().toLowerCase());
    if (i < 0) {
      const last = blocks.findLast((b) => b.text || b.type !== "paragraph");
      const id = y.insert({ type: "heading", props: { level: 2 }, text: title }, this.sectionPlace(y, title) ?? (last ? { after: last.id } : blocks[0] ? { before: blocks[0].id } : "end"));
      touched?.add(id);
      return id;
    }
    let end = blocks[i]!;
    for (i += 1; i < blocks.length && blocks[i]!.type !== "heading"; i += 1) if (blocks[i]!.text || blocks[i]!.type !== "paragraph") end = blocks[i]!;
    return end.id;
  }

  /**
   * One call of an agent's tool, on behalf of `who`: the person who prompted the turn. An editor's
   * turn writes the document as the agent peer; a viewer's turn gets proposals back.
   */
  async tool(appId: string, who: ContextPerson, called: string, input: unknown, turn?: { id: string }): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    // The agent sees every tool as context_<name>.
    const name = called.replace(/^context_(ask|link_preview|mark_built)$/, "$1");
    if (!(name in CONTEXT_TOOLS)) return { ok: false, error: `Unknown tool: ${called}` };
    const parsed = CONTEXT_TOOLS[name as ContextToolName].input.safeParse(input ?? {});
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    try {
      return { ok: true, data: await this.run(appId, who, name as ContextToolName, parsed.data as never, turn) };
    } catch (err) {
      if (err instanceof StudioError) return { ok: false, error: err.message };
      throw err;
    }
  }

  private async run(appId: string, who: ContextPerson, name: ContextToolName, input: Record<string, unknown>, turn?: { id: string }): Promise<unknown> {
    const me = this.member(appId, who);
    const l = await this.open(appId);
    let row = this.row(appId, who.team);
    if (!this.opts.store.get<Row>(C.context, appId)) row = this.save(row);
    const writes = canEdit(me.permission);
    const status = (s: Omit<AgentStatus, "turnId">) => {
      if (!turn) return;
      l.agent = { ...s, turnId: turn.id };
      this.emit(l, { type: "changed" });
    };
    const touch = (id: string) => (l.agentTouched.add(id), id);
    const proposed = (p: Proposal) => ({ proposed: p.id, note: `${who.name ?? who.user} is a viewer, so this was proposed, not written. An editor accepts or rejects it.` });

    switch (name) {
      case "context_read": {
        if (turn) this.save({ ...row, read: { ...Object.fromEntries(Object.entries(row.read).slice(-20)), [turn.id]: row.state.version } });
        return { version: row.state.version, builtVersion: row.state.builtVersion ?? null, context: await this.markdown(appId, input.fragment as string | undefined) };
      }
      case "context_write": {
        const i = input as z.infer<(typeof CONTEXT_TOOLS)["context_write"]["input"]>;
        const type = i.type === "text" ? "paragraph" : i.type === "section" || i.type === "title" ? "heading" : i.type === "step" ? "checkListItem" : i.type === "bullet" ? "bulletListItem" : i.type;
        if (!WRITABLE_BLOCKS.includes(type)) throw new StudioError("invalid", `Can't write a ${i.type} fragment`);
        // The document has one title: writing it again rewrites it.
        const titleBlock = i.type === "title" ? l.y.read().find((b) => !b.parent && b.type === "heading" && Number(b.props.level ?? 1) === 1) : undefined;
        const existing = i.id ? l.y.read().find((b) => b.id === i.id) : titleBlock;
        if (i.id && !existing) throw new StudioError("not_found", `No fragment ${i.id}`);
        if (!writes)
          return proposed(
            this.addProposal(appId, who.user, existing
              ? { kind: "edit", fragmentId: existing.id, summary: `Change "${fragmentTitle(existing.text, 48)}" to "${fragmentTitle(i.content, 48)}"`, patch: { from: existing.text, to: i.content } }
              : { kind: "add", summary: `Add a ${i.type}: ${fragmentTitle(i.content, 80)}`, patch: { type, text: i.content, section: i.section, owner: i.ownerRole, reviewers: i.reviewerRoles } }),
          );
        const props: DocProps =
          type === "heading"
            ? { level: i.type === "title" ? 1 : 2 }
            : type === "checkListItem"
              ? { checked: Boolean(i.done) }
              : type === "paragraph" || type === "bulletListItem"
                ? {}
              : {
                  by: "agent",
                  at: this.now(),
                  ...(i.ownerRole ? { ownerRole: i.ownerRole } : {}),
                  ...(i.reviewerRoles ? { reviewerRoles: i.reviewerRoles.join(",") } : {}),
                  ...(i.previewReference ? { route: i.previewReference.route, selector: i.previewReference.selector ?? "" } : {}),
                };
        status({ state: "writing", label: "Writing", object: `${i.section ? `${i.section} › ` : ""}${fragmentTitle(i.content, 28)}`, ...(existing ? { fragmentId: existing.id } : {}) });
        if (existing) {
          l.y.update(existing.id, { ...(existing.type !== type ? { type } : {}), props, text: "" });
          this.stream(l, touch(existing.id), i.content);
          return { id: existing.id, replaced: true };
        }
        const place = i.parent && l.y.read().some((b) => b.id === i.parent) ? { parent: i.parent } : i.after && l.y.read().some((b) => b.id === i.after) ? { after: i.after } : undefined;
        const top = l.y.read().find((b) => !b.parent);
        const intro = l.y.read().filter((b) => !b.parent);
        // Plain text with no section belongs to the opening: under the title, before the first section.
        const opening = () => {
          const firstSection = intro.findIndex((b) => b.type === "heading" && Number(b.props.level ?? 1) > 1);
          const before = (firstSection < 0 ? intro : intro.slice(0, firstSection)).findLast((b) => b.text || b.type !== "paragraph");
          return before ? { after: before.id } : firstSection >= 0 ? { before: intro[firstSection]!.id } : undefined;
        };
        const where =
          place ??
          (i.type === "title"
            ? top && { before: top.id }
            : type === "heading"
              ? this.sectionPlace(l.y, i.content)
              : i.section
                ? { after: this.sectionEnd(l.y, i.section, l.agentTouched)! }
                : opening());
        const last = l.y.read().findLast((b) => !b.parent && (b.text || b.type !== "paragraph"));
        const id = touch(l.y.insert({ type, props }, where ?? (last ? { after: last.id } : "end")));
        if (turn) l.agent = { ...l.agent!, fragmentId: id };
        this.stream(l, id, i.content);
        return { id };
      }
      case "context_remove": {
        const block = l.y.read().find((b) => b.id === input.id);
        if (!block) throw new StudioError("not_found", `No fragment ${String(input.id)}`);
        if (!writes) return proposed(this.addProposal(appId, who.user, { kind: "remove", fragmentId: block.id, summary: `Remove "${fragmentTitle(block.text || block.type, 80)}"`, patch: {} }));
        l.agentTouched.add(block.id);
        l.y.remove(block.id);
        return { removed: block.id };
      }
      case "ask": {
        if (!writes) throw new StudioError("forbidden", `${who.name ?? who.user} is a viewer: you can't ask them to decide. Propose changes with context_write, and say what an editor would need to decide.`);
        const i = input as z.infer<(typeof CONTEXT_TOOLS)["ask"]["input"]>;
        const batch = this.id("sb");
        let after = this.sectionEnd(l.y, i.section ?? "Decisions", l.agentTouched);
        const asked: { id: string; title: string }[] = [];
        for (const [index, spec] of i.questions.entries()) {
          status({ state: "asking", label: "Asking", object: `${index + 1} of ${i.questions.length}` });
          const q = { id: this.id("sq"), turnId: turn?.id ?? "", spec, status: "open" as const, batch: { id: batch, index, total: i.questions.length } };
          after = touch(l.y.insert({ type: QUESTION_BLOCK, props: questionProps(q) }, after ? { after } : "end"));
          asked.push({ id: q.id, title: spec.title });
        }
        this.save({ ...this.row(appId, who.team), batches: { ...row.batches, [batch]: { state: "asked", turnId: turn?.id ?? "" } } });
        this.opts.bus.publish("studio.question_asked", { appId, turnId: turn?.id ?? "", questions: asked, priority: "needs_you" });
        return { asked: asked.length, note: "The questions are in the Context. End your turn now; the answers arrive as your next message." };
      }
      case "link_preview": {
        const block = l.y.read().find((b) => b.id === input.fragment);
        if (!block) throw new StudioError("not_found", `No fragment ${String(input.fragment)}`);
        if (!(TYPED_FRAGMENTS as readonly string[]).includes(block.type)) throw new StudioError("invalid", "Only a typed fragment (a requirement, a flow, ...) links to the prototype");
        if (!writes) throw new StudioError("forbidden", `${VIEWER_NOTE}; an editor links fragments`);
        l.y.update(block.id, { props: { route: String(input.route), selector: String(input.selector ?? "") } });
        return { linked: block.id };
      }
      case "mark_built": {
        if (!writes) throw new StudioError("forbidden", `${VIEWER_NOTE}; a viewer's turn doesn't build`);
        // What the agent just wrote settles first, so "built" covers it.
        l.cancelSettle?.();
        this.settle(appId, l);
        const current = this.row(appId, who.team);
        const built = Math.max(turn ? (current.read[turn.id] ?? 0) : 0, current.state.version);
        this.save({ ...current, state: { ...current.state, builtVersion: built } });
        status({ state: "building", label: "Building the prototype" });
        return { builtVersion: built };
      }
    }
  }

  /** Text arrives in the fragment a few words at a time, each its own change, so open pages see it being written. */
  private stream(l: Live, id: string, text: string) {
    const words = text.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < words.length; i += 6) l.y.appendText(id, words.slice(i, i + 6).join(""));
  }
}
