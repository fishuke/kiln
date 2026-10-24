import { randomBytes } from "node:crypto";
import type { EventBus } from "@kiln/events";
import type { ResolvedAgent } from "@kiln/definitions";
import { shellQuote, type Proc, type Sandbox, type SandboxAddress, type SandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import type { ObjectStore, Store } from "@kiln/store";
import { z } from "zod";
import { DEFAULT_AGENT, targetOf, type AppDefinitions } from "./app-definitions";
import { detectSetup, devCommand, devScript, ENV_EXAMPLES, envKeys, listenPort, plainLine } from "./setup";
import { DEFAULT_READY, TEMPLATES, type Template } from "./templates";
import { NOOP_TRACER, type StudioSpanAttributes, type StudioTracer } from "./tracer";
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
  start(input: {
    appId: string;
    chatId: string;
    agent: string;
    prompt: string;
    by: string;
    via: Via;
    harness?: HarnessType;
    model?: string;
  }): Promise<{ runId: string }>;
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
  /** The run's trace in the tracing backend (OpenTelemetry). */
  traceId?: string;
  startState: { prompt: string };
};

/** A gate as Studio reads it (structural: the engine's Gate). `decision` is set only when a person decided. */
export type GateRef = { id: string; runId?: string; command?: string; state: string; decision?: string; decidedBy?: string };

/** The gates runs wait on; the API wires this to the engine's GateService. */
export interface StudioGates {
  get(id: string): GateRef | undefined;
}

/** An App's definition for its runs, as the engine's KilnOptions.apps returns it (structural). */
export type AppRunDefinition = {
  sha: string;
  team: string;
  agents: Record<string, ResolvedAgent>;
  skill(agent: string, name: string): { body: string; description?: string } | undefined;
  monthlyUsd?: number;
  env: Record<string, string>;
  secretValues: string[];
  unguarded?: boolean;
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
  /** Command approvals App runs wait on; a chat shows them and needs the person while one is open. */
  gates?: StudioGates;
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
  /** Spans for Studio's slow steps; records nothing by default. */
  tracer?: StudioTracer;
};

/**
 * A dev server. `preview` names what it serves (for studio.preview_failed); `output` keeps its last output lines;
 * `log` the longer tail mirrored to DEV_LOG in `cwd` for the agent; `failure` is set once its failure is reported;
 * `stopped` when Studio itself stopped it (not a failure); `exited` once its process ended.
 */
type Dev = {
  proc: Proc;
  cwd: string;
  port: number;
  state: "starting" | "ready" | "failed";
  preview: { chatId: string } | { versionId: string };
  output: string[];
  log: string[];
  logFlush?: ReturnType<typeof setTimeout>;
  failure?: string;
  stopped?: boolean;
  exited?: boolean;
};
/** An App's environment: the values people assigned (team → Kiln Project → App), and which of them are secret. */
export type AppEnv = { env: Record<string, string>; secretValues: string[] };

/** `addresses`: where each dev server port is reachable, asked of the sandbox once per port. */
/** `chats`: each chat's worktree preparation in this sandbox (see `prepare`). */
type Live = { sandbox: Sandbox; devs: Map<string, Dev>; addresses: Map<number, SandboxAddress>; chats: Map<string, Promise<void>>; shownVersion?: string };
/** A chat's turn in progress: its run once it works in the worktree (`started` is the run asked for before that); `finish` ends it. */
type Running = { turnId: string; runId?: string; started?: string; done: Promise<void>; finish: () => void };
/** A run working in a chat's worktree. */
type Lent = { chatId: string; turnId: string; startHead: string };

const STUDIO_FILE = ".kiln/studio.json";
/** The dev server's recent output, in the worktree it serves (.kiln/ is git-excluded), so the agent can troubleshoot. */
const DEV_LOG = ".kiln/dev.log";
/** The dev server's shell, so Studio can stop its whole process tree inside the sandbox. */
const DEV_PID = ".kiln/dev.pid";
const StudioFile = z
  .object({ title: z.string().optional(), summary: z.string().optional(), question: z.string().optional(), restartPreview: z.boolean().optional() })
  .passthrough();
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/**
 * What a tool call acted on, for its activity line: a command's first line, a file path relative to
 * the chat's worktree, a search pattern (and where), a URL or a query.
 */
export function toolText(input: Record<string, unknown>): string | undefined {
  const str = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined);
  const rel = (p: string) => p.replace(/^.*\/chats\/[^/]+\//, "");
  const command = str("command");
  if (command) return oneLine(command.split("\n")[0]!, 200);
  const file = str("file_path") ?? str("notebook_path");
  if (file) return rel(file);
  const pattern = str("pattern");
  if (pattern) return str("path") ? `${pattern} in ${rel(str("path")!)}` : pattern;
  return str("url") ?? str("query") ?? str("description");
}

