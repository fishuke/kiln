import { randomBytes } from "node:crypto";
import type { EventBus } from "@kiln/events";
import type { ResolvedAgent } from "@kiln/definitions";
import { shellQuote, type Proc, type Sandbox, type SandboxAddress, type SandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import type { ObjectStore, Store } from "@kiln/store";
import { z } from "zod";
import { DEFAULT_AGENT, targetOf, type AppDefinitions } from "./app-definitions";
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

/** Starting and talking to App runs; the API wires these to the engine's RunService (factory runs' machinery). */
export interface StudioRuns {
  /** Start a run of an App agent for a chat; resolves once the run exists. */
  start(input: { appId: string; chatId: string; agent: string; prompt: string; by: string; via: Via; harness?: HarnessType; model?: string }): Promise<{ runId: string }>;
  /** Steers a live run, or continues a finished one in a new run. */
  followup(runId: string, input: { message: string; by: string }): Promise<{ delivered: "steered" | "continued"; runId: string }>;
  interrupt(runId: string, by: string): Promise<void>;
  /** Whether the run's agent is still working. */
  active(runId: string): boolean;
}

/** The parts of an engine Run Studio reads (structural: Studio doesn't import the engine). */
export type RunRef = {
  id: string;
  app?: string;
  agent: string;
  parentRunId?: string;
  continuationOf?: string;
  name?: string;
  title?: string;
  creator?: string;
  metadata?: Record<string, string>;
  status: string;
  summary?: string;
  costUsd: number;
  startState: { prompt: string };
};

/** An App's definition for its runs, as the engine's KilnOptions.apps returns it (structural). */
export type AppRunDefinition = {
  sha: string;
  team: string;
  agents: Record<string, ResolvedAgent>;
  skill(agent: string, name: string): { body: string; description?: string } | undefined;
  monthlyUsd?: number;
  env: Record<string, string>;
  secretValues: string[];
};

export type StudioOptions = {
  store: Store;
  objects: ObjectStore;
  bus: EventBus;
  clock: Clock;
  /** The one sandbox backend Studio apps run on. */
  sandboxes: SandboxProvider;
  /** App definitions (team → Kiln Project → App): agents, skills, policies. */
  definitions: AppDefinitions;
  runs: StudioRuns;
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
/** A chat's turn in progress: its run once it has one; `finish` ends it. */
type Running = { turnId: string; runId?: string; done: Promise<void>; finish: () => void };
/** A run working in a chat's worktree. */
type Lent = { chatId: string; turnId: string; startHead: string };

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
/** The newest message of a continued run's prompt (a follow-up appends "## Follow-up from …"). */
const followUpText = (prompt: string) => prompt.split(/\n## Follow-up from [^\n]*\n/).at(-1)!.trim();

/** What every App agent is told about working in Studio (after its own instructions and mandatory skills). */
export const STUDIO_INSTRUCTIONS = [
  "## Working in Kiln Studio",
  "Your working directory is a Git worktree of the app; a person watches a live preview of it.",
  `When you finish, write ${STUDIO_FILE} with {"title": "<what changed, past tense, at most 60 characters>", "summary": "<two short sentences for the person>"}, and add "question" only when you need the person to decide something.`,
  "Studio commits your changes and merges them; don't push. If the request is only a question, just answer it and change nothing.",
].join("\n");

/** Chat and plan mode are read only (ADR-012: modes are permissions); the note leads the person's message. */
const MODE_NOTES: Record<ChatMode, string> = {
  build: "",
  chat: "Mode: chat. Read only: answer questions about the app and its code, and don't change any file; Studio discards changes in this mode.",
  plan: "Mode: plan. Read only: reply with a step-by-step plan for the request as your final message, and don't change any file; Studio discards changes in this mode.",
};

/**
 * Studio (ADR-012): apps in a sandbox, chats on Git worktrees, turns that are runs of the App's agents
 * and make a checkpoint only when files change, versions on the app's main line, and dev server previews.
 */
export class Studio {
  private readonly live = new Map<string, Live>();
  private readonly running = new Map<string, Running>();
  private readonly lent = new Map<string, Lent>();
  /** A chat whose finished turn is still applying and snapshotting; idle waits for it too. */
  private readonly settling = new Map<string, Promise<void>>();
  private readonly turnWaiters = new Map<string, { resolve: (turn: Turn) => void; reject: (err: Error) => void }>();
  private readonly provisioning = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly templates: Record<string, Template>;

  constructor(private readonly opts: StudioOptions) {
    this.templates = opts.templates ?? TEMPLATES;
    this.reconcile();
    opts.bus.subscribe("run.event", (e) => this.recordEvent(e.payload));
    // A run that ended without a workspace (it failed to start) never becomes a turn.
    opts.bus.subscribe("run.finished", (e) => {
      const waiter = this.turnWaiters.get(e.payload.runId);
      if (!waiter || this.lent.has(e.payload.runId)) return;
      this.turnWaiters.delete(e.payload.runId);
      waiter.reject(new StudioError("unavailable", `run ${e.payload.runId} ended before it started working`));
    });
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
    const working = [...this.running.values()];
    const stops = await Promise.allSettled(working.filter((r) => r.runId && this.opts.runs.active(r.runId)).map((r) => this.opts.runs.interrupt(r.runId!, "studio")));
    // Let stopped turns finish their bookkeeping (release) before their sandboxes go away.
    await Promise.allSettled([...working.map((r) => r.done), ...this.settling.values()]);
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
      else await this.install(sandbox, "app", setup.install, env);
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

  /**
   * Installs dependencies in a worktree, then puts its tracked and unignored files back as they were, so
   * nothing the install writes (a generated lockfile, a reformatted package.json) counts as an agent's change.
   * Ignored files, such as node_modules, stay.
   */
  private async install(sandbox: Sandbox, cwd: string, commands: string[], env: Record<string, string>) {
    for (const cmd of commands) await must(sandbox, cwd, cmd, env);
    if (commands.length) await must(sandbox, cwd, "git checkout -q -- . && git clean -fdq -e node_modules");
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
    input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; agent?: string; harness?: HarnessType; model?: string },
  ): Promise<{ chat: Chat; turn?: Turn }> {
    await this.ready(appId);
    const p = this.readyApp(appId);
    const agent = input.agent ?? DEFAULT_AGENT;
    // Fails early for an agent the App doesn't define.
    this.opts.definitions.chatConfig(targetOf(p), { agent });
    const chat = await this.createChat(p, {
      title: input.title ?? (input.prompt ? oneLine(input.prompt, 40) : undefined),
      agent,
      mode: input.mode ?? "build",
      ...(input.harness ? { harness: input.harness } : {}),
      ...(input.model ? { model: input.model } : {}),
    });
    if (!input.prompt) return { chat };
    const { turn } = await this.send(chat.id, { by: input.by, via: input.via, text: input.prompt, ...(input.mode ? { mode: input.mode } : {}) });
    return { chat: this.chat(chat.id), turn };
  }

  /** A chat's record and worktree (branch chat/<id> from the App's main line). */
  private async createChat(
    p: App,
    input: { title?: string; agent: string; mode: ChatMode; harness?: HarnessType; model?: string; parentRunId?: string },
  ): Promise<Chat> {
    const { sandbox } = await this.ensureLive(p);
    const chatId = id("sc");
    const existing = this.getApp(p.id)!.chats.length;
    if (existing >= MAX_CHATS) throw new StudioError("invalid", `an app can have at most ${MAX_CHATS} chats`);
    const now = this.now();
    const model = input.model ?? p.model;
    const chat: Chat = {
      id: chatId,
      appId: p.id,
      title: input.title ?? `Chat ${existing + 1}`,
      agent: input.agent,
      mode: input.mode,
      harness: input.harness ?? p.harness,
      ...(model ? { model } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      branch: `chat/${chatId}`,
      path: `chats/${chatId}`,
      port: this.basePort + 1 + existing,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    await this.locked(p.id, () => must(sandbox, "app", `git worktree add -q -b ${chat.branch} ../${chat.path} ${shellQuote(p.setup!.mainBranch)}`));
    await this.install(sandbox, chat.path, p.setup!.install, this.env(p));
    return this.save(C.chats, chat);
  }

  /**
   * A message to a chat: steers its live run, or starts its next turn (a new run, or a follow-up that
   * continues the chat's finished run). Resolves once the run exists.
   */
  async send(chatId: string, input: { by: string; via: Via; text: string; mode?: ChatMode }, resolve = false): Promise<{ turn: Turn; steered: boolean }> {
    const chat = this.chat(chatId);
    const current = this.running.get(chatId);
    if (current?.runId) {
      const r = await this.opts.runs.followup(current.runId, { message: input.text, by: input.by });
      if (r.delivered === "steered") return { turn: this.opts.store.get<Turn>(C.turns, current.turnId)!, steered: true };
      // The run had just finished: the follow-up continued it, and that run is the chat's next turn.
      return { turn: await this.turnOf(r.runId), steered: false };
    }
    if (current) throw new StudioError("busy", "the chat's turn is starting; try again in a moment");
    const max = this.opts.maxRunningChats ?? 3;
    const busy = this.getApp(chat.appId)!.chats.filter((c) => c.id !== chatId && this.running.has(c.id)).length;
    if (busy >= max) throw new StudioError("busy", `${max} chats are already working in this app`);
    const p = this.readyApp(chat.appId);
    const mode = input.mode ?? chat.mode;
    const turn = this.newTurn(p, chat, { prompt: input.text, mode, via: input.via, by: input.by, resolve });
    this.touch(C.chats, { ...chat, mode, status: "working", question: undefined });
    const message = MODE_NOTES[mode] ? `${MODE_NOTES[mode]}\n\n${input.text}` : input.text;
    try {
      if (chat.runId) await this.opts.runs.followup(chat.runId, { message, by: input.by });
      else
        await this.opts.runs.start({
          appId: p.id,
          chatId,
          agent: chat.agent,
          prompt: message,
          by: input.by,
          via: input.via,
          harness: chat.harness,
          ...(chat.model ? { model: chat.model } : {}),
        });
    } catch (err) {
      // The run never started (a budget, an unknown agent): the turn ends here.
      this.finishFailed(p, chatId, turn, err instanceof Error ? err.message : String(err));
      this.running.get(chatId)?.finish();
      throw err;
    }
    return { turn: this.opts.store.get<Turn>(C.turns, turn.id)!, steered: false };
  }

  /** Interrupt the chat's run; it waits for a follow-up. */
  async stop(chatId: string, by: string): Promise<void> {
    const runId = this.running.get(chatId)?.runId;
    if (!runId) throw new StudioError("invalid", "the chat has no running turn");
    await this.opts.runs.interrupt(runId, by);
  }

  /** Resolves when the chat has no running turn and its last one is applied and saved, including a resolve turn Studio started itself. */
  async idle(chatId: string): Promise<void> {
    for (;;) {
      const waiting = this.running.get(chatId)?.done ?? this.settling.get(chatId);
      if (!waiting) return;
      await waiting;
    }
  }

  /** The turn a run became, once the run has its workspace; rejects if the run ends without one. */
  private turnOf(runId: string): Promise<Turn> {
    const lent = this.lent.get(runId);
    if (lent) return Promise.resolve(this.opts.store.get<Turn>(C.turns, lent.turnId)!);
    return new Promise<Turn>((resolve, reject) => this.turnWaiters.set(runId, { resolve, reject }));
  }

  /** A turn waiting for its run (send creates it; a run Studio didn't start gets one in acquire). */
  private newTurn(p: App, chat: Chat, input: { prompt: string; mode: ChatMode; via: Via; by: string; resolve?: boolean }): Turn {
    const turn: Turn = {
      id: id("st"),
      appId: p.id,
      chatId: chat.id,
      prompt: input.prompt,
      mode: input.mode,
      via: input.via,
      by: input.by,
      status: "running",
      reply: "",
      discarded: false,
      ...(input.resolve ? { resolve: true } : {}),
      activity: [],
      costUsd: 0,
      startedAt: this.now(),
    };
    let finish!: () => void;
    const done = new Promise<void>((res) => (finish = res));
    this.running.set(chat.id, { turnId: turn.id, done, finish: () => (this.running.get(chat.id)?.turnId === turn.id && this.running.delete(chat.id), finish()) });
    this.save(C.turns, turn);
    this.opts.bus.publish("studio.turn_started", { appId: p.id, chatId: chat.id, turnId: turn.id, priority: "progress" });
    return turn;
  }

  // ---- the engine's hooks (KilnOptions.apps and .workspaces) ----

  /** An App's agents for its runs (KilnOptions.apps): the App definition, with Studio's turn instructions. */
  definition(appId: string): AppRunDefinition {
    const p = this.app(appId);
    const target = targetOf(p);
    const r = this.opts.definitions.resolve(target);
    const agents = Object.fromEntries(
      Object.entries(r.agents).map(([name, a]) => {
        const { from: _from, ownSkills: _own, ...agent } = a;
        return [name, { ...agent, instructions: `${this.opts.definitions.chatConfig(target, { agent: name }).instructions}\n\n${STUDIO_INSTRUCTIONS}` }];
      }),
    );
    const { env, secretValues } = this.opts.env?.(p) ?? { env: {}, secretValues: [] };
    return {
      sha: r.sha,
      team: p.team,
      agents,
      skill: (agent, name) => {
        const s = r.agents[agent]?.ownSkills[name] ?? r.skills[name];
        return s ? { body: s.body, ...(s.description ? { description: s.description } : {}) } : undefined;
      },
      ...(r.monthlyUsd !== undefined ? { monthlyUsd: r.monthlyUsd } : {}),
      env,
      secretValues,
    };
  }

  /**
   * Where an App's run works (KilnOptions.workspaces): its chat's worktree in the App's sandbox. A run
   * an agent spawned gets a new chat and worktree; a continuation stays in its chat. Answers undefined
   * for any other run.
   */
  async acquire(run: RunRef, parent?: RunRef): Promise<{ sandbox: Sandbox; cwd: string } | undefined> {
    if (!run.app) return undefined;
    const p = this.readyApp(run.app);
    const live = await this.ensureLive(p);
    const named = run.metadata?.["studio.chat"];
    const continued = run.continuationOf ? this.opts.store.list<Chat>(C.chats, (c) => c.runId === run.continuationOf)[0] : undefined;
    let chat = continued ?? (named ? this.chat(named) : undefined);
    if (!chat) {
      if (!parent) throw new StudioError("invalid", `run ${run.id} has no Studio chat`);
      chat = await this.createChat(p, { title: run.name ?? run.title ?? oneLine(run.startState.prompt, 40), agent: run.agent, mode: "build", parentRunId: parent.id });
    }
    // A turn Studio started (send) waits for its run; any other run (a child, a report, an agent's follow-up) is a new turn.
    const waiting = this.running.get(chat.id);
    const turn =
      waiting && !waiting.runId
        ? this.opts.store.get<Turn>(C.turns, waiting.turnId)!
        : this.newTurn(p, chat, { prompt: followUpText(run.startState.prompt), mode: "build", via: "api", by: run.creator ?? "kiln" });
    this.running.get(chat.id)!.runId = run.id;
    this.save(C.turns, { ...turn, runId: run.id });
    this.touch(C.chats, { ...this.chat(chat.id), runId: run.id, status: "working", question: undefined });
    const startHead = await must(live.sandbox, chat.path, "git rev-parse HEAD");
    await must(live.sandbox, chat.path, `rm -f ${STUDIO_FILE}`);
    this.lent.set(run.id, { chatId: chat.id, turnId: turn.id, startHead });
    this.turnWaiters.get(run.id)?.resolve(this.opts.store.get<Turn>(C.turns, turn.id)!);
    this.turnWaiters.delete(run.id);
    return { sandbox: live.sandbox, cwd: chat.path };
  }

  /** The run is done with its worktree: checkpoint, enforce the mode, record the turn, apply in cowboy mode, snapshot. */
  async release(run: RunRef): Promise<void> {
    const lent = this.lent.get(run.id);
    if (!lent) return;
    this.lent.delete(run.id);
    let settled!: () => void;
    const settling = new Promise<void>((res) => (settled = res));
    this.settling.set(lent.chatId, settling);
    try {
      await this.settle(run, lent);
    } finally {
      if (this.settling.get(lent.chatId) === settling) this.settling.delete(lent.chatId);
      settled();
    }
  }

  private async settle(run: RunRef, lent: Lent): Promise<void> {
    const p = this.app(run.app!);
    const turn = this.opts.store.get<Turn>(C.turns, lent.turnId)!;
    try {
      await this.finishTurn(p, lent.chatId, turn, run, lent.startHead);
    } catch (err) {
      this.finishFailed(p, lent.chatId, turn, err instanceof Error ? err.message : String(err));
    }
    this.running.get(lent.chatId)?.finish();
    const after = this.opts.store.get<Turn>(C.turns, turn.id)!;
    const app = this.app(p.id);
    if (app.shipMode === "cowboy" && after.checkpoint && !this.running.has(lent.chatId)) {
      try {
        await this.autoApply(app, lent.chatId, after);
      } catch (err) {
        // The checkpoint is safe on the chat branch; the person can apply it by hand.
        const question = `Applying this chat failed: ${err instanceof Error ? err.message : String(err)}`;
        this.touch(C.chats, { ...this.chat(lent.chatId), status: "needs_you", question });
        this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId: lent.chatId, question, reason: "failed", priority: "needs_you" });
      }
    }
    try {
      await this.snapshot(p.id);
    } catch (err) {
      // The turn is saved; only resuming after a restart is at risk. Record it on the App.
      this.touch(C.apps, { ...this.app(p.id), error: `saving the workspace failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** A run's events (already redacted by the run) become its turn's activity. */
  private recordEvent(e: { runId: string; type: string; text?: string; data?: unknown }) {
    const lent = this.lent.get(e.runId);
    if (!lent) return;
    const turn = this.opts.store.get<Turn>(C.turns, lent.turnId);
    if (!turn) return;
    const clean = this.redactor(this.app(turn.appId));
    const at = this.now();
    const text = clean(e.text ?? "");
    let a: Activity | undefined;
    if (e.type === "message") {
      a = { kind: "message", text, at };
      turn.reply = text;
    } else if (e.type === "reasoning") a = { kind: "reasoning", text, at };
    else if (e.type === "tool_call") {
      const input = (e.data ?? {}) as Record<string, unknown>;
      a = SUBAGENT_TOOLS.has(text)
        ? { kind: "subagent", name: text, text: clean(String(input.description ?? input.prompt ?? "")), at }
        : { kind: "tool", name: text, ...(typeof input.file_path === "string" ? { text: clean(input.file_path) } : {}), at };
    } else if (e.type === "spawn") a = { kind: "subagent", name: "spawn_agent", text, at };
    else if (e.type === "error") a = { kind: "error", text, at };
    if (!a) return;
    turn.activity.push(a);
    this.save(C.turns, turn);
  }

  private async finishTurn(p: App, chatId: string, turn: Turn, run: RunRef, startHead: string) {
    const chat = this.chat(chatId);
    const { sandbox: sbx } = await this.ensureLive(p);
    const meta = parseStudioFile(await sbx.readFile(`${chat.path}/${STUDIO_FILE}`));
    const clean = this.redactor(p);
    turn.reply ||= clean(run.summary ?? "");
    turn.costUsd = run.costUsd;
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
    turn.status = run.status === "succeeded" ? "succeeded" : run.status === "failed" || run.status === "error" ? "failed" : "cancelled";
    turn.finishedAt = this.now();
    this.save(C.turns, turn);
    const needs = turn.question ?? (turn.status === "failed" ? `The agent failed: ${oneLine(clean(run.summary ?? ""), 200)}` : undefined);
    this.touch(C.chats, { ...this.chat(chatId), status: needs ? "needs_you" : "idle", ...(needs ? { question: needs } : { question: undefined }) });
    this.opts.bus.publish("studio.turn_finished", {
      appId: p.id,
      chatId,
      turnId: turn.id,
      title,
      ...(turn.summary ? { summary: turn.summary } : {}),
      changed: Boolean(turn.checkpoint),
      priority: "finished",
    });
    if (needs) this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId, question: needs, reason: turn.question ? "question" : "failed", priority: "needs_you" });
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

  /** Run `fn` with the App's sandbox under the App's Git lock (shipping pushes from here). */
  async withWorkspace<T>(appId: string, fn: (sandbox: Sandbox, app: App) => Promise<T>): Promise<T> {
    const p = this.readyApp(appId);
    return this.locked(p.id, async () => fn((await this.ensureLive(p)).sandbox, this.app(appId)));
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
        await this.install(live.sandbox, "version", p.setup!.install, this.env(p));
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
