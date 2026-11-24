import type * as Y from "yjs";
import { StudioClientError, type ContextBrief, type StudioContextClient } from "./client";
import { questionProps, QUESTION_BLOCK, type ContextDocWriter, type DocBlock, type DocProps } from "./context-doc";
import {
  answerText,
  batchProgress,
  briefLines,
  canEdit,
  decide,
  delegatedAnswer,
  fragmentTitle,
  fragmentsFrom,
  freshness,
  questionsFrom,
  statusFor,
  validateAnswer,
  VIEWER_NOTE,
} from "./context-model";
import { broadcastProvider, type ContextProvider } from "./context-sync";
import type {
  Activity,
  AgentStatus,
  ContextChange,
  ContextSnapshot,
  ContextState,
  ContextTurn,
  FragmentType,
  FunctionalRole,
  Member,
  Preview,
  Proposal,
  Question,
  QuestionAnswer,
  QuestionSpec,
  SignOff,
  StudioApp,
  Thread,
} from "./types";

/** What the Context fake needs from the Studio fake it lives in. */
export type FakeContextHost = {
  now(): Date;
  schedule(fn: () => void, ms: number): void;
  stepMs: number;
  id(prefix: string): string;
  app(id: string): StudioApp | undefined;
  previewBase: string;
  /** False keeps every document local (tests). */
  channel: boolean;
};

const ME = "you@example.com";
const AGENT = "agent";
const IDLE: AgentStatus = { state: "idle", label: "" };
const CANCELLED = Symbol("cancelled");
const BUILD_FILES = ["app/page.tsx", "app/layout.tsx", "components/item-card.tsx", "components/search.tsx", "lib/data.ts", "app/globals.css", "app/api/items/route.ts"];

type Hash = { h: string; title: string; type: FragmentType };
type Batch = { state: "asked" | "written"; kind: "first" | "more"; turnId: string };
type Run = { turnId: string; cancelled: boolean };
type Meta = {
  state: ContextState;
  agent: AgentStatus;
  changes: ContextChange[];
  hashes: Record<string, Hash>;
  versions: Record<string, number>;
  seen: Record<string, { at: string; version: number }>;
  turns: ContextTurn[];
  proposals: Proposal[];
  batches: Record<string, Batch>;
  builds: number;
  seeded: boolean;
  threads: Thread[];
  signoffs: SignOff[];
  /** What the owner set for a person, and the roles people picked. */
  roster: Record<string, { permission?: "editor" | "viewer"; role?: FunctionalRole; name?: string }>;
};

/** What a fragment the agent writes looks like before it is in the document. */
type Draft = { section: string; type: string; text: string; owner?: FunctionalRole; reviewers?: FunctionalRole[]; route?: string; source?: string };
type Ask = { key: string; spec: QuestionSpec };
/** An activity step before it has a time. */
type Step = Activity extends infer A ? (A extends unknown ? Omit<A, "at"> : never) : never;

/**
 * The Context in memory: shared state in a Yjs document that every tab of the origin syncs, and a
 * scripted agent that asks, writes the document through whatever `ContextDocWriter` the page
 * attached, and "builds". It behaves like the contract in docs/specs/studio-context.md.
 */
export class FakeContext implements StudioContextClient {
  private providers = new Map<string, ContextProvider>();
  private metas = new Map<string, ContextProvider>();
  private docs = new Map<string, ContextDocWriter>();
  private runs = new Map<string, Run>();
  private settling = new Map<string, number>();
  /** Blocks the agent touched since the last settle, per App: their changes are the agent's. */
  private agentTouched = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  private as = ME;
  /** Which App gets a written Context when its document is first opened. */
  seedApp?: string;

  constructor(private readonly host: FakeContextHost) {}

  // --- shared state ---------------------------------------------------------------------------

  provider(appId: string): ContextProvider {
    let p = this.providers.get(appId);
    if (!p) this.providers.set(appId, (p = broadcastProvider(`${appId}:context`, { channel: this.host.channel })));
    return p;
  }

  private meta(appId: string): Y.Map<unknown> {
    let p = this.metas.get(appId);
    if (!p) {
      this.metas.set(appId, (p = broadcastProvider(`${appId}:meta`, { channel: this.host.channel })));
      p.doc.getMap("meta").observe(() => this.emit());
    }
    return p.doc.getMap("meta");
  }

  private get<K extends keyof Meta>(appId: string, key: K): Meta[K] {
    const v = this.meta(appId).get(key) as Meta[K] | undefined;
    if (v !== undefined) return v;
    const defaults: Meta = {
      state: { appId, version: 0 },
      agent: IDLE,
      changes: [],
      hashes: {},
      versions: {},
      seen: {},
      turns: [],
      proposals: [],
      batches: {},
      builds: 0,
      seeded: false,
      threads: [],
      signoffs: [],
      roster: {},
    };
    return defaults[key];
  }

  private set<K extends keyof Meta>(appId: string, key: K, value: Meta[K]) {
    this.meta(appId).set(key, value);
  }

  subscribe(_appId: string, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }

  private iso(offsetMs = 0) {
    return new Date(this.host.now().getTime() + offsetMs).toISOString();
  }

  // --- people ---------------------------------------------------------------------------------

  identities(appId = ""): Member[] {
    const base = { appId, invitedBy: ME };
    return [
      { ...base, user: ME, name: "You", permission: "owner", role: "product" },
      { ...base, user: "ada@example.com", name: "Ada", permission: "editor", role: "design" },
      { ...base, user: "sam@example.com", name: "Sam", permission: "viewer", role: "engineering" },
    ];
  }

  setIdentity(user: string): void {
    if (!this.identities().some((m) => m.user === user)) throw new StudioClientError("No such member", 404);
    this.as = user;
    this.emit();
  }

  private members(appId: string): Member[] {
    const seen = this.get(appId, "seen");
    const roster = this.get(appId, "roster");
    const known = this.identities(appId);
    const invited: Member[] = Object.entries(roster)
      .filter(([user]) => !known.some((m) => m.user === user))
      .map(([user, r]) => ({ appId, user, name: r.name ?? user.split("@")[0]!, permission: r.permission ?? "viewer", role: r.role ?? "product", invitedBy: ME }));
    return [...known, ...invited]
      .map((m) => ({ ...m, ...(m.permission !== "owner" && roster[m.user]?.permission ? { permission: roster[m.user]!.permission! } : {}), ...(roster[m.user]?.role ? { role: roster[m.user]!.role! } : {}) }))
      .map((m) => (seen[m.user] ? { ...m, lastSeenAt: seen[m.user]!.at, lastSeenVersion: seen[m.user]!.version } : m));
  }

  private me(appId: string): Member {
    return this.members(appId).find((m) => m.user === this.as)!;
  }

  async markSeen(appId: string): Promise<void> {
    this.set(appId, "seen", { ...this.get(appId, "seen"), [this.as]: { at: this.iso(), version: this.get(appId, "state").version } });
  }

