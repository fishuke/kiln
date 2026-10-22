import { randomBytes } from "node:crypto";
import type { EventBus } from "@kiln/events";
import type { HarnessAdapter, HarnessEvent, HarnessResult, HarnessSession } from "@kiln/harness";
import { shellQuote, type Proc, type Sandbox, type SandboxAddress, type SandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import type { ObjectStore, Store } from "@kiln/store";
import { z } from "zod";
import { detectSetup, devCommand, ENV_EXAMPLES, envKeys, listenPort } from "./setup";
import { TEMPLATES, type Template } from "./templates";
import {
  COLLECTIONS as C,
  StudioError,
  type Activity,
  type ApplyResult,
  type Chat,
  type ChatMode,
  type Preview,
  type Project,
  type ProjectSetup,
  type ProjectSource,
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
  /** The one sandbox backend Studio projects run on. */
  sandboxes: SandboxProvider;
  harness: (type: HarnessType) => HarnessAdapter;
  /** Model keys for a harness run (BYOK). */
  credentials?: (project: Project, type: HarnessType) => Record<string, string>;
  templates?: Record<string, Template>;
  /** Runner image when the template names none. */
  image?: string;
  previewUrl: (target: string, address: SandboxAddress) => string;
  /** Imported projects: a clone URL with a short-lived repo-scoped token, and the branch to use. */
  clone?: (source: RepoSource) => Promise<{ url: string; branch?: string }>;
  /** Environment for installs, dev servers and runs (Kiln secrets and environment templates). */
  env?: (project: Project) => Record<string, string>;
  maxRunningChats?: number;
  /** The version preview listens here, chats on the ports after it. Default 4100. */
  basePort?: number;
};

type Live = { sandbox: Sandbox; devs: Map<string, { proc: Proc; port: number }>; shownVersion?: string };
type Running = { session?: HarnessSession; turnId: string; done: Promise<void> };

const STUDIO_FILE = ".kiln/studio.json";
const StudioFile = z.object({ title: z.string().optional(), summary: z.string().optional(), question: z.string().optional() }).passthrough();
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
/** Chat dev servers use the ports after the version preview's; the preview network policy allows 4100–4199. */
const MAX_CHATS = 99;

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
    "You are the coding agent in a Kiln Studio project. Your working directory is a Git worktree of the app; a person watches a live preview of it.",
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
 * Studio (ADR-012): projects in a sandbox, chats on Git worktrees, turns that make a checkpoint only
 * when files change, versions on the project's main line, and dev server previews.
 */
export class Studio {
  private readonly live = new Map<string, Live>();
  private readonly running = new Map<string, Running>();
  private readonly provisioning = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly templates: Record<string, Template>;

  constructor(private readonly opts: StudioOptions) {
    this.templates = opts.templates ?? TEMPLATES;
  }

  // ---- reads ----

  listProjects(team: string): Project[] {
    return this.opts.store.list<Project>(C.projects, (p) => p.team === team).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(projectId: string): { project: Project; chats: Chat[]; versions: Version[] } | undefined {
    const project = this.opts.store.get<Project>(C.projects, projectId);
    if (!project) return undefined;
    const chats = this.opts.store.list<Chat>(C.chats, (c) => c.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { project, chats, versions: this.versions(projectId) };
  }

  getChat(chatId: string): { chat: Chat; turns: Turn[] } | undefined {
    const chat = this.opts.store.get<Chat>(C.chats, chatId);
    if (!chat) return undefined;
    return { chat, turns: this.opts.store.list<Turn>(C.turns, (t) => t.chatId === chatId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
  }

  status(input: { team: string; project?: string }): StatusReport {
    const projects = this.listProjects(input.team).filter((p) => !input.project || p.id === input.project);
    return {
      projects: projects.map((p) => {
        const chats = this.getProject(p.id)!.chats;
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

  // ---- projects ----

  async createProject(input: {
    team: string;
    by: string;
    name: string;
    source?: ProjectSource;
    shipMode?: ShipMode;
    harness?: HarnessType;
    model?: string;
  }): Promise<Project> {
    const source = input.source ?? { kind: "template", template: "nextjs" };
    if (source.kind === "template" && !this.templates[source.template]) throw new StudioError("invalid", `unknown template ${source.template}`);
    if (source.kind === "repo" && !this.opts.clone) throw new StudioError("unavailable", "this server can't import repositories (no forge connection)");
    const now = this.now();
    const project: Project = {
      id: id("sp"),
      team: input.team,
      name: input.name,
      source,
      // Imported repositories ship by pull request; templates are experiments (ADR-012).
      shipMode: input.shipMode ?? (source.kind === "repo" ? "review" : "cowboy"),
      harness: input.harness ?? "claude-code",
      ...(input.model ? { model: input.model } : {}),
      status: "creating",
      createdBy: input.by,
      createdAt: now,
      updatedAt: now,
    };
    this.save(C.projects, project);
    this.provisioning.set(
      project.id,
      this.provision(project).finally(() => this.provisioning.delete(project.id)),
    );
    return project;
  }

  /** Resolves when a new project is ready or has failed. */
  async ready(projectId: string): Promise<void> {
    await this.provisioning.get(projectId);
  }

  updateProject(projectId: string, patch: { name?: string; shipMode?: ShipMode; devCommand?: string | null }): Project {
    const p = this.project(projectId);
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.shipMode !== undefined) p.shipMode = patch.shipMode;
    if (patch.devCommand !== undefined) {
      if (!p.setup) throw new StudioError("invalid", "the project is still being created");
      const { devOverride: _, ...rest } = p.setup;
      p.setup = patch.devCommand === null ? rest : { ...rest, devOverride: patch.devCommand };
      p.setup.dev = devCommand(p.setup);
      if (!p.setup.dev) delete p.setup.dev;
    }
    return this.touch(C.projects, p);
  }

  /** Snapshot the workspace and free the sandbox; the next use resumes it. */
  async pause(projectId: string): Promise<Project> {
    return this.locked(projectId, async () => {
      const p = this.project(projectId);
      const live = this.live.get(projectId);
      if (live) {
        for (const chat of this.getProject(projectId)!.chats) if (this.running.has(chat.id)) throw new StudioError("busy", "a chat is still working");
        this.stopDevs(live);
        p.snapshot = await live.sandbox.snapshot(this.opts.objects);
        await live.sandbox.destroy();
        this.live.delete(projectId);
      }
      p.status = "paused";
      return this.touch(C.projects, p);
    });
  }

  /** Stop every dev server, agent and sandbox without snapshotting (process shutdown, tests). */
  async shutdown(): Promise<void> {
    for (const r of this.running.values()) await r.session?.stop().catch(() => {});
    for (const live of this.live.values()) {
      this.stopDevs(live);
      await live.sandbox.destroy().catch(() => {});
    }
    this.live.clear();
  }

  private async provision(project: Project) {
    try {
      const template = project.source.kind === "template" ? this.templates[project.source.template]! : undefined;
      const sandbox = await this.opts.sandboxes.create(this.spec(project));
      this.live.set(project.id, { sandbox, devs: new Map() });
      const env = this.env(project);
      await must(sandbox, ".", "mkdir -p project chats");
      let mainBranch = "main";
      let title: string;
      if (project.source.kind === "template") {
        for (const cmd of template!.scaffold) await must(sandbox, "project", cmd, env);
        await must(sandbox, "project", "git init -q -b main");
        title = `Created ${project.name}`;
      } else {
        const { url, branch } = await this.opts.clone!(project.source);
        await must(sandbox, ".", `git clone -q ${shellQuote(url)} project`);
        const want = project.source.branch ?? branch;
        if (want) await must(sandbox, "project", `git checkout -q ${shellQuote(want)}`);
        mainBranch = await must(sandbox, "project", "git rev-parse --abbrev-ref HEAD");
        // Forget the credential in the clone URL; Studio never pushes in phases 1–4.
        await must(sandbox, "project", "git remote remove origin");
        title = `Imported ${project.source.repo}`;
      }
      await must(
        sandbox,
        "project",
        `git config user.email studio@kiln.local && git config user.name 'Kiln Studio' && mkdir -p .git/info && printf '.kiln/\\n' >> .git/info/exclude`,
      );
      const setup = await this.detect(sandbox, project, mainBranch, template);
      if (template) await must(sandbox, "project", "git add -A && git commit -q -m " + shellQuote(title));
      else for (const cmd of setup.install) await must(sandbox, "project", cmd, env);
      const sha = await must(sandbox, "project", "git rev-parse HEAD");
      const p = this.project(project.id);
      p.setup = setup;
      p.status = "ready";
      this.touch(C.projects, p);
      this.addVersion(p, { sha, title, kind: "initial" });
      await this.snapshot(p.id);
    } catch (err) {
      const p = this.project(project.id);
      p.status = "failed";
      p.error = err instanceof Error ? err.message : String(err);
      this.touch(C.projects, p);
    }
  }

  private async detect(sandbox: Sandbox, project: Project, mainBranch: string, template?: Template): Promise<ProjectSetup> {
    const files = (await must(sandbox, "project", "ls -A")).split("\n");
    const detected = detectSetup({ files, packageJson: await sandbox.readFile("project/package.json") });
    const example = ENV_EXAMPLES.find((f) => files.includes(f));
    const envRequired = example ? envKeys((await sandbox.readFile(`project/${example}`)) ?? "") : [];
    const provided = this.env(project);
    const setup: ProjectSetup = {
      mainBranch,
      packageManager: detected.packageManager,
      install: template ? template.install : detected.install,
      ...(template ? { devDetected: template.dev } : detected.devDetected ? { devDetected: detected.devDetected } : {}),
      envRequired,
      envMissing: envRequired.filter((k) => !(k in provided)),
    };
    const dev = devCommand(setup);
    return dev ? { ...setup, dev } : setup;
  }

  // ---- chats and turns ----

  async newChat(
    projectId: string,
    input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string },
  ): Promise<{ chat: Chat; turn?: Turn }> {
    await this.ready(projectId);
    const p = this.readyProject(projectId);
    const { sandbox } = await this.ensureLive(p);
    const chatId = id("sc");
    const existing = this.getProject(projectId)!.chats.length;
    if (existing >= MAX_CHATS) throw new StudioError("invalid", `a project can have at most ${MAX_CHATS} chats`);
    const now = this.now();
    const chat: Chat = {
      id: chatId,
      projectId,
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
    await this.locked(projectId, () => must(sandbox, "project", `git worktree add -q -b ${chat.branch} ../${chat.path} ${shellQuote(p.setup!.mainBranch)}`));
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
    const busy = this.getProject(chat.projectId)!.chats.filter((c) => c.id !== chatId && this.running.has(c.id)).length;
    if (busy >= max) throw new StudioError("busy", `${max} chats are already working in this project`);
    const p = this.readyProject(chat.projectId);
    const mode = input.mode ?? chat.mode;
    const turn: Turn = {
      id: id("st"),
      projectId: p.id,
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
    this.opts.bus.publish("studio.turn_started", { projectId: p.id, chatId, turnId: turn.id, priority: "progress" });
    entry.done = this.runTurn(p, chatId, turn, entry, started, failed);
    await ready;
    return { turn: this.opts.store.get<Turn>(C.turns, turn.id)!, steered: false };
  }

  /** Resolves when the chat has no running turn, including a resolve turn Studio started itself. */
  async idle(chatId: string): Promise<void> {
    for (let r = this.running.get(chatId); r; r = this.running.get(chatId)) await r.done;
  }

  private async runTurn(p: Project, chatId: string, turn: Turn, entry: Running, started: () => void, failed: (err: unknown) => void) {
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
      for await (const e of entry.session.events) this.record(turn, e);
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
    const project = this.project(p.id);
    if (project.shipMode === "cowboy" && after.checkpoint && !this.running.has(chatId)) await this.autoApply(project, chatId, after);
    await this.snapshot(p.id).catch(() => {});
  }

  private record(turn: Turn, e: HarnessEvent) {
    const at = this.now();
    let a: Activity | undefined;
    if (e.type === "message") {
      a = { kind: "message", text: e.text, at };
      turn.reply = e.text;
    } else if (e.type === "reasoning") a = { kind: "reasoning", text: e.text, at };
    else if (e.type === "tool_call") {
      const input = (e.input ?? {}) as Record<string, unknown>;
      a = SUBAGENT_TOOLS.has(e.name)
        ? { kind: "subagent", name: e.name, text: String(input.description ?? input.prompt ?? ""), at }
        : { kind: "tool", name: e.name, ...(typeof input.file_path === "string" ? { text: input.file_path } : {}), at };
    } else if (e.type === "error") a = { kind: "error", text: e.text, at };
    else if (e.type === "cost") turn.costUsd += e.usd;
    if (a) turn.activity.push(a);
    this.save(C.turns, turn);
  }

  private async finishTurn(p: Project, chatId: string, turn: Turn, result: HarnessResult, startHead: string, live: Live) {
    const chat = this.chat(chatId);
    const sbx = live.sandbox;
    const meta = parseStudioFile(await sbx.readFile(`${chat.path}/${STUDIO_FILE}`));
    turn.reply ||= result.summary;
    turn.costUsd = Math.max(turn.costUsd, result.costUsd);
    const title = meta.title?.trim() ? oneLine(meta.title) : oneLine(turn.reply) || "Changes";
    turn.title = title;
    if (meta.summary) turn.summary = meta.summary;
    if (meta.question) turn.question = meta.question;
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
      projectId: p.id,
      chatId,
      turnId: turn.id,
      title,
      ...(turn.summary ? { summary: turn.summary } : {}),
      changed: Boolean(turn.checkpoint),
      priority: "finished",
    });
    if (needs)
      this.opts.bus.publish("studio.needs_you", {
        projectId: p.id,
        chatId,
        question: needs,
        reason: turn.question ? "question" : "failed",
        priority: "needs_you",
      });
  }

  private finishFailed(p: Project, chatId: string, turn: Turn, message: string) {
    turn.status = "failed";
    turn.reply ||= message;
    turn.activity.push({ kind: "error", text: message, at: this.now() });
    turn.finishedAt = this.now();
    this.save(C.turns, turn);
    const question = `The agent failed: ${oneLine(message, 200)}`;
    this.touch(C.chats, { ...this.chat(chatId), status: "needs_you", question });
    this.opts.bus.publish("studio.needs_you", { projectId: p.id, chatId, question, reason: "failed", priority: "needs_you" });
  }

  /** Cowboy mode: apply after every changed turn; on a conflict, the chat's agent resolves it once. */
  private async autoApply(p: Project, chatId: string, turn: Turn) {
    const r = await this.apply(chatId, "studio");
    if (r.ok || !("conflict" in r)) return;
    const main = p.setup!.mainBranch;
    if (turn.resolve) {
      const question = `Applying this chat conflicts in ${r.conflict.join(", ")}, and the agent couldn't resolve it.`;
      this.touch(C.chats, { ...this.chat(chatId), status: "needs_you", question });
      this.opts.bus.publish("studio.needs_you", { projectId: p.id, chatId, question, reason: "conflict", priority: "needs_you" });
      return;
    }
    const prompt = `Run \`git merge ${main}\` in this worktree: applying this chat to ${main} conflicts in ${r.conflict.join(", ")}. Resolve every conflict so both sides' changes still work, then commit the merge.`;
    await this.send(chatId, { by: "studio", via: "api", text: prompt, mode: "build" }, true);
  }

  // ---- versions ----

  async apply(chatId: string, by: string): Promise<ApplyResult> {
    const chat = this.chat(chatId);
    const p = this.readyProject(chat.projectId);
    return this.locked(p.id, async () => {
      const { sandbox } = await this.ensureLive(p);
      const main = shellQuote(p.setup!.mainBranch);
      const ahead = Number(await must(sandbox, "project", `git rev-list --count ${main}..${chat.branch}`));
      if (!ahead) return { ok: false, nothing: true } as const;
      const subjects = (await must(sandbox, "project", `git log --no-merges --reverse --format=%s ${main}..${chat.branch}`)).split("\n").filter(Boolean);
      const title = oneLine(subjects.join("; ") || chat.title);
      const merged = await sandbox.exec(`git merge --no-ff -q -m ${shellQuote(title)} ${chat.branch}`, { cwd: "project", trusted: true });
      if (merged.code !== 0) {
        const files = (await must(sandbox, "project", "git diff --name-only --diff-filter=U")).split("\n").filter(Boolean);
        await sandbox.exec("git merge --abort", { cwd: "project", trusted: true });
        this.touch(C.chats, { ...this.chat(chatId), status: "conflict", question: `Applying conflicts in ${files.join(", ")}` });
        return { ok: false, conflict: files } as const;
      }
      const sha = await must(sandbox, "project", "git rev-parse HEAD");
      const appliedSha = await must(sandbox, "project", `git rev-parse ${chat.branch}`);
      const current = this.chat(chatId);
      this.touch(C.chats, { ...current, appliedSha, ...(current.status === "conflict" ? { status: "idle" as const, question: undefined } : {}) });
      void by;
      return { ok: true, version: this.addVersion(p, { sha, title, kind: "apply", chatId }) } as const;
    });
  }

  async restore(versionId: string, by: string): Promise<Version> {
    const v = this.version(versionId);
    const p = this.readyProject(v.projectId);
    void by;
    return this.locked(p.id, async () => {
      const { sandbox } = await this.ensureLive(p);
      const title = oneLine(`Restore: ${v.title}`);
      await must(sandbox, "project", `git read-tree -u --reset ${v.sha} && git commit -q --allow-empty -m ${shellQuote(title)}`);
      const sha = await must(sandbox, "project", "git rev-parse HEAD");
      return this.addVersion(p, { sha, title, kind: "restore", restoredFrom: v.id });
    });
  }

  bookmark(versionId: string, on: boolean): Version {
    return this.save(C.versions, { ...this.version(versionId), bookmarked: on });
  }

  async diff(target: { chatId: string } | { versionId: string }): Promise<string> {
    if ("chatId" in target) {
      const chat = this.chat(target.chatId);
      const p = this.readyProject(chat.projectId);
      const { sandbox } = await this.ensureLive(p);
      return (await sandbox.exec(`git diff ${shellQuote(p.setup!.mainBranch)}...${chat.branch}`, { cwd: "project", trusted: true })).stdout;
    }
    const v = this.version(target.versionId);
    const { sandbox } = await this.ensureLive(this.readyProject(v.projectId));
    const parent = await sandbox.exec(`git rev-parse -q --verify ${v.sha}^1`, { cwd: "project", trusted: true });
    const cmd = parent.code === 0 ? `git diff ${v.sha}^1 ${v.sha}` : `git show --format= ${v.sha}`;
    return (await sandbox.exec(cmd, { cwd: "project", trusted: true })).stdout;
  }

  // ---- previews ----

  async preview(target: { chatId: string } | { versionId: string }): Promise<Preview> {
    if ("chatId" in target) {
      const chat = this.chat(target.chatId);
      const p = this.readyProject(chat.projectId);
      const live = await this.ensureLive(p);
      return this.serve(p, live, chat.id, chat.path, chat.port);
    }
    const v = this.version(target.versionId);
    const p = this.readyProject(v.projectId);
    const live = await this.ensureLive(p);
    await this.locked(p.id, async () => {
      const exists = (await live.sandbox.exec("test -e version", { trusted: true })).code === 0;
      if (exists) await must(live.sandbox, "version", `git checkout -q --detach ${v.sha}`);
      else {
        await must(live.sandbox, "project", `git worktree add -q --detach ../version ${v.sha}`);
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
      if (dev && live.sandbox.expose) return live.sandbox.expose(dev.port);
    }
    return undefined;
  }

  private async serve(p: Project, live: Live, key: string, cwd: string, port: number, target = key): Promise<Preview> {
    if (!live.sandbox.expose) throw new StudioError("unavailable", `the ${live.sandbox.provider} sandbox backend can't serve previews`);
    const dev = p.setup?.dev;
    if (!dev) throw new StudioError("invalid", "no dev command: set one in the project settings");
    let running = live.devs.get(key);
    const status = running ? "ready" : "starting";
    if (!running) {
      const cmd = dev.replaceAll("{port}", String(port));
      const proc = live.sandbox.spawn("sh", ["-c", cmd], { cwd, env: { ...this.env(p), PORT: String(port), HOST: "0.0.0.0" } });
      running = { proc, port };
      live.devs.set(key, running);
      void this.watchDev(live, key, running);
    }
    return { target, url: this.opts.previewUrl(target, await live.sandbox.expose(running.port)), status };
  }

  /** Follow a dev server's output: switch to the port it says it listens on, forget it when it exits. */
  private async watchDev(live: Live, key: string, dev: { proc: Proc; port: number }) {
    let seen = 0;
    try {
      for await (const line of dev.proc.lines) {
        const port = seen++ < 50 ? listenPort(line) : undefined;
        if (port && port !== dev.port) dev.port = port;
      }
    } catch {
      // the process went away
    }
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

  private spec(p: Project): SandboxSpec {
    const template = p.source.kind === "template" ? this.templates[p.source.template] : undefined;
    const backend = this.opts.sandboxes.name as SandboxSpec["runner"]["backend"];
    return {
      runner: { image: template?.image ?? this.opts.image ?? "node:22", backend, setupCommands: [], egress: template?.egress ?? ["registry.npmjs.org"] },
      repos: [],
      env: this.env(p),
      // The Helm chart's kiln-preview-ingress policy admits the API to ports 4100–4199 of pods with this label.
      labels: { "kiln.studio.project": p.id, "kiln.dev/preview": "true" },
    };
  }

  /** The project's sandbox, resumed from its latest snapshot when this process doesn't hold it. */
  private async ensureLive(p: Project): Promise<Live> {
    const held = this.live.get(p.id);
    if (held) return held;
    return this.locked(`live:${p.id}`, async () => {
      const again = this.live.get(p.id);
      if (again) return again;
      const current = this.project(p.id);
      if (!current.snapshot) throw new StudioError("unavailable", "the project's workspace is gone and has no snapshot");
      const sandbox = await this.opts.sandboxes.resume(current.snapshot, this.spec(current), this.opts.objects);
      // Worktrees record absolute paths; a resumed workspace may live elsewhere.
      await sandbox.exec('for d in ../chats/* ../version; do [ -e "$d" ] && git worktree repair "$d"; done; true', { cwd: "project", trusted: true });
      const live: Live = { sandbox, devs: new Map() };
      this.live.set(p.id, live);
      if (current.status === "paused") this.touch(C.projects, { ...current, status: "ready" });
      return live;
    });
  }

  private async snapshot(projectId: string) {
    const live = this.live.get(projectId);
    if (!live) return;
    const snapshot = await live.sandbox.snapshot(this.opts.objects);
    this.touch(C.projects, { ...this.project(projectId), snapshot });
  }

  private addVersion(p: Project, v: Pick<Version, "sha" | "title" | "kind" | "chatId" | "restoredFrom">): Version {
    const version: Version = {
      id: id("sv"),
      projectId: p.id,
      sha: v.sha,
      title: v.title,
      kind: v.kind,
      ...(v.chatId ? { chatId: v.chatId } : {}),
      ...(v.restoredFrom ? { restoredFrom: v.restoredFrom } : {}),
      bookmarked: false,
      createdAt: this.now(),
    };
    this.save(C.versions, version);
    this.opts.bus.publish("studio.version_created", { projectId: p.id, versionId: version.id, title: version.title, kind: version.kind, priority: "finished" });
    return version;
  }

  private versions(projectId: string): Version[] {
    return this.opts.store.list<Version>(C.versions, (v) => v.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private env(p: Project): Record<string, string> {
    return this.opts.env?.(p) ?? {};
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

  private project(projectId: string): Project {
    const p = this.opts.store.get<Project>(C.projects, projectId);
    if (!p) throw new StudioError("not_found", `unknown project ${projectId}`);
    return p;
  }

  private readyProject(projectId: string): Project {
    const p = this.project(projectId);
    if (p.status === "creating") throw new StudioError("unavailable", "the project is still being created");
    if (p.status === "failed" || !p.setup) throw new StudioError("unavailable", `the project failed to start: ${p.error ?? "unknown error"}`);
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