const withText = (t: string | undefined, clean: (s: string) => string) => (t ? { text: clean(t) } : {});
/** Chat dev servers use the ports after the version preview's; the preview network policy allows 4100–4199. */
const MAX_CHATS = 99;
/** How often the ready check asks a starting dev server. */
const READY_POLL_MS = 200;
/** How many of a dev server's last output lines studio.preview_failed carries. */
const DEV_OUTPUT_LINES = 40;
/** How many lines DEV_LOG keeps, and how often it is rewritten while output arrives. */
const DEV_LOG_LINES = 500;
const DEV_LOG_FLUSH_MS = 1000;
/** How long stopping a dev server waits for it to exit. */
const DEV_STOP_MS = 5000;
/** Stops a process and its descendants (Linux /proc); where there is no /proc, killing the spawned process has to do. */
const KILL_TREE = `kill_tree() { for c in $(grep -l "^PPid:[[:space:]]*$1$" /proc/[0-9]*/status 2>/dev/null | cut -d/ -f3); do kill_tree "$c"; done; kill -TERM "$1" 2>/dev/null; }`;
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
const followUpText = (prompt: string) =>
  prompt
    .split(/\n## Follow-up from [^\n]*\n/)
    .at(-1)!
    .trim();

/** What every App agent is told about working in Studio (after its own instructions and mandatory skills). */
export const STUDIO_INSTRUCTIONS = [
  "## Working in Kiln Studio",
  "Your working directory is a Git worktree of the app; a person watches a live preview of it.",
  `When you finish, write ${STUDIO_FILE} with {"title": "<what changed, past tense, at most 60 characters>", "summary": "<two short sentences for the person>"}, and add "question" only when you need the person to decide something.`,
  "Studio commits your changes and merges them; don't push. If the request is only a question, just answer it and change nothing.",
  `Studio runs the preview's dev server; don't start one yourself, it would take the preview's port. Its recent output is in ${DEV_LOG}: read it when the preview is broken or the person reports an error, and fix the cause. When the preview needs a restart (it's stuck, the person asks to restart or redeploy it, or you changed config the dev server only reads at start), add "restartPreview": true to ${STUDIO_FILE}; Studio restarts it with the App's current environment when your turn ends.`,
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
  /** Chats a deleteChat is removing: they take no new messages. */
  private readonly deleting = new Set<string>();
  /** Why a chat's worktree last failed to prepare, for the turn that waited on it. */
  private readonly prepareErrors = new Map<string, string>();
  private readonly turnWaiters = new Map<string, { resolve: (turn: Turn) => void; reject: (err: Error) => void }>();
  private readonly provisioning = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly templates: Record<string, Template>;

  constructor(private readonly opts: StudioOptions) {
    this.templates = opts.templates ?? TEMPLATES;
    this.reconcile();
    opts.bus.subscribe("run.event", (e) => this.recordEvent(e.payload));
    opts.bus.subscribe("gate.opened", (e) => this.approvalOpened(e.payload.gateId));
    opts.bus.subscribe("gate.decided", (e) => {
      const runId = this.opts.gates?.get(e.payload.gateId)?.runId;
      const lent = runId ? this.lent.get(runId) : undefined;
      if (lent) this.settleApproval(lent.turnId);
    });
    // A run that ended without a workspace (it failed to start) never becomes a turn.
    opts.bus.subscribe("run.finished", (e) => {
      const runId = e.payload.runId;
      if (this.lent.has(runId)) return;
      const message = `run ${runId} ended before it started working`;
      const waiter = this.turnWaiters.get(runId);
      if (waiter) {
        this.turnWaiters.delete(runId);
        waiter.reject(new StudioError("unavailable", message));
      }
      // A turn send started for this run (its worktree failed to prepare, or the run failed to start) ends here.
      for (const [chatId, entry] of this.running) {
        if (entry.started !== runId || entry.runId) continue;
        const turn = this.opts.store.get<Turn>(C.turns, entry.turnId);
        const chat = this.opts.store.get<Chat>(C.chats, chatId);
        if (turn && chat) this.finishFailed(this.app(chat.appId), chatId, turn, this.prepareErrors.get(chatId) ?? message);
        this.prepareErrors.delete(chatId);
        entry.finish();
      }
    });
  }

  /** On startup: what a restart cut off can't continue, so it fails and the chat asks the person. */
  private reconcile() {
    const reason = "interrupted by a restart";
    for (const a of this.opts.store.list<App>(C.apps, (x) => x.status === "creating")) this.touch(C.apps, { ...a, status: "failed", error: reason });
    for (const t of this.opts.store.list<Turn>(C.turns, (x) => x.status === "running")) {
      // The engine expires a command approval a restart cut off, which blocks the command.
      const approval = t.approval?.state === "waiting" ? { approval: { ...t.approval, state: "blocked" as const } } : {};
      this.save(C.turns, { ...t, ...approval, status: "failed", reply: t.reply || reason, finishedAt: this.now() });
    }
    for (const c of this.opts.store.list<Chat>(C.chats, (x) => x.status === "working"))
      this.touch(C.chats, { ...c, status: "needs_you", question: `The agent failed: ${reason}` });
    // Chats saved before chats named their agent (Studio before turns became runs) use the default agent.
    for (const c of this.opts.store.list<Partial<Chat> & Pick<Chat, "id">>(C.chats, (x) => !x.agent))
      this.opts.store.put(C.chats, { ...c, agent: DEFAULT_AGENT });
  }

  // ---- reads ----

  listApps(team: string): App[] {
    return this.opts.store.list<App>(C.apps, (p) => p.team === team).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getApp(appId: string): { app: App; chats: Chat[]; versions: Version[] } | undefined {
    const stored = this.opts.store.get<App>(C.apps, appId);
    if (!stored) return undefined;
    // People assign variables after setup, so what's missing is worked out on each read; so is the
    // general agent's harness, which people change in the App's settings.
    const withSetup = stored.setup ? { ...stored, setup: { ...stored.setup, envMissing: this.missingEnv(stored, stored.setup) } } : stored;
    const app = { ...withSetup, ...this.agentHarness(stored) };
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
    firstPrompt?: { text: string; via: Via };
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
      ...(input.firstPrompt ? { firstPrompt: input.firstPrompt } : {}),
      createdBy: input.by,
      createdAt: now,
      updatedAt: now,
    };
    this.save(C.apps, app);
    // The App's settings are where its agent's harness lives; chats and runs read it from there.
    if (input.harness || input.model)
      this.opts.definitions.edit(
        targetOf(app),
        { agents: { [DEFAULT_AGENT]: { ...(input.harness ? { harness: input.harness } : {}), ...(input.model ? { model: input.model } : {}) } } },
        input.by,
        "Harness chosen when the App was created",
      );
    this.setUpInBackground(app);
    return app;
  }

  /**
   * Sets a failed App up again on a fresh sandbox: its sandbox (if this process holds one) is destroyed, its
   * versions, snapshot, setup and error are dropped, and it is `creating` until setup succeeds or fails again.
   */
  async retryApp(appId: string): Promise<App> {
    return this.locked(appId, async () => {
      const p = this.failedApp(appId, "retried");
      await this.discardWorkspace(appId);
      for (const v of this.versions(appId)) this.opts.store.delete(C.versions, v.id);
      const { error: _error, setup: _setup, snapshot: _snapshot, ...rest } = p;
      const app = this.touch<App>(C.apps, { ...rest, status: "creating" });
      this.setUpInBackground(app);
      return app;
    });
  }

  /** Deletes a failed App: destroys its sandbox (if this process holds one) and removes its chats, turns, versions and record. */
  async deleteApp(appId: string): Promise<void> {
    await this.locked(appId, async () => {
      this.failedApp(appId, "deleted");
      await this.discardWorkspace(appId);
      const { chats, versions } = this.getApp(appId)!;
      for (const c of chats) {
        for (const t of this.opts.store.list<Turn>(C.turns, (x) => x.chatId === c.id)) this.opts.store.delete(C.turns, t.id);
        this.opts.store.delete(C.chats, c.id);
      }
      for (const v of versions) this.opts.store.delete(C.versions, v.id);
      this.opts.store.delete(C.apps, appId);
    });
  }

  private failedApp(appId: string, action: string): App {
    const p = this.app(appId);
    if (p.status !== "failed") throw new StudioError("invalid", `only a failed app can be ${action}; this one is ${p.status}`);
    return p;
  }

  /** Stops the App's dev servers and destroys its sandbox, when this process holds one. */
  private async discardWorkspace(appId: string) {
    const live = this.live.get(appId);
    if (!live) return;
    this.stopDevs(live);
    this.live.delete(appId);
    await live.sandbox.destroy();
  }

  /** Sets the App up; `ready` waits for setup and for the first chat to start. */
  private setUpInBackground(app: App) {
    this.provisioning.set(
      app.id,
      this.provision(app)
        .finally(() => this.provisioning.delete(app.id))
        .then(() => this.startFirstChat(app.id)),
    );
  }

  /** Starts the first chat with the prompt the App was created with; a failed App keeps it for a retry. */
  private async startFirstChat(appId: string) {
    const p = this.getApp(appId)?.app;
    if (p?.status !== "ready" || !p.firstPrompt) return;
    const { firstPrompt, ...rest } = p;
    this.touch<App>(C.apps, rest);
    await this.trace("studio.first_chat", { "kiln.studio.app.id": appId }, () =>
      this.newChat(appId, { by: p.createdBy, via: firstPrompt.via, prompt: firstPrompt.text }),
    ).catch(() => {
      // Already recorded on the studio.first_chat span.
    });
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
        p.snapshot = await this.snapshotOf(appId, live.sandbox);
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
    const stops = await Promise.allSettled(
      working.filter((r) => r.runId && this.opts.runs.active(r.runId)).map((r) => this.opts.runs.interrupt(r.runId!, "studio")),
    );
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

  /**
   * Sets an App up in a new sandbox. A failure marks the App failed and publishes studio.app_failed inside the
   * provision span, so its log record carries the trace; the span ends with error status.
   */
  private async provision(app: App) {
    await this.trace("studio.provision", { "kiln.studio.app.id": app.id, "kiln.studio.app.source": app.source.kind }, async () => {
      try {
        await this.setUp(app);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const p = this.app(app.id);
        p.status = "failed";
        p.error = message;
        this.touch(C.apps, p);
        this.opts.bus.publish("studio.app_failed", { appId: app.id, error: this.redactor(p)(message), priority: "needs_you" });
        throw err;
      }
    }).catch(() => {
      // Already recorded: on the App, as studio.app_failed, and on the provision span.
    });
  }

  private async setUp(app: App) {
    const attrs = { "kiln.studio.app.id": app.id };
    const source = app.source;
    const template = source.kind === "template" ? this.templates[source.template]! : undefined;
    // The provider clones an imported repository into "app" and allows its host for the clone.
    const { sandbox, branch } =
      source.kind === "repo"
        ? await this.trace("studio.clone", { ...attrs, "kiln.studio.repo": source.repo }, async () => {
            const clone = await this.opts.clone!(source);
            return { sandbox: await this.opts.sandboxes.create(this.spec(app, clone.url)), branch: clone.branch };
          })
        : { sandbox: await this.opts.sandboxes.create(this.spec(app)), branch: undefined };
    this.live.set(app.id, { sandbox, devs: new Map(), addresses: new Map(), chats: new Map() });
    const env = this.env(app);
    await must(sandbox, ".", "mkdir -p chats");
    let mainBranch = "main";
    let title: string;
    if (source.kind === "template") {
      await this.trace("studio.scaffold", { ...attrs, "kiln.studio.template": source.template }, async () => {
        await must(sandbox, ".", "mkdir -p app");
        for (const cmd of template!.scaffold)
          await must(sandbox, "app", cmd.replaceAll("{templates}", shellQuote(this.opts.templatesDir ?? "/opt/kiln/templates")), env);
        await must(sandbox, "app", "git init -q -b main");
      });
      title = `Created ${app.name}`;
    } else {
      const want = source.branch ?? branch;
      if (want) await must(sandbox, "app", `git checkout -q ${shellQuote(want)}`);
      mainBranch = await must(sandbox, "app", "git rev-parse --abbrev-ref HEAD");
      // Forget the credential in the clone URL; Studio never pushes in phases 1–4.
      await must(sandbox, "app", "git remote remove origin");
      title = `Imported ${source.repo}`;
    }
    await must(
      sandbox,
      "app",
      `git config user.email studio@kiln.local && git config user.name 'Kiln Studio' && mkdir -p .git/info && printf '.kiln/\\n' >> .git/info/exclude`,
    );
    const setup = await this.detect(sandbox, app, mainBranch, template);
    if (template) await this.trace("studio.commit", attrs, () => must(sandbox, "app", "git add -A && git commit -q -m " + shellQuote(title)));
    else await this.install(app.id, sandbox, "app", setup.install, env);
    const sha = await must(sandbox, "app", "git rev-parse HEAD");
    const p = this.app(app.id);
    p.setup = setup;
    p.status = "ready";
    this.touch(C.apps, p);
    this.addVersion(p, { sha, title, kind: "initial" });
    await this.snapshot(p.id);
  }

  /**
   * Installs dependencies in a worktree, then puts its tracked and unignored files back as they were, so
   * nothing the install writes (a generated lockfile, a reformatted package.json) counts as an agent's change.
   * Ignored files, such as node_modules, stay.
   */
  private async install(appId: string, sandbox: Sandbox, cwd: string, commands: string[], env: Record<string, string>) {
    if (!commands.length) return;
    await this.trace("studio.install", { "kiln.studio.app.id": appId, "kiln.studio.cwd": cwd }, async () => {
      for (const cmd of commands) await must(sandbox, cwd, cmd, env);
      await must(sandbox, cwd, "git checkout -q -- . && git clean -fdq -e node_modules");
    });
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
    setup.envMissing = this.missingEnv(app, setup);
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
    // Fails early for an agent the App doesn't define, or a first turn beyond the running-chat limit.
    this.opts.definitions.chatConfig(targetOf(p), { agent });
    if (input.prompt) this.mayStartTurn(appId);
    const chat = await this.createChat(p, {
      title: input.title ?? (input.prompt ? oneLine(input.prompt, 40) : undefined),
      agent,
      mode: input.mode ?? "build",
      ...(input.harness ? { harness: input.harness } : {}),
      ...(input.model ? { model: input.model } : {}),
    });
    // The chat opens now; its worktree is prepared in the background, and its first turn waits for it.
    this.prepare(p, chat).catch(() => undefined);
    if (!input.prompt) return { chat };
    const { turn } = await this.send(chat.id, { by: input.by, via: input.via, text: input.prompt, ...(input.mode ? { mode: input.mode } : {}) });
    return { chat: this.chat(chat.id), turn };
  }

  /** A chat's record; `prepare` makes its worktree. */
  private createChat(p: App, input: { title?: string; agent: string; mode: ChatMode; harness?: HarnessType; model?: string; parentRunId?: string }): Chat {
    const chatId = id("sc");
    const existing = this.getApp(p.id)!.chats.length;
    if (existing >= MAX_CHATS) throw new StudioError("invalid", `an app can have at most ${MAX_CHATS} chats`);
    const now = this.now();
    // The agent's harness and model from the App's settings, unless the chat chose its own.
    const { harness, model } = this.opts.definitions.chatConfig(targetOf(p), {
      agent: input.agent,
      ...(input.harness ? { harness: input.harness } : {}),
      ...(input.model ? { model: input.model } : {}),
    });
    const chat: Chat = {
      id: chatId,
      appId: p.id,
      title: input.title ?? `Chat ${existing + 1}`,
      agent: input.agent,
      mode: input.mode,
      harness,
      ...(model ? { model } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      branch: `chat/${chatId}`,
      path: `chats/${chatId}`,
      port: this.freePort(p.id),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    return this.save(C.chats, chat);
  }

  /**
   * The chat's worktree (branch chat/<id> from the App's main line) with its dependencies installed, once
   * per sandbox: a later call waits for the first. A failed preparation is removed, so the next call retries.
   */
  private async prepare(p: App, chat: Chat): Promise<Live> {
    const live = await this.ensureLive(p);
    let job = live.chats.get(chat.id);
    if (!job) {
      // Deleted while the sandbox was starting: no worktree for it.
      if (!this.opts.store.get<Chat>(C.chats, chat.id)) throw new StudioError("not_found", `chat ${chat.id} was deleted`);
      job = this.makeWorktree(p, live.sandbox, chat);
      live.chats.set(chat.id, job);
      this.prepareErrors.delete(chat.id);
      job.catch((err: unknown) => {
        live.chats.delete(chat.id);
        this.prepareErrors.set(chat.id, `preparing the chat's workspace failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    await job;
    return live;
  }

  private async makeWorktree(p: App, sandbox: Sandbox, chat: Chat): Promise<void> {
    // A sandbox restored from a snapshot already has the worktree.
    if ((await sandbox.exec(`test -d ${chat.path}`, { trusted: true })).code === 0) return;
    await this.locked(p.id, () => must(sandbox, "app", `git worktree add -q -b ${chat.branch} ../${chat.path} ${shellQuote(p.setup!.mainBranch)}`));
    try {
      // Starts from another worktree's installed dependencies, so the install only tops them up.
      if (p.setup!.install.length)
        await must(
          sandbox,
          chat.path,
          'for d in ../../app ../../version ../*; do [ -d "$d/node_modules" ] && [ "$d" != "../' +
            chat.id +
            '" ] && cp -a "$d/node_modules" . && break; done; true',
        );
      await this.install(p.id, sandbox, chat.path, p.setup!.install, this.env(p));
    } catch (err) {
      await this.locked(p.id, () => sandbox.exec(`git worktree remove --force ../${chat.path}; git branch -D ${chat.branch}; true`, { cwd: "app", trusted: true }));
      throw err;
    }
  }

  /**
   * A message to a chat: steers its live run, or starts its next turn (a new run, or a follow-up that
   * continues the chat's finished run). Resolves once the run exists.
   */
  async send(chatId: string, input: { by: string; via: Via; text: string; mode?: ChatMode; model?: string }, resolve = false): Promise<{ turn: Turn; steered: boolean }> {
    // The last turn is still being saved in the worktree: the next one starts after it. A resolve turn is
    // started by that saving itself, once the worktree is free.
    if (!resolve) await this.settling.get(chatId);
    let chat = this.chat(chatId);
    const current = this.running.get(chatId);
    if (current?.runId) {
      const r = await this.opts.runs.followup(current.runId, { message: input.text, by: input.by });
      if (r.delivered === "steered") return { turn: this.opts.store.get<Turn>(C.turns, current.turnId)!, steered: true };
      // The run had just finished: the follow-up continued it, and that run is the chat's next turn.
      return { turn: await this.turnOf(r.runId), steered: false };
    }
    if (current) throw new StudioError("busy", "the chat's turn is starting; try again in a moment");
    if (this.deleting.has(chatId)) throw new StudioError("busy", "the chat is being deleted");
    this.mayStartTurn(chat.appId, chatId);
    const p = this.readyApp(chat.appId);
    // A chat keeps its model; the person may still choose it with the first message.
    if (input.model && !chat.runId && input.model !== chat.model) chat = this.touch(C.chats, { ...chat, model: input.model });
    const mode = input.mode ?? chat.mode;
    const turn = this.newTurn(p, chat, { prompt: input.text, mode, via: input.via, by: input.by, resolve });
    this.touch(C.chats, { ...chat, mode, status: "working", question: undefined });
    const message = MODE_NOTES[mode] ? `${MODE_NOTES[mode]}\n\n${input.text}` : input.text;
    try {
      const { runId } = chat.runId
        ? await this.opts.runs.followup(chat.runId, { message, by: input.by })
        : await this.opts.runs.start({
          appId: p.id,
          chatId,
          agent: chat.agent,
          prompt: message,
          by: input.by,
          via: input.via,
          harness: chat.harness,
          ...(chat.model ? { model: chat.model } : {}),
        });
      const entry = this.running.get(chatId);
      if (entry?.turnId === turn.id && !entry.runId) entry.started = runId;
    } catch (err) {
      // The run never started (a budget, an unknown agent): the turn ends here.
      this.finishFailed(p, chatId, turn, err instanceof Error ? err.message : String(err));
      this.finishRunning(chatId, turn.id);
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

  /**
   * Deletes a chat that isn't working: stops its dev server, removes its worktree and branch (when the
   * App's sandbox is up), and removes its turns and record. Versions it applied stay in the history.
   */
  async deleteChat(chatId: string): Promise<void> {
    const chat = this.chat(chatId);
    if (this.running.has(chatId) || this.settling.has(chatId)) throw new StudioError("invalid", "the chat is working; stop it first");
    if (this.deleting.has(chatId)) return;
    this.deleting.add(chatId);
    try {
      await this.removeChat(chat);
    } finally {
      this.deleting.delete(chatId);
    }
  }

  private async removeChat(chat: Chat): Promise<void> {
    const live = this.live.get(chat.appId);
    if (live) {
      // A worktree still being prepared is removed once it is done.
      await live.chats.get(chat.id)?.catch(() => undefined);
      live.chats.delete(chat.id);
      void this.stopDev(live, chat.id);
      await this.locked(chat.appId, async () => {
        await live.sandbox.exec(`git worktree remove --force ../${chat.path}; git branch -D ${chat.branch}; true`, { cwd: "app", trusted: true });
      });
    }
    for (const t of this.opts.store.list<Turn>(C.turns, (x) => x.chatId === chat.id)) this.opts.store.delete(C.turns, t.id);
    this.opts.store.delete(C.chats, chat.id);
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

  /** Refuses a turn beyond the App's running-chat limit (`chatId`'s own running turn doesn't count). */
  private mayStartTurn(appId: string, chatId?: string) {
    const max = this.opts.maxRunningChats ?? 3;
    const busy = this.getApp(appId)!.chats.filter((c) => c.id !== chatId && this.running.has(c.id)).length;
    if (busy >= max) throw new StudioError("busy", `${max} chats are already working in this app`);
  }

  /** Ends the chat's running turn if it is still `turnId`: a later turn that took its place keeps running. */
  private finishRunning(chatId: string, turnId: string) {
    const entry = this.running.get(chatId);
    if (entry?.turnId === turnId) entry.finish();
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
    this.running.set(chat.id, {
      turnId: turn.id,
      done,
      finish: () => (this.running.get(chat.id)?.turnId === turn.id && this.running.delete(chat.id), finish()),
    });
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
      ...(p.shipMode === "cowboy" ? { unguarded: true } : {}),
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
    const named = run.metadata?.["studio.chat"];
    const continued = run.continuationOf ? this.opts.store.list<Chat>(C.chats, (c) => c.runId === run.continuationOf)[0] : undefined;
    let chat = continued ?? (named ? this.chat(named) : undefined);
    if (!chat) {
      if (!parent) throw new StudioError("invalid", `run ${run.id} has no Studio chat`);
      chat = this.createChat(p, {
        title: run.name ?? run.title ?? oneLine(run.startState.prompt, 40),
        agent: run.agent,
        mode: "build",
        parentRunId: parent.id,
      });
    }
    const live = await this.prepare(p, chat);
    // A run that continues the chat (a child's report, an agent's follow-up) starts after the last turn is saved.
    await this.settling.get(chat.id);
    // A turn Studio started (send) waits for its run; any other run (a child, a report, an agent's follow-up) is a new turn.
    const waiting = this.running.get(chat.id);
    const turn =
      waiting && !waiting.runId
        ? this.opts.store.get<Turn>(C.turns, waiting.turnId)!
        : this.newTurn(p, chat, { prompt: followUpText(run.startState.prompt), mode: "build", via: "api", by: run.creator ?? "kiln" });
    this.running.get(chat.id)!.runId = run.id;
    this.save(C.turns, { ...turn, runId: run.id, ...(run.traceId ? { traceId: run.traceId } : {}) });
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
    this.settleApproval(lent.turnId);
    const turn = this.opts.store.get<Turn>(C.turns, lent.turnId)!;
    try {
      await this.finishTurn(p, lent.chatId, turn, run, lent.startHead);
    } catch (err) {
      this.finishFailed(p, lent.chatId, turn, err instanceof Error ? err.message : String(err));
    }
    this.finishRunning(lent.chatId, lent.turnId);
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

  /** The guard asked a person about a command a chat's run wants to run: the turn shows it and the chat needs the person. */
  private approvalOpened(gateId: string) {
    const gate = this.opts.gates?.get(gateId);
    const lent = gate?.runId ? this.lent.get(gate.runId) : undefined;
    const turn = lent ? this.opts.store.get<Turn>(C.turns, lent.turnId) : undefined;
    if (!gate?.command || !lent || !turn) return;
    const p = this.app(turn.appId);
    const command = this.redactor(p)(gate.command);
    this.save(C.turns, { ...turn, approval: { gateId, command, state: "waiting" } });
    const question = `Allow this command? ${oneLine(command, 200)}`;
    this.touch(C.chats, { ...this.chat(lent.chatId), status: "needs_you", question });
    this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId: lent.chatId, question, reason: "approval", priority: "needs_you" });
  }

  /**
   * The turn's waiting approval once its gate closed: allowed when a person approved, else blocked
   * (rejected, or expired because nobody answered in time). The chat works on.
   */
  private settleApproval(turnId: string) {
    const turn = this.opts.store.get<Turn>(C.turns, turnId);
    const approval = turn?.approval;
    if (!turn || approval?.state !== "waiting") return;
    const gate = this.opts.gates?.get(approval.gateId);
    if (gate?.state === "open") return;
    const decision = gate?.state === "approved" ? "allowed" : "blocked";
    const by = gate?.decision ? gate.decidedBy : undefined;
    this.save(C.turns, { ...turn, approval: { ...approval, state: decision, ...(by ? { by } : {}) } });
    const chat = this.chat(turn.chatId);
    if (chat.status === "needs_you") this.touch(C.chats, { ...chat, status: "working", question: undefined });
    this.opts.bus.publish("studio.approval_decided", { appId: turn.appId, chatId: turn.chatId, turnId, decision, ...(by ? { by } : {}), priority: "progress" });
  }

  /** A run's events (already redacted by the run) become its turn's activity. */
  private recordEvent(e: { runId: string; type: string; text?: string; data?: unknown }) {
    const lent = this.lent.get(e.runId);
    if (!lent) return;
    // The run goes on after an approval expired, which publishes no event of its own.
    this.settleApproval(lent.turnId);
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
        : { kind: "tool", name: text, ...withText(toolText(input), clean), at };
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
    if (needs)
      this.opts.bus.publish("studio.needs_you", { appId: p.id, chatId, question: needs, reason: turn.question ? "question" : "failed", priority: "needs_you" });
    // A start failure is reported by the dev server itself (studio.preview_failed); the turn is done either way.
    if (meta.restartPreview) this.restartPreview(chatId).catch(() => undefined);
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
    await this.prepare(p, chat);
    return this.locked(p.id, async () => {
      const { sandbox } = await this.ensureLive(p);
      void by;
      return this.trace("studio.apply", { "kiln.studio.app.id": p.id, "kiln.studio.chat.id": chatId }, () => this.merge(p, chat, sandbox));
    });
  }

  /** Merges a chat's branch into the App's main line as a version (under the App's lock). */
  private async merge(p: App, chat: Chat, sandbox: Sandbox): Promise<ApplyResult> {
    const chatId = chat.id;
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
    return { ok: true, version: this.addVersion(p, { sha, title, kind: "apply", chatId }) } as const;
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
      const { sandbox } = await this.prepare(p, chat);
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
      const live = await this.prepare(p, chat);
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
        await this.install(p.id, live.sandbox, "version", p.setup!.install, this.env(p));
      }
      live.shownVersion = v.id;
    });
    return this.serve(p, live, "version", "version", this.basePort, v.id);
  }

  /** Stops the chat's dev server and starts it again, with the App's current environment and dev command. */
  async restartPreview(chatId: string): Promise<Preview> {
    const chat = this.chat(chatId);
    const live = this.live.get(chat.appId);
    // The new dev server takes the old one's port, so the old one must be gone first.
    if (live) await this.stopDev(live, chat.id);
    return this.preview({ chatId });
  }

  /** Stops the version preview's dev server and starts it again, showing `versionId`. */
  async restartVersionPreview(versionId: string): Promise<Preview> {
    const v = this.version(versionId);
    const live = this.live.get(v.appId);
    if (live) await this.stopDev(live, "version");
    return this.preview({ versionId });
  }

  /**
   * Apps imported before a fixed port (`next dev -p 4000`) was rewritten to `{port}` kept the script itself, so
   * every preview listened on that one port. Detect the dev command again for them; one the person set stays theirs.
   */
  private async portableDev(p: App, live: Live): Promise<string | undefined> {
    const setup = p.setup;
    if (p.source.kind !== "repo" || !setup || setup.devOverride || setup.devDetected?.includes("{port}")) return undefined;
    const detected = devScript(setup.packageManager, await live.sandbox.readFile("app/package.json"));
    if (!detected?.includes("{port}")) return undefined;
    this.touch(C.apps, { ...this.app(p.id), setup: { ...setup, devDetected: detected, dev: detected } });
    return detected;
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
    const dev = (await this.portableDev(p, live)) ?? p.setup?.dev;
    if (!dev) throw new StudioError("invalid", "no dev command: set one in the app settings");
    const attrs = { "kiln.studio.app.id": p.id, "kiln.studio.preview.target": target, "kiln.studio.preview.port": port };
    let running = live.devs.get(key);
    if (!running) {
      const cmd = dev.replaceAll("{port}", String(port));
      const env: Record<string, string> = { ...this.env(p), PORT: String(port), HOST: "0.0.0.0" };
      // The template's next.config.ts allows dev origins (hot reload) under the preview domain.
      if (this.opts.previewDomain) env.KILN_STUDIO_PREVIEW_DOMAIN = this.opts.previewDomain;
      const started = await this.trace("studio.dev_server_start", attrs, async () => {
        // stderr joins stdout, so a failure report has the dev server's errors too.
        const proc = live.sandbox.spawn("sh", ["-c", `exec 2>&1\nmkdir -p .kiln && echo $$ > ${DEV_PID}\n${cmd}`], { cwd, env });
        const d: Dev = { proc, cwd, port, state: "starting", preview: key === "version" ? { versionId: target } : { chatId: key }, output: [], log: [] };
        live.devs.set(key, d);
        this.watchDev(p, live, d).catch((err: unknown) => this.devFailed(p, d, `reading the dev server's output failed: ${errorText(err)}`));
        try {
          await this.address(live, port);
        } catch (err) {
          this.devFailed(p, d, `the dev server's address is unknown: ${errorText(err)}`);
          throw err;
        }
        return d;
      });
      running = started;
      const template = p.source.kind === "template" ? this.templates[p.source.template] : undefined;
      const ready = template?.ready ?? DEFAULT_READY;
      this.trace("studio.ready_check", { ...attrs, "kiln.studio.preview.path": ready.path, "kiln.studio.preview.timeout_ms": ready.timeoutMs }, () =>
        this.checkReady(live, started, ready),
      ).catch((err: unknown) => {
        // A dev server that never answered keeps running (its preview shows failed); anything else stops it.
        if (err instanceof ReadyTimeout) this.reportDev(p, started, err.message);
        else this.devFailed(p, started, errorText(err));
      });
    }
    const url = this.opts.previewUrl(target, await this.address(live, running.port));
    if (running.state !== "failed" || running.failure === undefined) return { target, url, status: running.state };
    return { target, url, status: "failed", reason: running.failure, output: this.redactor(p)(running.output.join("\n")) };
  }

  /** Ready once GET `path` answers with any status; throws ReadyTimeout after `timeoutMs`, and the dev server's failure when it exits first. */
  private async checkReady(live: Live, dev: Dev, ready: { path: string; timeoutMs: number }) {
    const fetchImpl = this.opts.fetch ?? fetch;
    const deadline = Date.now() + ready.timeoutMs;
    while (dev.state === "starting") {
      const left = deadline - Date.now();
      if (left <= 0) {
        dev.state = "failed";
        throw new ReadyTimeout(`the dev server didn't answer GET ${ready.path} on port ${dev.port} within ${ready.timeoutMs} ms`);
      }
      const a = await this.address(live, dev.port);
      if (await answers(fetchImpl, `http://${a.host}:${a.port}${ready.path}`, left)) dev.state = "ready";
      else await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
    if (dev.state === "failed") throw new Error(dev.failure ?? "the dev server failed");
  }

  /**
   * Follow a dev server's output: keep its last lines and switch to the port it says it listens on. An exit Studio didn't ask for is reported, and the preview stays failed until it is restarted.
   */
  private async watchDev(p: App, live: Live, dev: Dev) {
    let seen = 0;
    for await (const raw of dev.proc.lines) {
      const line = plainLine(raw);
      dev.output.push(line);
      if (dev.output.length > DEV_OUTPUT_LINES) dev.output.shift();
      this.logDev(p, live, dev, line);
      const port = seen++ < 50 ? listenPort(line) : undefined;
      if (port && port !== dev.port) dev.port = port;
    }
    const { code } = await dev.proc.exit;
    dev.exited = true;
    this.logDev(p, live, dev, `[kiln] the dev server ${dev.stopped ? "was stopped" : `exited with code ${code}`}`);
    if (dev.stopped) return;
    dev.state = "failed";
    this.reportDev(p, dev, `the dev server exited with code ${code}`);
  }

  private async address(live: Live, port: number): Promise<SandboxAddress> {
    const known = live.addresses.get(port);
    if (known) return known;
    const a = await live.sandbox.expose!(port);
    live.addresses.set(port, a);
    return a;
  }

  /** Keeps a dev server's output tail and rewrites DEV_LOG at most once per DEV_LOG_FLUSH_MS; secret values redacted. */
  private logDev(p: App, live: Live, dev: Dev, line: string) {
    dev.log.push(line);
    if (dev.log.length > DEV_LOG_LINES) dev.log.shift();
    if (dev.logFlush) return;
    dev.logFlush = setTimeout(() => {
      dev.logFlush = undefined;
      live.sandbox.writeFile(`${dev.cwd}/${DEV_LOG}`, this.redactor(p)(`${dev.log.join("\n")}\n`)).catch(() => undefined);
    }, DEV_LOG_FLUSH_MS);
    dev.logFlush.unref?.();
  }

  /** A dev server whose output or address broke: reported and stopped; the preview shows failed until it is restarted. */
  private devFailed(p: App, dev: Dev, reason: string) {
    dev.state = "failed";
    this.reportDev(p, dev, reason);
    dev.stopped = true;
    dev.proc.kill();
  }

  /** Publishes studio.preview_failed once per dev server, with its last output lines; secret values redacted. */
  private reportDev(p: App, dev: Dev, reason: string) {
    if (dev.failure !== undefined) return;
    const clean = this.redactor(p);
    dev.failure = clean(reason);
    this.opts.bus.publish("studio.preview_failed", {
      appId: p.id,
      ...dev.preview,
      port: dev.port,
      reason: dev.failure,
      output: clean(dev.output.join("\n")),
      priority: "progress",
    });
  }

  /** The lowest preview port no chat of the App uses (deleted chats free theirs). */
  private freePort(appId: string): number {
    const used = new Set(this.getApp(appId)!.chats.map((c) => c.port));
    let port = this.basePort + 1;
    while (used.has(port)) port++;
    return port;
  }

  /** Stops one dev server and what it started inside the sandbox; resolves when it has exited (or after DEV_STOP_MS). */
  private async stopDev(live: Live, key: string) {
    const dev = live.devs.get(key);
    if (!dev) return;
    dev.stopped = true;
    live.devs.delete(key);
    // An exited dev server's pid may belong to another process by now.
    if (!dev.exited)
      await live.sandbox
        .exec(`${KILL_TREE}\n[ -f ${DEV_PID} ] && kill_tree "$(cat ${DEV_PID})"; rm -f ${DEV_PID}; true`, { cwd: dev.cwd, trusted: true })
        .catch(() => undefined);
    dev.proc.kill();
    await Promise.race([dev.proc.exit, new Promise((r) => setTimeout(r, DEV_STOP_MS).unref?.())]);
  }

  private stopDevs(live: Live) {
    for (const d of live.devs.values()) {
      d.stopped = true;
      d.proc.kill();
    }
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
      const snapshot = current.snapshot;
      if (!snapshot) throw new StudioError("unavailable", "the app's workspace is gone and has no snapshot");
      const sandbox = await this.trace("studio.resume", { "kiln.studio.app.id": p.id }, async () => {
        const s = await this.opts.sandboxes.resume(snapshot, this.spec(current), this.opts.objects);
        // Worktrees record absolute paths; a resumed workspace may live elsewhere.
        await s.exec('for d in ../chats/* ../version; do [ -e "$d" ] && git worktree repair "$d"; done; true', { cwd: "app", trusted: true });
        return s;
      });
      const live: Live = { sandbox, devs: new Map(), addresses: new Map(), chats: new Map() };
      this.live.set(p.id, live);
      if (current.status === "paused") this.touch(C.apps, { ...current, status: "ready" });
      return live;
    });
  }

  private async snapshot(appId: string) {
    const live = this.live.get(appId);
    if (!live) return;
    const snapshot = await this.snapshotOf(appId, live.sandbox);
    this.touch(C.apps, { ...this.app(appId), snapshot });
  }

  private snapshotOf(appId: string, sandbox: Sandbox) {
    return this.trace("studio.snapshot", { "kiln.studio.app.id": appId }, () => sandbox.snapshot(this.opts.objects));
  }

  private trace<T>(name: string, attributes: StudioSpanAttributes, fn: () => Promise<T>): Promise<T> {
    return (this.opts.tracer ?? NOOP_TRACER).span(name, attributes, fn);
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

  /** The general agent's harness and model, as a new chat gets them; the stored ones when the settings don't resolve. */
  private agentHarness(app: App): Pick<App, "harness" | "model"> {
    try {
      const { harness, model } = this.opts.definitions.chatConfig(targetOf(app));
      return { harness, model };
    } catch {
      return { harness: app.harness, model: app.model };
    }
  }

  /** The keys the App's env example asks for that no variable provides. */
  private missingEnv(app: App, setup: AppSetup): string[] {
    // The resolver may only look up the keys the App asks for, so it sees the setup first.
    const provided = this.env({ ...app, setup });
    return setup.envRequired.filter((k) => !(k in provided));
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

/** A dev server didn't answer its ready check in time. */
class ReadyTimeout extends Error {
  override name = "ReadyTimeout";
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