  async setMember(appId: string, input: { user: string; name?: string; permission: "editor" | "viewer"; role: FunctionalRole }): Promise<Member> {
    if (this.me(appId).permission !== "owner") throw new StudioClientError("Only the owner invites members and changes what they may do", 403);
    const user = input.user.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(user)) throw new StudioClientError("A member is added by their email address", 400);
    if (user === ME) throw new StudioClientError("The owner stays the owner", 400);
    this.set(appId, "roster", { ...this.get(appId, "roster"), [user]: { permission: input.permission, role: input.role, ...(input.name ? { name: input.name } : {}) } });
    return this.members(appId).find((m) => m.user === user)!;
  }

  async removeMember(appId: string, user: string): Promise<void> {
    if (this.me(appId).permission !== "owner") throw new StudioClientError("Only the owner removes members", 403);
    const rest = { ...this.get(appId, "roster") };
    delete rest[user];
    this.set(appId, "roster", rest);
  }

  async setRole(appId: string, role: FunctionalRole): Promise<Member> {
    const roster = this.get(appId, "roster");
    this.set(appId, "roster", { ...roster, [this.as]: { ...roster[this.as], role } });
    return this.me(appId);
  }

  async comment(appId: string, input: { fragmentId?: string; threadId?: string; text: string }): Promise<Thread> {
    const text = input.text.trim();
    if (!text) throw new StudioClientError("Write a comment", 400);
    const comment = { id: this.host.id("cm"), by: this.as, text, at: this.iso() };
    const threads = this.get(appId, "threads");
    const was = input.threadId ? threads.find((t) => t.id === input.threadId) : undefined;
    if (input.threadId && !was) throw new StudioClientError("Thread not found", 404);
    const f = was ? undefined : fragmentsFrom(appId, this.doc(appId).read()).find((x) => x.id === input.fragmentId);
    if (!was && !f) throw new StudioClientError("That fragment is not in the Context", 404);
    const thread: Thread = was
      ? { id: was.id, appId, fragmentId: was.fragmentId, title: was.title, at: was.at, status: "open", comments: [...was.comments, comment] }
      : { id: this.host.id("th"), appId, fragmentId: f!.id, title: fragmentTitle(f!.content, 80), comments: [comment], status: "open", at: comment.at };
    this.set(appId, "threads", was ? threads.map((t) => (t.id === thread.id ? thread : t)) : [...threads, thread]);
    return thread;
  }

  async resolveThread(appId: string, threadId: string, resolved: boolean): Promise<Thread> {
    const threads = this.get(appId, "threads");
    const was = threads.find((t) => t.id === threadId);
    if (!was) throw new StudioClientError("Thread not found", 404);
    const rest = { id: was.id, appId: was.appId, fragmentId: was.fragmentId, title: was.title, comments: was.comments, at: was.at };
    const thread: Thread = resolved ? { ...rest, status: "resolved", resolvedBy: this.as } : { ...rest, status: "open" };
    this.set(appId, "threads", threads.map((t) => (t.id === threadId ? thread : t)));
    return thread;
  }

  async signOff(appId: string, fragmentId: string, state: "approved" | "changes"): Promise<SignOff> {
    const me = this.me(appId);
    const f = fragmentsFrom(appId, this.doc(appId).read(), this.get(appId, "versions")).find((x) => x.id === fragmentId);
    if (!f) throw new StudioClientError("That fragment is not in the Context", 404);
    if (!f.reviewerRoles.includes(me.role)) throw new StudioClientError(`This fragment isn't waiting for ${me.role}'s review`, 403);
    const signoff: SignOff = { appId, fragmentId, role: me.role, by: this.as, state, version: f.version, at: this.iso() };
    this.set(appId, "signoffs", [...this.get(appId, "signoffs").filter((x) => !(x.fragmentId === fragmentId && x.role === me.role)), signoff]);
    return signoff;
  }

  async requestReview(appId: string, fragmentId: string, role: FunctionalRole): Promise<void> {
    const f = fragmentsFrom(appId, this.doc(appId).read()).find((x) => x.id === fragmentId);
    if (!f) throw new StudioClientError("That fragment is not in the Context", 404);
    if (!f.reviewerRoles.includes(role)) this.doc(appId).update(fragmentId, { props: { reviewerRoles: [...f.reviewerRoles, role].join(",") } });
  }

  // --- reading --------------------------------------------------------------------------------

  async snapshot(appId: string): Promise<ContextSnapshot> {
    return {
      state: this.get(appId, "state"),
      me: this.me(appId),
      members: this.members(appId),
      proposals: this.get(appId, "proposals"),
      changes: this.get(appId, "changes"),
      agent: this.get(appId, "agent"),
      turns: this.get(appId, "turns"),
      threads: this.get(appId, "threads"),
      signoffs: this.get(appId, "signoffs"),
      versions: this.get(appId, "versions"),
    };
  }

  async brief(appId: string): Promise<ContextBrief> {
    const state = this.get(appId, "state");
    if (state.brief && state.briefVersion === state.version) return { version: state.version, lines: JSON.parse(state.brief) as string[] };
    const blocks = this.docs.get(appId)?.read() ?? [];
    const lines = briefLines({
      app: this.host.app(appId)?.name ?? "This App",
      fragments: fragmentsFrom(appId, blocks),
      questions: questionsFrom(appId, blocks),
      proposals: this.get(appId, "proposals"),
      fresh: freshness(state, this.get(appId, "changes")),
    });
    this.set(appId, "state", { ...state, brief: JSON.stringify(lines), briefVersion: state.version });
    return { version: state.version, lines };
  }

  async preview(appId: string): Promise<Preview> {
    const app = this.host.app(appId);
    const n = 1 + this.get(appId, "builds");
    return { target: appId, url: `${this.host.previewBase}/${appId}?app=${encodeURIComponent(app?.name ?? "App")}&n=${n}`, status: "ready" };
  }

  // --- the document ---------------------------------------------------------------------------

  attachDocument(appId: string, doc: ContextDocWriter): () => void {
    this.docs.set(appId, doc);
    const off = doc.onChange(() => this.changed(appId));
    const metaReady = (this.meta(appId), this.metas.get(appId)!);
    void Promise.all([this.provider(appId).synced, metaReady.synced]).then(() => {
      if (this.docs.get(appId) !== doc) return;
      // A tab that closed mid-turn leaves the agent "working" with nobody to finish it.
      const agent = this.get(appId, "agent");
      if (!this.runs.has(appId) && agent.state !== "idle" && agent.state !== "waiting" && metaReady.peers() === 0) this.set(appId, "agent", IDLE);
      if (this.seedApp === appId && !this.get(appId, "seeded") && !doc.read().some((b) => b.text || b.type === QUESTION_BLOCK)) this.seedDemo(appId);
    });
    return () => {
      off();
      if (this.docs.get(appId) === doc) this.docs.delete(appId);
    };
  }

  /** Whether an App's Context page is open in this tab (its document is attached). */
  isOpen(appId: string): boolean {
    return this.docs.has(appId);
  }

  private doc(appId: string): ContextDocWriter {
    const d = this.docs.get(appId);
    if (!d) throw new StudioClientError("The Context isn't open", 409);
    return d;
  }

  private touched(appId: string): Set<string> {
    let s = this.agentTouched.get(appId);
    if (!s) this.agentTouched.set(appId, (s = new Set()));
    return s;
  }

  /** The document changed: once it settles, bump the version and record which fragments moved. */
  private changed(appId: string) {
    const n = (this.settling.get(appId) ?? 0) + 1;
    this.settling.set(appId, n);
    const jitter = this.host.channel ? Math.random() * 250 : 0;
    this.host.schedule(() => {
      if (this.settling.get(appId) === n && !this.runs.has(appId)) this.settle(appId);
    }, 900 + jitter);
  }

  private settle(appId: string) {
    const doc = this.docs.get(appId);
    if (!doc) return;
    const fragments = fragmentsFrom(appId, doc.read());
    const before = this.get(appId, "hashes");
    const state = this.get(appId, "state");
    const version = state.version + 1;
    const touched = this.touched(appId);
    const after: Record<string, Hash> = {};
    const versions = { ...this.get(appId, "versions") };
    const changes: ContextChange[] = [];
    const record = (fragmentId: string, x: Hash, change: ContextChange["change"]) =>
      changes.push({ version, fragmentId, type: x.type, title: x.title, change, by: touched.has(fragmentId) ? AGENT : this.as, at: this.iso() });
    for (const f of fragments) {
      const x: Hash = { h: `${f.type}|${f.content}`, title: fragmentTitle(f.content), type: f.type };
      after[f.id] = x;
      const was = before[f.id];
      if (was?.h === x.h) continue;
      versions[f.id] = (versions[f.id] ?? 0) + 1;
      record(f.id, x, was ? "edited" : "added");
    }
    for (const [id, was] of Object.entries(before)) if (!after[id]) record(id, was, "removed");
    touched.clear();
    if (!changes.length) return;
    this.set(appId, "hashes", after);
    this.set(appId, "versions", versions);
    this.set(appId, "changes", [...this.get(appId, "changes"), ...changes].slice(-300));
    this.set(appId, "state", { ...state, version });
  }

  // --- turns ----------------------------------------------------------------------------------

  private patchTurn(appId: string, id: string, patch: Partial<ContextTurn>) {
    this.set(
      appId,
      "turns",
      this.get(appId, "turns").map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  private log(appId: string, turnId: string, a: Step) {
    const t = this.get(appId, "turns").find((x) => x.id === turnId);
    if (t) this.patchTurn(appId, turnId, { activity: [...t.activity, { ...a, at: this.iso() } as Activity], costUsd: t.costUsd + 0.011 });
  }

  private agent(appId: string, run: Run, status: Omit<AgentStatus, "turnId">) {
    if (!run.cancelled) this.set(appId, "agent", { ...status, turnId: run.turnId });
  }

  private async pause(run: Run, ms: number) {
    await new Promise<void>((resolve) => this.host.schedule(resolve, ms));
    if (run.cancelled) throw CANCELLED;
  }

  /** Starts a turn and plays `script`; it ends succeeded unless the script says it waits for the person. */
  private start(appId: string, kind: ContextTurn["kind"], prompt: string, script: (run: Run) => Promise<{ reply?: string; needsYou?: boolean } | void>): ContextTurn {
    const turn: ContextTurn = { id: this.host.id("ct"), appId, by: this.as, kind, prompt, status: "running", activity: [], costUsd: 0, startedAt: this.iso() };
    const run: Run = { turnId: turn.id, cancelled: false };
    this.runs.set(appId, run);
    this.set(appId, "turns", [...this.get(appId, "turns"), turn]);
    this.set(appId, "agent", { state: "thinking", label: "Reading the Context", turnId: turn.id });
    const end = (patch: Partial<ContextTurn>, agent: AgentStatus) => {
      if (this.runs.get(appId) === run) this.runs.delete(appId);
      this.patchTurn(appId, turn.id, { ...patch, finishedAt: this.iso() });
      if (!run.cancelled) this.set(appId, "agent", agent);
      // The agent's writes settle with the turn, so "built" reads the version it just wrote.
      this.settle(appId);
    };
    void script(run).then(
      (r) => end({ status: r?.needsYou ? "needs_you" : "succeeded", ...(r?.reply ? { reply: r.reply } : {}) }, r?.needsYou ? { state: "waiting", label: "Waiting", turnId: turn.id } : IDLE),
      (err: unknown) => end(err === CANCELLED ? { status: "cancelled" } : { status: "failed", reply: err instanceof Error ? err.message : String(err) }, IDLE),
    );
    return turn;
  }

  async stop(appId: string): Promise<void> {
    const run = this.runs.get(appId);
    if (run) run.cancelled = true;
    this.runs.delete(appId);
    const agent = this.get(appId, "agent");
    this.set(appId, "agent", IDLE);
    if (agent.turnId) this.patchTurn(appId, agent.turnId, { status: "cancelled", finishedAt: this.iso() });
  }

  // --- the agent's tools ----------------------------------------------------------------------

  /** `context_write`, streamed: an empty typed block appears at the end of its section, then its text arrives. */
  private async write(appId: string, run: Run, d: Draft): Promise<string> {
    const doc = this.doc(appId);
    const after = this.sectionEnd(appId, d.section);
    const props: DocProps = { by: AGENT, at: this.iso(), ownerRole: d.owner ?? "product", reviewerRoles: (d.reviewers ?? []).join(","), ...(d.route ? { route: d.route } : {}), ...(d.source ? { source: d.source } : {}) };
    const id = doc.insert({ type: d.type, props: d.type === "paragraph" ? {} : props }, after ? { after } : "end");
    this.touched(appId).add(id);
    await this.type(appId, run, id, d.text, `${d.section} › ${fragmentTitle(d.text, 28)}`);
    return id;
  }

  private async type(appId: string, run: Run, id: string, text: string, object: string) {
    const doc = this.doc(appId);
    this.agent(appId, run, { state: "writing", label: "Writing", object, fragmentId: id });
    this.touched(appId).add(id);
    for (const word of text.match(/\S+\s*/g) ?? []) {
      await this.pause(run, Math.max(8, this.host.stepMs / 22));
      doc.appendText(id, word);
    }
  }

  /** The last block of a section (its heading when it is empty), making the heading when it isn't there. */
  private sectionEnd(appId: string, title: string): string | undefined {
    const doc = this.doc(appId);
    const blocks = doc.read().filter((b) => !b.parent);
    let i = blocks.findIndex((b) => b.type === "heading" && b.text.trim() === title);
    if (i < 0) {
      const last = [...blocks].reverse().find((b) => b.text || b.type !== "paragraph");
      const id = doc.insert({ type: "heading", props: { level: 2 }, text: title }, last ? { after: last.id } : blocks[0] ? { before: blocks[0].id } : "end");
      this.touched(appId).add(id);
      return id;
    }
    let end = blocks[i]!;
    for (i += 1; i < blocks.length && blocks[i]!.type !== "heading"; i += 1) if (blocks[i]!.text || blocks[i]!.type !== "paragraph") end = blocks[i]!;
    return end.id;
  }

  /** `ask`: question blocks under Decisions, and the turn ends waiting for the person. */
  private async ask(appId: string, run: Run, kind: Batch["kind"], asks: Ask[]) {
    const doc = this.doc(appId);
    const batch = this.host.id("sb");
    let after = this.sectionEnd(appId, "Decisions");
    for (const [index, a] of asks.entries()) {
      this.agent(appId, run, { state: "asking", label: "Asking", object: `${index + 1} of ${asks.length}` });
      await this.pause(run, this.host.stepMs / 2);
      const q: Question = { id: `sq_${a.key}_${this.host.id("q").slice(2)}`, appId, chatId: "main", turnId: run.turnId, fragmentId: "", spec: a.spec, status: "open", batch: { id: batch, index, total: asks.length } };
      after = doc.insert({ type: QUESTION_BLOCK, props: questionProps(q) }, after ? { after } : "end");
      this.touched(appId).add(after);
      this.log(appId, run.turnId, { kind: "tool", name: "ask", text: a.spec.title });
    }
    this.set(appId, "batches", { ...this.get(appId, "batches"), [batch]: { state: "asked", kind, turnId: run.turnId } });
  }

  /** The build: files tick by, then `mark_built` records the version it read. */
  private async buildNow(appId: string, run: Run) {
    for (const [i, file] of BUILD_FILES.entries()) {
      this.agent(appId, run, { state: "building", label: "Building the prototype", done: i, total: BUILD_FILES.length });
      await this.pause(run, this.host.stepMs / 2);
      this.log(appId, run.turnId, { kind: "tool", name: i % 3 ? "Edit" : "Write", text: file });
    }
    this.agent(appId, run, { state: "building", label: "Building the prototype", done: BUILD_FILES.length, total: BUILD_FILES.length });
    await this.pause(run, this.host.stepMs / 2);
    this.settle(appId);
    this.set(appId, "builds", this.get(appId, "builds") + 1);
    this.set(appId, "state", { ...this.get(appId, "state"), builtVersion: this.get(appId, "state").version });
    this.log(appId, run.turnId, { kind: "tool", name: "mark_built" });
  }

  // --- what a person does ---------------------------------------------------------------------

  async prompt(appId: string, text: string): Promise<{ turn: ContextTurn; steered: boolean }> {
    const running = this.runs.get(appId);
    if (running) {
      this.log(appId, running.turnId, { kind: "message", text: `Got it, also: ${text}` });
      return { turn: this.get(appId, "turns").find((t) => t.id === running.turnId)!, steered: true };
    }
    const me = this.me(appId);
    const blocks = this.doc(appId).read();
    const first = !blocks.some((b) => b.type === QUESTION_BLOCK) && fragmentsFrom(appId, blocks).length < 3;
    const app = this.host.app(appId)?.name ?? "App";
    const topic = topicFor(`${text} ${app}`);
    const script = !canEdit(me.permission)
      ? (run: Run) => this.proposeScript(appId, run, text)
      : first
        ? (run: Run) => this.firstScript(appId, run, text, topic)
        : /\?\s*$/.test(text)
          ? (run: Run) => this.replyScript(appId, run, text)
          : /layout|design|screen|priorit|ask me|mobile/i.test(text)
            ? (run: Run) => this.moreScript(appId, run, text)
            : (run: Run) => this.changeScript(appId, run, text);
    return { turn: this.start(appId, "prompt", text, script), steered: false };
  }

  private async firstScript(appId: string, run: Run, text: string, topic: Topic) {
    const doc = this.doc(appId);
    this.log(appId, run.turnId, { kind: "reasoning", text: "Nothing is decided yet. Name it, say what it is for, then ask before assuming." });
    await this.pause(run, this.host.stepMs);
    const top = doc.read().filter((b) => !b.parent)[0];
    const title = doc.insert({ type: "heading", props: { level: 1 } }, top ? { before: top.id } : "end");
    await this.type(appId, run, title, titleOf(text), "the title");
    const intro = doc.insert({ type: "paragraph" }, { after: title });
    await this.type(appId, run, intro, topic.problem, "Problem");
    this.log(appId, run.turnId, { kind: "tool", name: "context_write", text: "Title and problem" });
    await this.ask(appId, run, "first", [
      {
        key: "audience",
        spec: {
          kind: "single",
          title: "Who is this for first?",
          detail: "It decides whether the first version needs accounts.",
          options: [
            { id: "me", label: "Just me", consequence: "No accounts. Everything stays on this device.", recommended: true },
            { id: "team", label: "A small group", consequence: "Sign-in and shared data from day one." },
            { id: "public", label: "Anyone on the web", consequence: "Public pages, sign-up and moderation." },
          ],
        },
      },
      { key: "scope", spec: { kind: "multi", title: "What belongs in the first version?", detail: "Pick what you would miss on day one.", options: topic.scope.map((s, i) => ({ id: s.id, label: s.label, recommended: i < 2 })) } },
      { key: "polish", spec: { kind: "scale", title: "How finished should the first prototype look?", min: 1, max: 5, step: 1, minLabel: "Rough sketch", maxLabel: "Demo-ready", default: 3 } },
    ]);
    return { needsYou: true, reply: "I have three questions before I write the rest." };
  }

  private async moreScript(appId: string, run: Run, text: string) {
    this.log(appId, run.turnId, { kind: "reasoning", text: `"${fragmentTitle(text, 60)}" changes how the first screen works, so the layout is the person's call.` });
    await this.pause(run, this.host.stepMs);
    await this.ask(appId, run, "more", [
      {
        key: "layout",
        spec: {
          kind: "sketch",
          title: "Which layout for the home screen?",
          options: [
            { id: "list", label: "List", consequence: "Dense. Best for scanning names.", layout: "list" },
            { id: "grid", label: "Cards", consequence: "Visual. Fewer items per screen.", layout: "grid", recommended: true },
            { id: "split", label: "List and detail", consequence: "Two panes on wide screens.", layout: "split" },
            { id: "feed", label: "Feed", consequence: "One item at a time, newest first.", layout: "feed" },
          ],
        },
      },
      {
        key: "priority",
        spec: {
          kind: "rank",
          title: "What matters most on a phone?",
          detail: "Drag to order. The first one wins when they conflict.",
          options: [
            { id: "speed", label: "Opens instantly" },
            { id: "thumb", label: "Usable with one hand" },
            { id: "density", label: "Shows a lot at once" },
          ],
        },
      },
      { key: "offline", spec: { kind: "boolean", title: "Should it work without a connection?", yes: "Yes, offline too", no: "Online only", recommended: false } },
      { key: "empty", spec: { kind: "text", title: "What should the empty state say?", placeholder: "One friendly line", suggestion: "Nothing here yet. Add your first one." } },
    ]);
    return { needsYou: true, reply: "Four questions about the layout." };
  }

  private async replyScript(appId: string, run: Run, text: string) {
    this.log(appId, run.turnId, { kind: "tool", name: "context_read" });
    await this.pause(run, this.host.stepMs * 2);
    const blocks = this.doc(appId).read();
    const requirements = fragmentsFrom(appId, blocks).filter((f) => f.type === "requirement");
    const open = questionsFrom(appId, blocks).filter((q) => q.status === "open").length;
    const reply = requirements.length
      ? `The Context has ${requirements.length} requirements; the closest to "${fragmentTitle(text, 48)}" is "${fragmentTitle(requirements[0]!.content, 60)}". ${open ? `${open} questions are still open.` : "Nothing in it needs to change for that."}`
      : "The Context doesn't say yet. Answer the open questions and I'll write it down.";
    return { reply };
  }

  private async changeScript(appId: string, run: Run, text: string) {
    this.log(appId, run.turnId, { kind: "tool", name: "context_read" });
    await this.pause(run, this.host.stepMs);
    const draft = requirementFrom(text);
    await this.write(appId, run, draft);
    this.log(appId, run.turnId, { kind: "tool", name: "context_write", text: draft.text });
    await this.buildNow(appId, run);
    return { reply: `Added "${fragmentTitle(draft.text, 60)}" to Requirements and updated the prototype.` };
  }

  /** A viewer's turn: the agent may read, and what it would write is a proposal. */
  private async proposeScript(appId: string, run: Run, text: string) {
    this.log(appId, run.turnId, { kind: "tool", name: "context_read" });
    await this.pause(run, this.host.stepMs * 2);
    const draft = requirementFrom(text);
    this.addProposal(appId, { kind: "add", summary: `Add a requirement: ${fragmentTitle(draft.text, 80)}`, patch: draft });
    this.log(appId, run.turnId, { kind: "tool", name: "context_write", text: "As a proposal: the person who asked is a viewer" });
    return { reply: "Proposed one change. An editor accepts or rejects it." };
  }

  private addProposal(appId: string, input: Pick<Proposal, "kind" | "summary" | "patch"> & { fragmentId?: string }): Proposal {
    const p: Proposal = { id: this.host.id("sp"), appId, by: this.as, status: "open", at: this.iso(), ...input };
    this.set(appId, "proposals", [...this.get(appId, "proposals"), p]);
    return p;
  }

  async propose(appId: string, input: Pick<Proposal, "kind" | "summary" | "patch"> & { fragmentId?: string }): Promise<Proposal> {
    return this.addProposal(appId, input);
  }

  private question(appId: string, id: string): Question {
    const q = questionsFrom(appId, this.doc(appId).read()).find((x) => x.id === id);
    if (!q) throw new StudioClientError("Question not found", 404);
    return q;
  }

  async answer(appId: string, questionId: string, answer: QuestionAnswer): Promise<{ proposal?: Proposal }> {
    const q = this.question(appId, questionId);
    const checked = validateAnswer(q.spec, answer);
    if (!checked.ok) throw new StudioClientError(checked.error, 400);
    if (!canEdit(this.me(appId).permission))
      return {
        proposal: this.addProposal(appId, {
          kind: "answer",
          fragmentId: q.fragmentId,
          summary: `Answer "${q.spec.title}" with: ${answerText(q.spec, checked.answer)}`,
          patch: { questionId, answer: checked.answer },
        }),
      };
    this.applyAnswer(appId, q, checked.answer, this.as);
    return {};
  }

  private applyAnswer(appId: string, q: Question, answer: QuestionAnswer, by: string) {
    const status = statusFor(answer);
    // "You decide" records what the agent assumed, so the assumption can be read and overturned.
    const recorded = answer.type === "delegated" ? delegatedAnswer(q.spec) : answer;
    this.doc(appId).update(q.fragmentId, { props: questionProps({ ...q, status, answer: recorded, answeredBy: by, answeredAt: this.iso() }) });
    const batch = this.get(appId, "batches")[q.batch.id];
    if (!batch || this.runs.has(appId)) return;
    const all = questionsFrom(appId, this.doc(appId).read());
    if (batch.state === "written") {
      this.start(appId, "answers", `Changed the answer to "${q.spec.title}"`, (run) => this.reviseScript(appId, run, all.find((x) => x.id === q.id)!));
    } else if (batchProgress(all, q.batch.id).complete) this.continueBatch(appId, q.batch.id);
  }

  async reopen(appId: string, questionId: string): Promise<void> {
    if (!canEdit(this.me(appId).permission)) throw new StudioClientError(`${VIEWER_NOTE}; an editor changes an answer`, 403);
    const q = this.question(appId, questionId);
    this.doc(appId).update(q.fragmentId, { props: { status: "open", by: "", at: "" } });
  }

  async continueQuestions(appId: string): Promise<void> {
    if (!canEdit(this.me(appId).permission)) throw new StudioClientError(`${VIEWER_NOTE}; an editor continues`, 403);
    const batches = this.get(appId, "batches");
    const open = questionsFrom(appId, this.doc(appId).read()).filter((q) => q.status === "open" && batches[q.batch.id]?.state === "asked");
    const ids = new Set(open.map((q) => q.batch.id));
    for (const q of open) this.doc(appId).update(q.fragmentId, { props: questionProps({ ...q, status: "delegated", answer: delegatedAnswer(q.spec), answeredBy: this.as, answeredAt: this.iso() }) });
    for (const id of ids) if (!this.runs.has(appId)) this.continueBatch(appId, id);
  }

  private continueBatch(appId: string, batchId: string) {
    const batch = this.get(appId, "batches")[batchId];
    if (!batch || batch.state === "written") return;
    this.set(appId, "batches", { ...this.get(appId, "batches"), [batchId]: { ...batch, state: "written" } });
    this.patchTurn(appId, batch.turnId, { status: "succeeded" });
    const qs = questionsFrom(appId, this.doc(appId).read()).filter((q) => q.batch.id === batchId);
    this.start(appId, "answers", `Answered ${qs.length} ${qs.length === 1 ? "question" : "questions"}`, (run) => this.writeScript(appId, run, batch.kind, qs));
  }

  /** The batch is answered: write what follows from it, then build. */
  private async writeScript(appId: string, run: Run, kind: Batch["kind"], qs: Question[]) {
    const topic = topicFor(`${this.host.app(appId)?.name ?? ""} ${this.doc(appId).read()[0]?.text ?? ""}`);
    this.log(appId, run.turnId, { kind: "reasoning", text: "Every answer becomes a requirement or a constraint. Assumptions stay marked so anyone can overturn them." });
    await this.pause(run, this.host.stepMs);
    const drafts = [...qs.flatMap((q) => draftsFor(q, topic)), ...(kind === "first" ? topic.rest : [])];
    for (const d of drafts) {
      await this.write(appId, run, d);
      this.log(appId, run.turnId, { kind: "tool", name: "context_write", text: `${d.type}: ${fragmentTitle(d.text, 70)}` });
      await this.pause(run, this.host.stepMs / 3);
    }
    await this.buildNow(appId, run);
    return { reply: `Wrote ${drafts.length} fragments from your answers and built the prototype.` };
  }

  /** An answer changed after its fragments were written: rewrite them. The prototype is now behind. */
  private async reviseScript(appId: string, run: Run, q: Question) {
    const doc = this.doc(appId);
    await this.pause(run, this.host.stepMs);
    const topic = topicFor(`${this.host.app(appId)?.name ?? ""} ${doc.read()[0]?.text ?? ""}`);
    const drafts = draftsFor(q, topic);
    const old = doc.read().filter((b) => b.props.source === q.id);
    for (const [i, d] of drafts.entries()) {
      const target = old[i];
      if (!target) {
        await this.write(appId, run, d);
        continue;
      }
      doc.update(target.id, { text: "" });
      await this.type(appId, run, target.id, d.text, `${d.section} › ${fragmentTitle(d.text, 28)}`);
    }
    for (const extra of old.slice(drafts.length)) doc.remove(extra.id);
    this.log(appId, run.turnId, { kind: "tool", name: "context_write", text: `Rewrote ${Math.max(drafts.length, old.length)} fragments for the new answer` });
    return { reply: "Updated the Context for the new answer. The prototype is behind until you update it." };
  }

  async build(appId: string): Promise<void> {
    if (!canEdit(this.me(appId).permission)) throw new StudioClientError(`${VIEWER_NOTE}; an editor builds`, 403);
    if (this.runs.has(appId)) throw new StudioClientError("The agent is already working", 409);
    this.start(appId, "build", "Update the prototype", async (run) => {
      this.log(appId, run.turnId, { kind: "tool", name: "context_read" });
      await this.pause(run, this.host.stepMs);
      await this.buildNow(appId, run);
      return { reply: "The prototype is up to date with the Context." };
    });
  }

  async decideProposal(appId: string, proposalId: string, decision: "accept" | "reject", reason?: string): Promise<Proposal> {
    const proposals = this.get(appId, "proposals");
    const p = proposals.find((x) => x.id === proposalId);
    if (!p) throw new StudioClientError("Proposal not found", 404);
    const r = decide(p, this.me(appId), decision, reason);
    if (!r.ok) throw new StudioClientError(r.error, 403);
    this.set(
      appId,
      "proposals",
      proposals.map((x) => (x.id === p.id ? r.proposal : x)),
    );
    if (decision === "accept") this.applyProposal(appId, p);
    return r.proposal;
  }

  private applyProposal(appId: string, p: Proposal) {
    const doc = this.doc(appId);
    const patch = (p.patch ?? {}) as Partial<Draft> & { questionId?: string; answer?: QuestionAnswer; from?: string; to?: string };
    if (p.kind === "add" && patch.text) {
      const after = this.sectionEnd(appId, patch.section ?? "Requirements");
      doc.insert({ type: patch.type ?? "requirement", text: patch.text, props: { by: p.by, at: this.iso(), ownerRole: patch.owner ?? "product", reviewerRoles: (patch.reviewers ?? []).join(",") } }, after ? { after } : "end");
    } else if (p.kind === "answer" && patch.questionId && patch.answer) {
      this.applyAnswer(appId, this.question(appId, patch.questionId), patch.answer, p.by);
    } else if (p.kind === "edit" && p.fragmentId && patch.to !== undefined) {
      const block = doc.read().find((b) => b.id === p.fragmentId);
      if (block) doc.update(block.id, { text: patch.from && block.text.includes(patch.from) ? block.text.replace(patch.from, patch.to) : patch.to });
    } else if (p.kind === "remove" && p.fragmentId) doc.remove(p.fragmentId);
  }

  async askAgent(appId: string, input: { text: string; instruction: string; fragmentId?: string }, onChunk: (chunk: string) => void): Promise<{ text: string }> {
    const text = rewrite(input.text, input.instruction);
    const turn: ContextTurn = { id: this.host.id("ct"), appId, by: this.as, kind: "ask", prompt: `${input.instruction}: "${fragmentTitle(input.text, 80)}"`, status: "running", activity: [], costUsd: 0.004, startedAt: this.iso() };
    this.set(appId, "turns", [...this.get(appId, "turns"), turn]);
    await new Promise<void>((resolve) => this.host.schedule(resolve, this.host.stepMs / 2));
    for (const word of text.match(/\S+\s*/g) ?? []) {
      await new Promise<void>((resolve) => this.host.schedule(resolve, Math.max(8, this.host.stepMs / 18)));
      onChunk(word);
    }
    this.patchTurn(appId, turn.id, { status: "succeeded", reply: text, finishedAt: this.iso() });
    return { text };
  }

  // --- the demo App's written Context ---------------------------------------------------------

  private seedDemo(appId: string) {
    const doc = this.doc(appId);
    this.set(appId, "seeded", true);
    const at = (minAgo: number) => this.iso(-minAgo * 60_000);
    const top = doc.read().filter((b) => !b.parent)[0];
    let last = doc.insert({ type: "heading", props: { level: 1 }, text: "Habit tracker" }, top ? { before: top.id } : "end");
    const add = (type: string, text: string, props: DocProps = {}) => (last = doc.insert({ type, text, props }, { after: last }));
    const typed = (type: string, text: string, owner: FunctionalRole, reviewers: FunctionalRole[], extra: DocProps = {}) =>
      add(type, text, { by: AGENT, at: at(150), ownerRole: owner, reviewerRoles: reviewers.join(","), ...extra });
    const decided = (key: string, index: number, spec: QuestionSpec, answer: QuestionAnswer, status: Question["status"] = "answered") =>
      add(QUESTION_BLOCK, "", questionProps({ id: `sq_${key}_seed`, turnId: "ct_seed1", spec, status, answer, answeredBy: ME, answeredAt: at(165), batch: { id: "sb_seed", index, total: 3 } }));
    add("paragraph", "People start habits and lose track of them within a week. This is a daily list you tick off, with a streak for each habit so a missed day is visible.");
    add("heading", "Decisions", { level: 2 });
    decided(
      "audience",
      0,
      {
        kind: "single",
        title: "Who is this for first?",
        options: [
          { id: "me", label: "Just me", consequence: "No accounts. Everything stays on this device.", recommended: true },
          { id: "team", label: "A small group", consequence: "Sign-in and shared data from day one." },
          { id: "public", label: "Anyone on the web", consequence: "Public pages, sign-up and moderation." },
        ],
      },
      { type: "value", value: "me" },
    );
    decided("scope", 1, { kind: "multi", title: "What belongs in the first version?", options: HABIT.scope.map((s) => ({ id: s.id, label: s.label })) }, { type: "value", value: ["streaks", "heatmap", "dark"] });
    decided("polish", 2, { kind: "scale", title: "How finished should the first prototype look?", min: 1, max: 5, step: 1, minLabel: "Rough sketch", maxLabel: "Demo-ready", default: 3 }, { type: "value", value: 3 }, "delegated");
    add("heading", "Requirements", { level: 2 });
    typed("requirement", "It is built for one person first. No accounts: habits and streaks are saved on this device.", "product", ["engineering"], { source: "sq_audience_seed" });
    typed("requirement", "Each habit shows its streak as a flame badge. A missed day resets it to zero.", "design", ["qa"], { source: "sq_scope_seed", route: "/" });
    typed("requirement", "A two-week heatmap under the list shows how many habits were done each day.", "design", ["data"], { source: "sq_scope_seed", route: "/" });
    typed("requirement", "A dark mode toggle in the header follows the system theme until the person picks one.", "design", [], { source: "sq_scope_seed" });
    add("heading", "Constraints", { level: 2 });
    typed("constraint", "Prototype polish is 3 of 5: real layout and copy, placeholder data.", "product", [], { source: "sq_polish_seed" });
    typed("constraint", "Everything works on a 390 px wide phone; tap targets are at least 32 px.", "engineering", ["design", "qa"]);
    add("heading", "Flow", { level: 2 });
    typed("flow", "Open the app → see today's habits → tick one off → its streak grows → check the heatmap at the end of the week.", "design", []);
    add("heading", "Risks", { level: 2 });
    typed("risk", "Local storage is lost when the browser's data is cleared. Say so before someone relies on a long streak.", "engineering", ["security", "legal"]);
    add("heading", "Success", { level: 2 });
    typed("metric", "Someone who opens it for a week ticks at least one habit on five of seven days.", "data", ["product"]);

    // History, as if it happened over the last three hours: versions 1 to 6, built at 6.
    const fragments = fragmentsFrom(appId, doc.read());
    const hashes: Record<string, Hash> = {};
    const versions: Record<string, number> = {};
    const changes: ContextChange[] = fragments.map((f, i) => {
      hashes[f.id] = { h: `${f.type}|${f.content}`, title: fragmentTitle(f.content), type: f.type };
      versions[f.id] = 1;
      const version = Math.min(6, 1 + Math.floor((i * 6) / fragments.length));
      return { version, fragmentId: f.id, type: f.type, title: fragmentTitle(f.content), change: "added", by: f.type === "decision" ? ME : AGENT, at: at(170 - version * 20) };
    });
    this.touched(appId).clear();
    this.set(appId, "hashes", hashes);
    this.set(appId, "versions", versions);
    this.set(appId, "changes", changes);
    this.set(appId, "builds", 3);
    this.set(appId, "state", { appId, version: 6, builtVersion: 6 });
    this.set(appId, "seen", { [ME]: { at: at(3), version: 6 }, "sam@example.com": { at: at(60 * 50), version: 3 } });
    this.set(appId, "batches", { sb_seed: { state: "written", kind: "first", turnId: "ct_seed1" } });
    const turn = (id: string, minAgo: number, kind: ContextTurn["kind"], prompt: string, reply: string, activity: Step[]): ContextTurn => ({
      id,
      appId,
      by: ME,
      kind,
      prompt,
      status: "succeeded",
      reply,
      activity: activity.map((a, i) => ({ ...a, at: at(minAgo - i * 0.2) }) as Activity),
      costUsd: 0.09,
      startedAt: at(minAgo),
      finishedAt: at(minAgo - 2),
    });
    this.set(appId, "turns", [
      turn("ct_seed1", 170, "prompt", "Daily habits I can tick off, with a streak counter for each", "I have three questions before I write the rest.", [
        { kind: "reasoning", text: "Nothing is decided yet. Name it, say what it is for, then ask before assuming." },
        { kind: "tool", name: "ask", text: "Who is this for first?" },
      ]),
      turn("ct_seed2", 164, "answers", "Answered 3 questions", "Wrote 9 fragments from your answers and built the prototype.", [
        { kind: "tool", name: "context_write", text: "requirement: It is built for one person first." },
        { kind: "tool", name: "Write", text: "app/page.tsx" },
        { kind: "tool", name: "mark_built" },
      ]),
    ]);
  }
}

// --- what the scripted agent writes -------------------------------------------------------------

type Topic = { problem: string; scope: { id: string; label: string; line: string }[]; rest: Draft[] };

const HABIT: Topic = {
  problem: "People start habits and lose track of them within a week. This is a daily list you tick off, with a streak for each habit so a missed day is visible.",
  scope: [
    { id: "streaks", label: "Streaks", line: "Each habit shows its streak as a badge. A missed day resets it to zero." },
    { id: "reminders", label: "Reminders", line: "A habit can remind you once a day at a time you pick." },
    { id: "heatmap", label: "Weekly heatmap", line: "A two-week heatmap under the list shows how many habits were done each day." },
    { id: "dark", label: "Dark mode", line: "A dark mode toggle in the header follows the system theme until you pick one." },
  ],
  rest: [
    { section: "Constraints", type: "constraint", text: "Everything works on a 390 px wide phone, with tap targets of at least 32 px.", owner: "engineering", reviewers: ["design", "qa"] },
    { section: "Flow", type: "flow", text: "Open the app → see today's habits → tick one off → its streak grows.", owner: "design" },
    { section: "Risks", type: "risk", text: "Data kept on one device is lost when the browser's data is cleared. Say so before someone relies on it.", owner: "engineering", reviewers: ["security"] },
    { section: "Success", type: "metric", text: "Someone who opens it for a week ticks at least one habit on five of seven days.", owner: "data", reviewers: ["product"] },
  ],
};

const RECIPE: Topic = {
  problem: "Recipes end up in screenshots, bookmarks and notes, and the one you want is never where you look. This keeps them in one place you can search while you cook.",
  scope: [
    { id: "search", label: "Search", line: "Search matches recipe titles and ingredients as you type.", },
    { id: "tags", label: "Tags", line: "Recipes carry tags (Quick, Vegetarian, Dessert, Batch cook) that filter the list and combine." },
    { id: "favourites", label: "Favourites", line: "A recipe can be starred, and starred recipes sort first." },
    { id: "shopping", label: "Shopping list", line: "Ingredients from a recipe can be added to one shared shopping list." },
  ],
  rest: [
    { section: "Constraints", type: "constraint", text: "Everything works on a 390 px wide phone, with tap targets of at least 32 px.", owner: "engineering", reviewers: ["design", "qa"] },
    { section: "Flow", type: "flow", text: "Open the app → search or pick a tag → open a recipe → cook from it with the screen kept awake.", owner: "design" },
    { section: "Risks", type: "risk", text: "Recipes copied from sites and books may be copyrighted. Keep them private unless the person wrote them.", owner: "product", reviewers: ["legal"] },
    { section: "Success", type: "metric", text: "Someone with twenty saved recipes finds the one they want in under ten seconds.", owner: "data", reviewers: ["product"] },
  ],
};

const GENERIC: Topic = {
  problem: "This Context is the one place that says what is being built and why. The prototype on the right is built from it, and only from it.",
  scope: [
    { id: "search", label: "Search", line: "Search finds an item by any word in it, as you type." },
    { id: "sharing", label: "Sharing", line: "An item can be shared with a link that anyone can open." },
    { id: "reminders", label: "Reminders", line: "An item can remind you at a time you pick." },
    { id: "offline", label: "Offline use", line: "Everything already loaded keeps working without a connection." },
  ],
  rest: [
    { section: "Constraints", type: "constraint", text: "Everything works on a 390 px wide phone, with tap targets of at least 32 px.", owner: "engineering", reviewers: ["design", "qa"] },
    { section: "Flow", type: "flow", text: "Open the app → see what matters now → add or change one thing → come back tomorrow.", owner: "design" },
    { section: "Risks", type: "risk", text: "The first version tries to do too much. Anything not listed under Requirements waits.", owner: "product" },
    { section: "Success", type: "metric", text: "A first-time visitor does the main thing within a minute, without help.", owner: "data", reviewers: ["product"] },
  ],
};

function topicFor(text: string): Topic {
  return /recipe|cook|meal|food/i.test(text) ? RECIPE : /habit|streak|routine/i.test(text) ? HABIT : GENERIC;
}

/** A document title from a prompt: its first clause, without the opener or the article. */
function titleOf(prompt: string): string {
  const clause = prompt
    .replace(/^(please|can you|could you|i want|i'd like|build|make|create)\s+/i, "")
    .replace(/^(me\s+)?(a|an|the)\s+/i, "")
    .split(/[.:,;!?\n]| where | that | with | so /i)[0]!
    .trim();
  const words = clause.split(/\s+/).slice(0, 6).join(" ");
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Untitled";
}

function requirementFrom(prompt: string): Draft {
  const clause = prompt
    .trim()
    .replace(/^(please|can you|could you|i want|i'd like)\s+/i, "")
    .replace(/[.!]+$/, "");
  const text = /^(add|make|show|let|allow|support|change|remove|use)\b/i.test(clause) ? `${clause[0]!.toUpperCase()}${clause.slice(1)}.` : `People can ${clause[0]!.toLowerCase()}${clause.slice(1)}.`;
  return { section: "Requirements", type: "requirement", text, owner: "product", reviewers: ["design"] };
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The fragments one answered question turns into. A skipped question writes nothing; an assumed one is marked on its question. */
function draftsFor(q: Question, topic: Topic): Draft[] {
  if (q.status === "skipped" || q.status === "open" || !q.answer) return [];
  const key = q.id.split("_")[1];
  const said = answerText(q.spec, q.answer);
  const value = q.answer.type === "value" ? q.answer.value : undefined;
  const source = q.id;
  const one = (d: Omit<Draft, "source">): Draft[] => [{ ...d, source }];
  switch (key) {
    case "audience": {
      const consequence = "options" in q.spec ? q.spec.options.find((o) => o.id === value)?.consequence : undefined;
      return one({ section: "Requirements", type: "requirement", text: `It is built for ${lower(said)} first.${consequence ? ` ${consequence}` : ""}`, owner: "product", reviewers: ["engineering"] });
    }
    case "scope": {
      const picked = Array.isArray(value) ? value : [];
      if (!picked.length) return one({ section: "Requirements", type: "requirement", text: `The first version includes: ${said}.`, owner: "product", reviewers: ["design"] });
      return picked.map((id) => ({ section: "Requirements", type: "requirement", text: topic.scope.find((s) => s.id === id)?.line ?? `${id} is part of the first version.`, owner: "design" as const, reviewers: ["qa" as const], route: "/", source }));
    }
    case "polish": {
      const n = typeof value === "number" ? value : 3;
      const what = n <= 2 ? "structure and flow matter more than visual detail" : n >= 4 ? "it should be ready to show to people outside the team" : "real layout and copy, placeholder data";
      return one({ section: "Constraints", type: "constraint", text: `Prototype polish is ${typeof value === "number" ? `${n} of 5` : said}: ${what}.`, owner: "product" });
    }
    case "layout":
      return one({ section: "Requirements", type: "requirement", text: `The home screen uses the ${lower(said)} layout.`, owner: "design", reviewers: ["engineering"], route: "/" });
    case "priority":
      return one({ section: "Constraints", type: "constraint", text: `On a phone, in this order: ${said.replace(/\s{2}/g, ", ")}.`, owner: "design", reviewers: ["engineering"] });
    case "offline":
      return one({ section: "Constraints", type: "constraint", text: value === true ? "It works without a connection: everything already loaded stays usable and syncs later." : `Connection: ${lower(said)}.`, owner: "engineering" });
    case "empty":
      return one({ section: "Requirements", type: "requirement", text: `The empty state reads: "${said}"`, owner: "design" });
    default:
      return one({ section: "Requirements", type: "requirement", text: `${q.spec.title} ${said}.`, owner: "product" });
  }
}

/** A plausible rewrite for "Ask the agent", by what was asked. */
function rewrite(text: string, instruction: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const sentence = (s: string) => (/[.!?"]$/.test(s) ? s : `${s}.`);
  if (/short|concise|tight|brief|trim/i.test(instruction)) {
    const first = t.split(/(?<=[.!?])\s+/)[0]!;
    const cut = first
      .replace(/\b(really|very|just|basically|in order to|that is|able to be)\b\s*/gi, "")
      .replace(/\bshould be able to\b/gi, "can")
      .replace(/\s*\([^)]*\)/g, "")
      .replace(/\s+,/g, ",");
    return sentence(cut === t ? first.split(/[,;:]/)[0]!.trim() : cut.trim());
  }
  if (/specific|measur|precise|testable|concrete/i.test(instruction)) return `${sentence(t)} Done when it holds on a 390 px wide phone and in under two seconds on a slow connection.`;
  if (/expand|detail|longer|more/i.test(instruction)) return `${sentence(t)} Empty, loading and error states each say what happened and what to do next.`;
  if (/formal|professional/i.test(instruction)) return sentence(t.replace(/\bcan't\b/gi, "cannot").replace(/\bdon't\b/gi, "do not").replace(/\byou\b/g, "the person"));
  const plain = t
    .replace(/\bshould be able to\b/gi, "can")
    .replace(/\butili[sz]e\b/gi, "use")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bshould\b/gi, "must");
  return plain === t ? `${sentence(t)} It says what happens when it fails.` : sentence(plain);
}

/** For tests and docs: every block type the scripted agent writes. */
export const AGENT_BLOCK_TYPES: readonly string[] = ["heading", "paragraph", QUESTION_BLOCK, "requirement", "assumption", "constraint", "flow", "risk", "metric"];

export type { DocBlock };
