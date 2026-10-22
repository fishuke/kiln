import { randomBytes } from "node:crypto";
import type { EventBus } from "@kiln/events";
import type { HarnessAdapter, HarnessEvent, HarnessResult, HarnessSession } from "@kiln/harness";
import { shellQuote, type Proc, type Sandbox, type SandboxAddress, type SandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import type { ObjectStore, Store } from "@kiln/store";
import { z } from "zod";
import { detectSetup, devCommand, ENV_EXAMPLES, envKeys, listenPort } from "./setup";
import { DEFAULT_READY, TEMPLATES, type Template } from "./templates";
import {
  COLLECTIONS as C,
  StudioError,
  type Activity,
  type ApplyResult,
  type Chat,
  type ChatMode,
  type Preview,
  type App,
  type AppSetup,
  type AppSource,
  type RepoSource,
  type ShipMode,
  type StatusReport,
  type Turn,
  type Version,
  type Via,
} from "./types";

/** Time comes from here, never from Date (the engine's Clock has the same shape). */
export interface Clock {
  now(): Date;
}

export type StudioOptions = {
  store: Store;
  objects: ObjectStore;
  bus: EventBus;
  clock: Clock;
  /** The one sandbox backend Studio apps run on. */
  sandboxes: SandboxProvider;
  harness: (type: HarnessType) => HarnessAdapter;
  /** Model keys for a harness run (BYOK). */
  credentials?: (app: App, type: HarnessType) => Record<string, string>;
  templates?: Record<string, Template>;
  /** Where prepared templates live ({templates} in a scaffold command); the studio runner image has them at /opt/kiln/templates. */
  templatesDir?: string;
  /** Runner image when the template names none (KILN_STUDIO_IMAGE, else the server's runner image). */
  image: string;
  previewUrl: (target: string, address: SandboxAddress) => string;
  /** Imported apps: a clone URL with a short-lived repo-scoped token, and the branch to use. */
  clone?: (source: RepoSource) => Promise<{ url: string; branch?: string }>;
  /** Environment for installs, dev servers and runs (Kiln secrets and environment templates). */
  env?: (app: App) => AppEnv;
  maxRunningChats?: number;
  /** The version preview listens here, chats on the ports after it. Default 4100. */
  basePort?: number;
  /** Passed to dev servers as KILN_STUDIO_PREVIEW_DOMAIN, so the app allows hot reload from preview origins. */
  previewDomain?: string;
  /** For the preview ready check; defaults to the global fetch. */
  fetch?: typeof fetch;
};

type Dev = { proc: Proc; port: number; state: "starting" | "ready" | "failed" };
/** An App's environment: the values people assigned (team → Kiln Project → App), and which of them are secret. */
export type AppEnv = { env: Record<string, string>; secretValues: string[] };

/** `addresses`: where each dev server port is reachable, asked of the sandbox once per port. */
type Live = { sandbox: Sandbox; devs: Map<string, Dev>; addresses: Map<number, SandboxAddress>; shownVersion?: string };
type Running = { session?: HarnessSession; turnId: string; done: Promise<void> };

const STUDIO_FILE = ".kiln/studio.json";
const StudioFile = z.object({ title: z.string().optional(), summary: z.string().optional(), question: z.string().optional() }).passthrough();
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
/** Chat dev servers use the ports after the version preview's; the preview network policy allows 4100–4199. */
const MAX_CHATS = 99;
/** How often the ready check asks a starting dev server. */
const READY_POLL_MS = 200;
/** What an imported App's sandbox may reach (docs/specs/studio.md): its package registry. */
const IMPORT_EGRESS = ["registry.npmjs.org"];

const id = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`;
const oneLine = (s: string, max = 80) => {
  const line =
    s
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Read-only modes and what every turn is told (ADR-012: modes are permissions). */
export function instructionsFor(mode: ChatMode): string {
  const base = [
    "You are the coding agent in a Kiln Studio app. Your working directory is a Git worktree of the app; a person watches a live preview of it.",
    `When you finish, write ${STUDIO_FILE} with {"title": "<what changed, past tense, at most 60 characters>", "summary": "<two short sentences for the person>"}, and add "question" only when you need the person to decide something.`,
    "Studio commits your changes and merges them; don't push.",
  ];
  const modes: Record<ChatMode, string> = {
    build: "You may read, edit and run commands. If the request is only a question, just answer it and change nothing.",
    chat: "Read only: answer questions about the app and its code. Don't change any file; Studio discards changes in this mode.",
    plan: "Read only: reply with a step-by-step plan for the request as your final message. Don't change any file; Studio discards changes in this mode.",
  };
  return [...base, modes[mode]].join("\n");
}

/**
 * Studio (ADR-012): apps in a sandbox, chats on Git worktrees, turns that make a checkpoint only
 * when files change, versions on the app's main line, and dev server previews.
 */
export class Studio {
  private readonly live = new Map<string, Live>();
  private readonly running = new Map<string, Running>();
  private readonly provisioning = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly templates: Record<string, Template>;

  constructor(private readonly opts: StudioOptions) {
    this.templates = opts.templates ?? TEMPLATES;
    this.reconcile();
  }

  /** On startup: what a restart cut off can't continue, so it fails and the chat asks the person. */
  private reconcile() {
    const reason = "interrupted by a restart";
    for (const a of this.opts.store.list<App>(C.apps, (x) => x.status === "creating")) this.touch(C.apps, { ...a, status: "failed", error: reason });
    for (const t of this.opts.store.list<Turn>(C.turns, (x) => x.status === "running")) {
      this.save(C.turns, { ...t, status: "failed", reply: t.reply || reason, finishedAt: this.now() });
    }
    for (const c of this.opts.store.list<Chat>(C.chats, (x) => x.status === "working")) this.touch(C.chats, { ...c, status: "needs_you", question: `The agent failed: ${reason}` });
  }

  // ---- reads ----

  listApps(team: string): App[] {
    return this.opts.store.list<App>(C.apps, (p) => p.team === team).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getApp(appId: string): { app: App; chats: Chat[]; versions: Version[] } | undefined {
    const app = this.opts.store.get<App>(C.apps, appId);
    if (!app) return undefined;
    const chats = this.opts.store.list<Chat>(C.chats, (c) => c.appId === appId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { app, chats, versions: this.versions(appId) };
  }

  getChat(chatId: string): { chat: Chat; turns: Turn[] } | undefined {
    const chat = this.opts.store.get<Chat>(C.chats, chatId);
    if (!chat) return undefined;
    return { chat, turns: this.opts.store.list<Turn>(C.turns, (t) => t.chatId === chatId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
  }

  getVersion(versionId: string): Version | undefined {
    return this.opts.store.get<Version>(C.versions, versionId);
  }

  status(input: { team: string; app?: string }): StatusReport {
    const apps = this.listApps(input.team).filter((p) => !input.app || p.id === input.app);
    return {
      apps: apps.map((p) => {
        const chats = this.getApp(p.id)!.chats;
        const latest = this.versions(p.id)[0];
        return {
          id: p.id,
          name: p.name,
          working: chats.filter((c) => c.status === "working").map((c) => c.id),
          needsYou: chats
            .filter((c) => (c.status === "needs_you" || c.status === "conflict") && c.question)
            .map((c) => ({ chatId: c.id, question: c.question! })),
          ...(latest ? { latest: { title: latest.title, at: latest.createdAt } } : {}),
        };
      }),
    };
  }

  // ---- apps ----

  async createApp(input: {
    team: string;
    by: string;
    name: string;
    projectId?: string;
    source?: AppSource;
    harness?: HarnessType;
    model?: string;
  }): Promise<App> {
    const source = input.source ?? { kind: "template", template: "nextjs" };
    if (source.kind === "template" && !this.templates[source.template]) throw new StudioError("invalid", `unknown template ${source.template}`);
    if (source.kind === "repo" && !this.opts.clone) throw new StudioError("unavailable", "this server can't import repositories (no forge connection)");
    const now = this.now();
    const app: App = {
      id: id("sa"),
      team: input.team,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      name: input.name,
      source,
      // Imported repositories ship by pull request; templates are experiments (ADR-012).
      shipMode: source.kind === "repo" ? "review" : "cowboy",
      harness: input.harness ?? "claude-code",
      ...(input.model ? { model: input.model } : {}),
      status: "creating",
      createdBy: input.by,
      createdAt: now,
      updatedAt: now,
    };
    this.save(C.apps, app);
    this.provisioning.set(
      app.id,
      this.provision(app).finally(() => this.provisioning.delete(app.id)),
    );
    return app;
  }

  /** Resolves when a new app is ready or has failed. */
  async ready(appId: string): Promise<void> {
    await this.provisioning.get(appId);
  }

  updateApp(appId: string, patch: { name?: string; projectId?: string | null; shipMode?: ShipMode; devCommand?: string | null }): App {
    const p = this.app(appId);
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.projectId === null) delete p.projectId;
    else if (patch.projectId !== undefined) p.projectId = patch.projectId;
    if (patch.shipMode !== undefined) p.shipMode = patch.shipMode;
    if (patch.devCommand !== undefined) {
      if (!p.setup) throw new StudioError("invalid", "the app is still being created");
      const { devOverride: _, ...rest } = p.setup;
      p.setup = patch.devCommand === null ? rest : { ...rest, devOverride: patch.devCommand };
      p.setup.dev = devCommand(p.setup);
      if (!p.setup.dev) delete p.setup.dev;
    }
    return this.touch(C.apps, p);
  }

  /** Snapshot the workspace and free the sandbox; the next use resumes it. */
  async pause(appId: string): Promise<App> {
    return this.locked(appId, async () => {
      const p = this.app(appId);
      const live = this.live.get(appId);
      if (live) {
        for (const chat of this.getApp(appId)!.chats) if (this.running.has(chat.id)) throw new StudioError("busy", "a chat is still working");
        this.stopDevs(live);
        p.snapshot = await live.sandbox.snapshot(this.opts.objects);
        await live.sandbox.destroy();
        this.live.delete(appId);
      }
      p.status = "paused";
      return this.touch(C.apps, p);
    });
  }

  /** Stop every dev server, agent and sandbox without snapshotting (process shutdown, tests). */
  async shutdown(): Promise<void> {
    const running = [...this.running.values()];
    const stops = await Promise.allSettled(running.map((r) => r.session?.stop()));
    // Let stopped turns finish their bookkeeping before their sandboxes go away.
    await Promise.allSettled(running.map((r) => r.done));
    for (const live of this.live.values()) this.stopDevs(live);
    const destroys = await Promise.allSettled([...this.live.values()].map((live) => live.sandbox.destroy()));
    this.live.clear();
    // Stop everything even when one step fails, then report every failure.
    const failed = [...stops, ...destroys].filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length)
      throw new AggregateError(
        failed.map((f) => f.reason),
        "Studio shutdown failed",
      );
  }

  private async provision(app: App) {
    try {
      const template = app.source.kind === "template" ? this.templates[app.source.template]! : undefined;
      const clone = app.source.kind === "repo" ? await this.opts.clone!(app.source) : undefined;
      // The provider clones an imported repository into "app" and allows its host for the clone.
      const sandbox = await this.opts.sandboxes.create(this.spec(app, clone?.url));
      this.live.set(app.id, { sandbox, devs: new Map(), addresses: new Map() });
      const env = this.env(app);
      await must(sandbox, ".", "mkdir -p chats");
      let mainBranch = "main";
      let title: string;
      if (app.source.kind === "template") {
        await must(sandbox, ".", "mkdir -p app");
        for (const cmd of template!.scaffold) await must(sandbox, "app", cmd.replaceAll("{templates}", shellQuote(this.opts.templatesDir ?? "/opt/kiln/templates")), env);
        await must(sandbox, "app", "git init -q -b main");
        title = `Created ${app.name}`;
      } else {
        const want = app.source.branch ?? clone!.branch;
        if (want) await must(sandbox, "app", `git checkout -q ${shellQuote(want)}`);
        mainBranch = await must(sandbox, "app", "git rev-parse --abbrev-ref HEAD");
        // Forget the credential in the clone URL; Studio never pushes in phases 1–4.
        await must(sandbox, "app", "git remote remove origin");
        title = `Imported ${app.source.repo}`;
      }
      await must(
        sandbox,
        "app",
        `git config user.email studio@kiln.local && git config user.name 'Kiln Studio' && mkdir -p .git/info && printf '.kiln/\\n' >> .git/info/exclude`,
      );
      const setup = await this.detect(sandbox, app, mainBranch, template);
      if (template) await must(sandbox, "app", "git add -A && git commit -q -m " + shellQuote(title));
      else for (const cmd of setup.install) await must(sandbox, "app", cmd, env);
      const sha = await must(sandbox, "app", "git rev-parse HEAD");
      const p = this.app(app.id);
      p.setup = setup;
      p.status = "ready";
      this.touch(C.apps, p);
      this.addVersion(p, { sha, title, kind: "initial" });
      await this.snapshot(p.id);
    } catch (err) {
      const p = this.app(app.id);
      p.status = "failed";
      p.error = err instanceof Error ? err.message : String(err);
      this.touch(C.apps, p);
    }
  }

  private async detect(sandbox: Sandbox, app: App, mainBranch: string, template?: Template): Promise<AppSetup> {
    const files = (await must(sandbox, "app", "ls -A")).split("\n");
    const detected = detectSetup({ files, packageJson: await sandbox.readFile("app/package.json") });
    const example = ENV_EXAMPLES.find((f) => files.includes(f));
    const envRequired = example ? envKeys((await sandbox.readFile(`app/${example}`)) ?? "") : [];
    const setup: AppSetup = {
      mainBranch,
      packageManager: detected.packageManager,
      install: template ? template.install : detected.install,
      ...(template ? { devDetected: template.dev } : detected.devDetected ? { devDetected: detected.devDetected } : {}),
      envRequired,
      envMissing: [],
    };
    // The resolver may only look up the keys the App asks for, so it sees the setup first.
    const provided = this.env({ ...app, setup });
    setup.envMissing = envRequired.filter((k) => !(k in provided));
    const dev = devCommand(setup);
    return dev ? { ...setup, dev } : setup;
  }

  // ---- chats and turns ----

  async newChat(
    appId: string,
    input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string },
  ): Promise<{ chat: Chat; turn?: Turn }> {
    await this.ready(appId);
    const p = this.readyApp(appId);
    const { sandbox } = await this.ensureLive(p);
    const chatId = id("sc");
    const existing = this.getApp(appId)!.chats.length;
    if (existing >= MAX_CHATS) throw new StudioError("invalid", `an app can have at most ${MAX_CHATS} chats`);
    const now = this.now();
    const chat: Chat = {
      id: chatId,
      appId,
      title: input.title ?? (input.prompt ? oneLine(input.prompt, 40) : `Chat ${existing + 1}`),
      mode: input.mode ?? "build",
      harness: input.harness ?? p.harness,
      ...((input.model ?? p.model) ? { model: input.model ?? p.model } : {}),
      branch: `chat/${chatId}`,
      path: `chats/${chatId}`,
      port: this.basePort + 1 + existing,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    await this.locked(appId, () => must(sandbox, "app", `git worktree add -q -b ${chat.branch} ../${chat.path} ${shellQuote(p.setup!.mainBranch)}`));
    for (const cmd of p.setup!.install) await must(sandbox, chat.path, cmd, this.env(p));
    this.save(C.chats, chat);
    if (!input.prompt) return { chat };
    const { turn } = await this.send(chatId, { by: input.by, via: input.via, text: input.prompt, ...(input.mode ? { mode: input.mode } : {}) });
    return { chat: this.chat(chatId), turn };
  }

  /** Start a turn, or steer the running one. Resolves once the turn has started. */
  async send(chatId: string, input: { by: string; via: Via; text: string; mode?: ChatMode }, resolve = false): Promise<{ turn: Turn; steered: boolean }> {
    const chat = this.chat(chatId);
    const current = this.running.get(chatId);
    if (current?.session) {
      await current.session.steer(input.text);
      return { turn: this.opts.store.get<Turn>(C.turns, current.turnId)!, steered: true };
    }
    if (current) throw new StudioError("busy", "the chat's turn is starting; try again in a moment");
    const max = this.opts.maxRunningChats ?? 3;
    const busy = this.getApp(chat.appId)!.chats.filter((c) => c.id !== chatId && this.running.has(c.id)).length;
    if (busy >= max) throw new StudioError("busy", `${max} chats are already working in this app`);
    const p = this.readyApp(chat.appId);
    const mode = input.mode ?? chat.mode;
    const turn: Turn = {
      id: id("st"),
      appId: p.id,
      chatId,
      prompt: input.text,
      mode,
      via: input.via,
      by: input.by,
      status: "running",
      reply: "",
      discarded: false,
      ...(resolve ? { resolve: true } : {}),
      activity: [],
      costUsd: 0,
      startedAt: this.now(),
    };
    let started!: () => void;
    let failed!: (err: unknown) => void;
    const ready = new Promise<void>((res, rej) => ((started = res), (failed = rej)));
    const entry: Running = { turnId: turn.id, done: Promise.resolve() };
    this.running.set(chatId, entry);
    this.save(C.turns, turn);
    this.touch(C.chats, { ...chat, mode, status: "working", question: undefined });
    this.opts.bus.publish("studio.turn_started", { appId: p.id, chatId, turnId: turn.id, priority: "progress" });
    entry.done = this.runTurn(p, chatId, turn, entry, started, failed);
    await ready;
    return { turn: this.opts.store.get<Turn>(C.turns, turn.id)!, steered: false };
  }

  /** Resolves when the chat has no running turn, including a resolve turn Studio started itself. */
  async idle(chatId: string): Promise<void> {
    for (let r = this.running.get(chatId); r; r = this.running.get(chatId)) await r.done;
  }

  private async runTurn(p: App, chatId: string, turn: Turn, entry: Running, started: () => void, failed: (err: unknown) => void) {
    let startHead = "";
    let result: HarnessResult;
    let live: Live;
    try {
      live = await this.ensureLive(p);
      const chat = this.chat(chatId);
      startHead = await must(live.sandbox, chat.path, "git rev-parse HEAD");
      await must(live.sandbox, chat.path, `rm -f ${STUDIO_FILE}`);
      entry.session = await this.opts.harness(chat.harness).start({
        sandbox: live.sandbox,
        cwd: chat.path,
        instructions: instructionsFor(turn.mode),
        prompt: turn.prompt,
        ...(chat.model ? { model: chat.model } : {}),
        env: { ...this.env(p), ...this.opts.credentials?.(p, chat.harness) },
      });
      started();
      const clean = this.redactor(p);
      for await (const e of entry.session.events) this.record(turn, e, clean);
      result = await entry.session.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { outcome: "failed", summary: message, costUsd: 0, turns: 0 };
      if (!entry.session) {
        this.running.delete(chatId);
        this.finishFailed(p, chatId, turn, message);
        failed(err);
        return;
      }
    }
    try {
      await this.finishTurn(p, chatId, turn, result, startHead, live!);
    } catch (err) {
      this.finishFailed(p, chatId, turn, err instanceof Error ? err.message : String(err));
    } finally {
      if (this.running.get(chatId) === entry) this.running.delete(chatId);
    }
    const after = this.opts.store.get<Turn>(C.turns, turn.id)!;
    const app = this.app(p.id);
    if (app.shipMode === "cowboy" && after.checkpoint && !this.running.has(chatId)) {
      try {
        await this.autoApply(app, chatId, after);
      } catch (err) {
        // The checkpoint is safe on the chat branch; the person can apply it by hand.
        const question = `Applying this chat failed: ${err instanceof Error ? err.message : String(err)}`;
        this.touch(C.chats, { ...this.chat(chatId), status: "needs_you", question });
        this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId, question, reason: "failed", priority: "needs_you" });
      }
    }
    try {
      await this.snapshot(p.id);
    } catch (err) {
      // The turn is saved; only resuming after a restart is at risk. Record it on the App.
      this.touch(C.apps, { ...this.app(p.id), error: `saving the workspace failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private record(turn: Turn, e: HarnessEvent, clean: (text: string) => string) {
    const at = this.now();
    let a: Activity | undefined;
    if (e.type === "message") {
      a = { kind: "message", text: clean(e.text), at };
      turn.reply = a.text;
    } else if (e.type === "reasoning") a = { kind: "reasoning", text: clean(e.text), at };
    else if (e.type === "tool_call") {
      const input = (e.input ?? {}) as Record<string, unknown>;
      a = SUBAGENT_TOOLS.has(e.name)
        ? { kind: "subagent", name: e.name, text: clean(String(input.description ?? input.prompt ?? "")), at }
        : { kind: "tool", name: e.name, ...(typeof input.file_path === "string" ? { text: clean(input.file_path) } : {}), at };
    } else if (e.type === "error") a = { kind: "error", text: clean(e.text), at };
    else if (e.type === "cost") turn.costUsd += e.usd;
    if (a) turn.activity.push(a);
    this.save(C.turns, turn);
  }

  private async finishTurn(p: App, chatId: string, turn: Turn, result: HarnessResult, startHead: string, live: Live) {
    const chat = this.chat(chatId);
    const sbx = live.sandbox;
    const meta = parseStudioFile(await sbx.readFile(`${chat.path}/${STUDIO_FILE}`));
    const clean = this.redactor(p);
    turn.reply ||= clean(result.summary);
    turn.costUsd = Math.max(turn.costUsd, result.costUsd);
    const title = clean(meta.title?.trim() ? oneLine(meta.title) : oneLine(turn.reply) || "Changes");
    turn.title = title;
    if (meta.summary) turn.summary = clean(meta.summary);
    if (meta.question) turn.question = clean(meta.question);
    const changed = (await sbx.exec("git add -A && git diff --cached --quiet", { cwd: chat.path, trusted: true })).code !== 0;
    if (turn.mode === "build") {
      if (changed) await must(sbx, chat.path, `git commit -q -m ${shellQuote(title)}`);
      const head = await must(sbx, chat.path, "git rev-parse HEAD");
      if (head !== startHead) turn.checkpoint = head;
    } else {
      const head = await must(sbx, chat.path, "git rev-parse HEAD");
      if (changed || head !== startHead) {
        await must(sbx, chat.path, `git reset -q --hard ${startHead} && git clean -fdq`);
        turn.discarded = true;
      }
      if (turn.mode === "plan") turn.plan = turn.reply;
    }
    turn.status = result.outcome;
    turn.finishedAt = this.now();
    this.save(C.turns, turn);
    const needs = turn.question ?? (result.outcome === "failed" ? `The agent failed: ${oneLine(result.summary, 200)}` : undefined);
    this.touch(C.chats, { ...chat, status: needs ? "needs_you" : "idle", ...(needs ? { question: needs } : { question: undefined }) });
    this.opts.bus.publish("studio.turn_finished", {
      appId: p.id,
      chatId,
      turnId: turn.id,
      title,
      ...(turn.summary ? { summary: turn.summary } : {}),
      changed: Boolean(turn.checkpoint),
      priority: "finished",
    });
    if (needs)
      this.opts.bus.publish("studio.needs_you", {
        appId: p.id,
        chatId,
        question: needs,
        reason: turn.question ? "question" : "failed",
        priority: "needs_you",
      });
  }

  private finishFailed(p: App, chatId: string, turn: Turn, message: string) {
    turn.status = "failed";
    turn.reply ||= message;
    turn.activity.push({ kind: "error", text: message, at: this.now() });
    turn.finishedAt = this.now();
    this.save(C.turns, turn);
    const question = `The agent failed: ${oneLine(message, 200)}`;
    this.touch(C.chats, { ...this.chat(chatId), status: "needs_you", question });
    this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId, question, reason: "failed", priority: "needs_you" });
  }

  /** Cowboy mode: apply after every changed turn; on a conflict, the chat's agent resolves it once. */
  private async autoApply(p: App, chatId: string, turn: Turn) {
    const r = await this.apply(chatId, "studio");
    if (r.ok || !("conflict" in r)) return;
    const main = p.setup!.mainBranch;
    if (turn.resolve) {
      const question = `Applying this chat conflicts in ${r.conflict.join(", ")}, and the agent couldn't resolve it.`;
      this.touch(C.chats, { ...this.chat(chatId), status: "needs_you", question });
      this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId, question, reason: "conflict", priority: "needs_you" });
      return;
    }
    const prompt = `Run \`git merge ${main}\` in this worktree: applying this chat to ${main} conflicts in ${r.conflict.join(", ")}. Resolve every conflict so both sides' changes still work, then commit the merge.`;
    await this.send(chatId, { by: "studio", via: "api", text: prompt, mode: "build" }, true);
  }

  // ---- versions ----

  async apply(chatId: string, by: string): Promise<ApplyResult> {
    const chat = this.chat(chatId);
    const p = this.readyApp(chat.appId);
    return this.locked(p.id, async () => {
      const { sandbox } = await this.ensureLive(p);
      const main = shellQuote(p.setup!.mainBranch);
      const ahead = Number(await must(sandbox, "app", `git rev-list --count ${main}..${chat.branch}`));
      if (!ahead) return { ok: false, nothing: true } as const;
      const subjects = (await must(sandbox, "app", `git log --no-merges --reverse --format=%s ${main}..${chat.branch}`)).split("\n").filter(Boolean);
      const title = oneLine(subjects.join("; ") || chat.title);
      const merged = await sandbox.exec(`git merge --no-ff -q -m ${shellQuote(title)} ${chat.branch}`, { cwd: "app", trusted: true });
      if (merged.code !== 0) {
        const files = (await must(sandbox, "app", "git diff --name-only --diff-filter=U")).split("\n").filter(Boolean);
        await sandbox.exec("git merge --abort", { cwd: "app", trusted: true });
        this.touch(C.chats, { ...this.chat(chatId), status: "conflict", question: `Applying conflicts in ${files.join(", ")}` });
        return { ok: false, conflict: files } as const;
      }
      const sha = await must(sandbox, "app", "git rev-parse HEAD");
      const appliedSha = await must(sandbox, "app", `git rev-parse ${chat.branch}`);
      const current = this.chat(chatId);
      this.touch(C.chats, { ...current, appliedSha, ...(current.status === "conflict" ? { status: "idle" as const, question: undefined } : {}) });
      void by;
      return { ok: true, version: this.addVersion(p, { sha, title, kind: "apply", chatId }) } as const;
    });
  }

  async restore(versionId: string, by: string): Promise<Version> {
    const v = this.version(versionId);
    const p = this.readyApp(v.appId);
    void by;
    return this.locked(p.id, async () => {
      const { sandbox } = await this.ensureLive(p);
      const title = oneLine(`Restore: ${v.title}`);
      await must(sandbox, "app", `git read-tree -u --reset ${v.sha} && git commit -q --allow-empty -m ${shellQuote(title)}`);
      const sha = await must(sandbox, "app", "git rev-parse HEAD");
      return this.addVersion(p, { sha, title, kind: "restore", restoredFrom: v.id });
    });
  }

  bookmark(versionId: string, on: boolean): Version {
    return this.save(C.versions, { ...this.version(versionId), bookmarked: on });
  }

  async diff(target: { chatId: string } | { versionId: string }): Promise<string> {
    if ("chatId" in target) {
      const chat = this.chat(target.chatId);
      const p = this.readyApp(chat.appId);
      const { sandbox } = await this.ensureLive(p);
      return (await sandbox.exec(`git diff ${shellQuote(p.setup!.mainBranch)}...${chat.branch}`, { cwd: "app", trusted: true })).stdout;
    }
    const v = this.version(target.versionId);
    const { sandbox } = await this.ensureLive(this.readyApp(v.appId));
    const parent = await sandbox.exec(`git rev-parse -q --verify ${v.sha}^1`, { cwd: "app", trusted: true });
    const cmd = parent.code === 0 ? `git diff ${v.sha}^1 ${v.sha}` : `git show --format= ${v.sha}`;
    return (await sandbox.exec(cmd, { cwd: "app", trusted: true })).stdout;
  }

  // ---- previews ----

  async preview(target: { chatId: string } | { versionId: string }): Promise<Preview> {
    if ("chatId" in target) {
      const chat = this.chat(target.chatId);
      const p = this.readyApp(chat.appId);
      const live = await this.ensureLive(p);
      return this.serve(p, live, chat.id, chat.path, chat.port);
    }
    const v = this.version(target.versionId);
    const p = this.readyApp(v.appId);
    const live = await this.ensureLive(p);
    await this.locked(p.id, async () => {
      const exists = (await live.sandbox.exec("test -e version", { trusted: true })).code === 0;
      if (exists) await must(live.sandbox, "version", `git checkout -q --detach ${v.sha}`);
      else {
        await must(live.sandbox, "app", `git worktree add -q --detach ../version ${v.sha}`);
        for (const cmd of p.setup!.install) await must(live.sandbox, "version", cmd, this.env(p));
      }
      live.shownVersion = v.id;
    });
    return this.serve(p, live, "version", "version", this.basePort, v.id);
  }

  /** Where the preview proxy sends a target's requests; undefined when it isn't being served. */
  async resolvePreview(target: string): Promise<SandboxAddress | undefined> {
    for (const live of this.live.values()) {
      const key = live.shownVersion === target ? "version" : target;
      const dev = live.devs.get(key);
      if (dev && live.sandbox.expose) return this.address(live, dev.port);
    }
    return undefined;
  }

  private async serve(p: App, live: Live, key: string, cwd: string, port: number, target = key): Promise<Preview> {
    if (!live.sandbox.expose) throw new StudioError("unavailable", `the ${live.sandbox.provider} sandbox backend can't serve previews`);
    const dev = p.setup?.dev;
    if (!dev) throw new StudioError("invalid", "no dev command: set one in the app settings");
    let running = live.devs.get(key);
    if (!running) {
      const cmd = dev.replaceAll("{port}", String(port));
      const env: Record<string, string> = { ...this.env(p), PORT: String(port), HOST: "0.0.0.0" };
      // The template's next.config.ts allows dev origins (hot reload) under the preview domain.
      if (this.opts.previewDomain) env.KILN_STUDIO_PREVIEW_DOMAIN = this.opts.previewDomain;
      const proc = live.sandbox.spawn("sh", ["-c", cmd], { cwd, env });
      const started: Dev = { proc, port, state: "starting" };
      running = started;
      live.devs.set(key, started);
      this.watchDev(live, key, started).catch(() => this.devFailed(live, key, started));
      const template = p.source.kind === "template" ? this.templates[p.source.template] : undefined;
      this.checkReady(live, started, template?.ready ?? DEFAULT_READY).catch(() => this.devFailed(live, key, started));
    }
    return { target, url: this.opts.previewUrl(target, await this.address(live, running.port)), status: running.state };
  }

  /** Ready once GET `path` answers with any status; failed after `timeoutMs`. */
  private async checkReady(live: Live, dev: Dev, ready: { path: string; timeoutMs: number }) {
    const fetchImpl = this.opts.fetch ?? fetch;
    const deadline = Date.now() + ready.timeoutMs;
    while (dev.state === "starting") {
      const left = deadline - Date.now();
      if (left <= 0) {
        dev.state = "failed";
        return;
      }
      const a = await this.address(live, dev.port);
      if (await answers(fetchImpl, `http://${a.host}:${a.port}${ready.path}`, left)) dev.state = "ready";
      else await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }

  /** Follow a dev server's output: switch to the port it says it listens on, forget it when it exits. */
  private async watchDev(live: Live, key: string, dev: Dev) {
    let seen = 0;
    for await (const line of dev.proc.lines) {
      const port = seen++ < 50 ? listenPort(line) : undefined;
      if (port && port !== dev.port) dev.port = port;
    }
    // The next preview starts it again.
    if (live.devs.get(key) === dev) live.devs.delete(key);
  }

  private async address(live: Live, port: number): Promise<SandboxAddress> {
    const known = live.addresses.get(port);
    if (known) return known;
    const a = await live.sandbox.expose!(port);
    live.addresses.set(port, a);
    return a;
  }

  /** A dev server whose output or address broke: the preview shows failed, and the next preview starts it again. */
  private devFailed(live: Live, key: string, dev: Dev) {
    dev.state = "failed";
    dev.proc.kill();
    if (live.devs.get(key) === dev) live.devs.delete(key);
  }

  private stopDevs(live: Live) {
    for (const d of live.devs.values()) d.proc.kill();
    live.devs.clear();
  }

  // ---- plumbing ----

  private get basePort() {
    return this.opts.basePort ?? 4100;
  }

  /** `cloneUrl`: an imported App's repository, cloned into "app" when the sandbox is created. */
  private spec(p: App, cloneUrl?: string): SandboxSpec {
    const template = p.source.kind === "template" ? this.templates[p.source.template] : undefined;
    const backend = this.opts.sandboxes.name as SandboxSpec["runner"]["backend"];
    return {
      runner: { image: template?.image ?? this.opts.image, backend, setupCommands: [], egress: template?.egress ?? IMPORT_EGRESS },
      // No branch: the provider would create it; Studio checks out the requested branch after the clone.
      repos: cloneUrl ? [{ name: "app", url: cloneUrl }] : [],
      // The preview network (Docker) or the kiln.dev/preview label (Kubernetes): the API can reach the dev servers.
      preview: true,
      env: this.env(p),
      labels: { "kiln.studio.app": p.id },
    };
  }

  /** The app's sandbox, resumed from its latest snapshot when this process doesn't hold it. */
  private async ensureLive(p: App): Promise<Live> {
    const held = this.live.get(p.id);
    if (held) return held;
    return this.locked(`live:${p.id}`, async () => {
      const again = this.live.get(p.id);
      if (again) return again;
      const current = this.app(p.id);
      if (!current.snapshot) throw new StudioError("unavailable", "the app's workspace is gone and has no snapshot");
      const sandbox = await this.opts.sandboxes.resume(current.snapshot, this.spec(current), this.opts.objects);
      // Worktrees record absolute paths; a resumed workspace may live elsewhere.
      await sandbox.exec('for d in ../chats/* ../version; do [ -e "$d" ] && git worktree repair "$d"; done; true', { cwd: "app", trusted: true });
      const live: Live = { sandbox, devs: new Map(), addresses: new Map() };
      this.live.set(p.id, live);
      if (current.status === "paused") this.touch(C.apps, { ...current, status: "ready" });
      return live;
    });
  }

  private async snapshot(appId: string) {
    const live = this.live.get(appId);
    if (!live) return;
    const snapshot = await live.sandbox.snapshot(this.opts.objects);
    this.touch(C.apps, { ...this.app(appId), snapshot });
  }

  private addVersion(p: App, v: Pick<Version, "sha" | "title" | "kind" | "chatId" | "restoredFrom">): Version {
    const version: Version = {
      id: id("sv"),
      appId: p.id,
      sha: v.sha,
      title: v.title,
      kind: v.kind,
      ...(v.chatId ? { chatId: v.chatId } : {}),
      ...(v.restoredFrom ? { restoredFrom: v.restoredFrom } : {}),
      bookmarked: false,
      createdAt: this.now(),
    };
    this.save(C.versions, version);
    this.opts.bus.publish("studio.version_created", { appId: p.id, versionId: version.id, title: version.title, kind: version.kind, priority: "finished" });
    return version;
  }

  private versions(appId: string): Version[] {
    return this.opts.store.list<Version>(C.versions, (v) => v.appId === appId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private env(p: App): Record<string, string> {
    return this.opts.env?.(p).env ?? {};
  }

  /** Replaces the App's secret values in text Studio stores or serves. */
  private redactor(p: App): (text: string) => string {
    const secrets = (this.opts.env?.(p).secretValues ?? []).filter((v) => v.length >= 6);
    return (text) => secrets.reduce((t, v) => t.replaceAll(v, "[redacted]"), text);
  }

  /** Run `fn` after every earlier step on the same key (Git in one repository is not concurrent). */
  private locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  private now() {
    return this.opts.clock.now().toISOString();
  }

  private save<T extends { id: string }>(collection: string, doc: T): T {
    return this.opts.store.put(collection, doc);
  }

  private touch<T extends { id: string; updatedAt: string }>(collection: string, doc: T): T {
    return this.save(collection, { ...doc, updatedAt: this.now() });
  }

  private app(appId: string): App {
    const p = this.opts.store.get<App>(C.apps, appId);
    if (!p) throw new StudioError("not_found", `unknown app ${appId}`);
    return p;
  }

  private readyApp(appId: string): App {
    const p = this.app(appId);
    if (p.status === "creating") throw new StudioError("unavailable", "the app is still being created");
    if (p.status === "failed" || !p.setup) throw new StudioError("unavailable", `the app failed to start: ${p.error ?? "unknown error"}`);
    return p;
  }

  private chat(chatId: string): Chat {
    const c = this.opts.store.get<Chat>(C.chats, chatId);
    if (!c) throw new StudioError("not_found", `unknown chat ${chatId}`);
    return c;
  }

  private version(versionId: string): Version {
    const v = this.opts.store.get<Version>(C.versions, versionId);
    if (!v) throw new StudioError("not_found", `unknown version ${versionId}`);
    return v;
  }
}

/** True when anything answers HTTP at `url`. A refused connection or a timeout means the server isn't up yet. */
async function answers(fetchImpl: typeof fetch, url: string, leftMs: number): Promise<boolean> {
  try {
    await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(leftMs, 5000)) });
    return true;
  } catch {
    return false;
  }
}

function parseStudioFile(text: string | undefined): z.infer<typeof StudioFile> {
  if (!text) return {};
  try {
    const r = StudioFile.safeParse(JSON.parse(text));
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}

/** A trusted command (Studio's own, not the agent's); throws with its output when it fails. */
async function must(sandbox: Sandbox, cwd: string, command: string, env?: Record<string, string>): Promise<string> {
  const r = await sandbox.exec(command, { cwd, trusted: true, ...(env ? { env } : {}) });
  if (r.code !== 0) throw new Error(`${command} failed in ${cwd}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
