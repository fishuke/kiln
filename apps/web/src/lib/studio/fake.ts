import { StudioClientError, type StudioClient } from "./client";
import { defaultShipMode } from "./model";
import type {
  Activity,
  ApplyResult,
  Chat,
  ChatDetail,
  ChatMode,
  CreateAppInput,
  AppDetail,
  AppPullRequest,
  MergeReview,
  ForgeRepository,
  NewChatInput,
  NewChatResult,
  Preview,
  ShipMode,
  StudioApp,
  SendResult,
  StatusReport,
  Turn,
  UpdateAppInput,
  Version,
} from "./types";

export type FakeOptions = {
  now?: () => Date;
  /** Runs `fn` after `ms`; tests pass a manual scheduler. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Milliseconds between simulated agent steps. */
  stepMs?: number;
  /** Base URL of the fake preview route. */
  previewBase?: string;
};

export type FakeScenario = "empty" | "demo" | "none";

const ME = "you@example.com";

/**
 * An in-memory Studio that behaves like the contract: turns stream activity, a build turn that
 * changes files checkpoints, cowboy mode applies, a question makes nothing, plan mode returns a plan.
 */
export class FakeStudioClient implements StudioClient {
  readonly kind = "fake" as const;
  private appsById = new Map<string, StudioApp>();
  private chats = new Map<string, Chat>();
  private turns = new Map<string, Turn>();
  private versions = new Map<string, Version>();
  private pullRequests = new Map<string, AppPullRequest>();
  /** Chat id → checkpoints not yet applied, oldest first. */
  private unapplied = new Map<string, { sha: string; title: string }[]>();
  private started = new Map<string, number>();
  private listeners = new Set<() => void>();
  private seq = 0;
  private readonly now: () => Date;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly stepMs: number;
  private readonly previewBase: string;

  constructor(opts: FakeOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.stepMs = opts.stepMs ?? 700;
    this.previewBase = opts.previewBase ?? "/api/studio/fake-preview";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36).padStart(6, "0")}${Math.random().toString(36).slice(2, 8)}`;
  }

  private iso(offsetMs = 0) {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }

  private sha() {
    return Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  }

  private must<T>(v: T | undefined, what: string): T {
    if (!v) throw new StudioClientError(`${what} not found`, 404);
    return v;
  }

  async apps() {
    return [...this.appsById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createApp(input: CreateAppInput): Promise<StudioApp> {
    const source = input.source ?? { kind: "template" as const, template: "nextjs" };
    const app: StudioApp = {
      id: this.id("sa"),
      team: "team",
      name: input.name,
      source,
      shipMode: defaultShipMode(source),
      harness: input.harness ?? "claude-code",
      model: input.model ?? "claude-opus-5-5",
      status: "creating",
      ...(input.prompt ? { firstPrompt: { text: input.prompt, via: "web" } } : {}),
      createdBy: ME,
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    this.appsById.set(app.id, app);
    if (source.kind === "repo") {
      // Clone, then detect the package manager, dev command and env; then install.
      this.schedule(() => {
        const envRequired = ["DATABASE_URL", "NEXTAUTH_SECRET"];
        this.patchApp(app.id, {
          setup: {
            mainBranch: source.branch ?? "main",
            packageManager: "pnpm",
            install: ["pnpm install --prefer-offline"],
            dev: "pnpm run dev",
            devDetected: "pnpm run dev",
            envRequired,
            envMissing: envRequired,
          },
        });
        this.schedule(() => this.ready(app.id, `Imported ${source.repo}`), this.stepMs * 2);
      }, this.stepMs * 2);
    } else {
      this.schedule(() => this.ready(app.id, "Started from the Next.js template"), this.stepMs * 2);
    }
    this.emit();
    return app;
  }

  /** Setup is done: the initial version, then the first chat with the prompt the App was created with. */
  private ready(id: string, title: string) {
    const p = this.appsById.get(id);
    if (!p) return;
    const { firstPrompt, ...rest } = p;
    this.appsById.set(id, rest);
    this.patchApp(id, { status: "ready" });
    this.addVersion(id, { title, kind: "initial" });
    if (firstPrompt) void this.newChat(id, { prompt: firstPrompt.text });
  }

  private patchApp(id: string, patch: Partial<StudioApp>) {
    const p = this.appsById.get(id);
    if (!p) return;
    this.appsById.set(id, { ...p, ...patch, updatedAt: this.iso() });
    this.emit();
  }

  async app(id: string): Promise<AppDetail> {
    const app = this.must(this.appsById.get(id), "App");
    const chats = [...this.chats.values()].filter((c) => c.appId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const versions = [...this.versions.values()].filter((v) => v.appId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { app, chats, versions, pullRequest: this.pullRequests.get(id) };
  }

  async setShipMode(id: string, mode: ShipMode): Promise<StudioApp> {
    this.must(this.appsById.get(id), "App");
    this.patchApp(id, { shipMode: mode });
    return this.appsById.get(id)!;
  }

  async updateApp(id: string, patch: UpdateAppInput): Promise<StudioApp> {
    const p = this.must(this.appsById.get(id), "App");
    const next: Partial<StudioApp> = {};
    if (patch.name) next.name = patch.name;
    if (p.setup && patch.devCommand !== undefined) {
      const devOverride = patch.devCommand ?? undefined;
      next.setup = { ...p.setup, devOverride, dev: devOverride ?? p.setup.devDetected };
    }
    this.patchApp(id, next);
    return this.appsById.get(id)!;
  }

  async retryApp(id: string): Promise<StudioApp> {
    const p = this.failed(id, "retried");
    for (const v of [...this.versions.values()]) if (v.appId === id) this.versions.delete(v.id);
    this.appsById.set(id, { ...p, status: "creating", error: undefined, setup: undefined, updatedAt: this.iso() });
    this.schedule(() => {
      this.patchApp(id, { status: "ready" });
      this.addVersion(id, { title: "Started from the Next.js template", kind: "initial" });
    }, this.stepMs * 2);
    this.emit();
    return this.appsById.get(id)!;
  }

  async deleteApp(id: string): Promise<void> {
    this.failed(id, "deleted");
    for (const c of [...this.chats.values()]) if (c.appId === id) this.chats.delete(c.id);
    for (const v of [...this.versions.values()]) if (v.appId === id) this.versions.delete(v.id);
    this.appsById.delete(id);
    this.emit();
  }

  private failed(id: string, action: string): StudioApp {
    const p = this.must(this.appsById.get(id), "App");
    if (p.status !== "failed") throw new StudioClientError(`only a failed app can be ${action}; this one is ${p.status}`, 400);
    return p;
  }

  async newChat(appId: string, input: NewChatInput): Promise<NewChatResult> {
    this.must(this.appsById.get(appId), "App");
    const n = [...this.chats.values()].filter((c) => c.appId === appId).length;
    const id = this.id("sc");
    const chat: Chat = {
      id,
      appId,
      title: input.title ?? (input.prompt ? titleFrom(input.prompt) : `Chat ${n + 1}`),
      mode: input.mode ?? "build",
      harness: input.harness ?? "claude-code",
      model: input.model ?? this.appsById.get(appId)?.model,
      branch: `chat/${id}`,
      path: `chats/${id}`,
      port: 4101 + n,
      status: "idle",
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    this.chats.set(id, chat);
    this.emit();
    if (!input.prompt) return { chat };
    const { turn } = await this.send(id, { text: input.prompt, mode: input.mode });
    return { chat: this.chats.get(id)!, turn };
  }

  async chat(id: string): Promise<ChatDetail> {
    const chat = this.must(this.chats.get(id), "Chat");
    const turns = [...this.turns.values()].filter((t) => t.chatId === id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return { chat, turns };
  }

  async deleteChat(id: string): Promise<void> {
    const chat = this.must(this.chats.get(id), "Chat");
    if (chat.status === "working") throw new StudioClientError("the chat is working; stop it first", 400);
    for (const t of [...this.turns.values()]) if (t.chatId === id) this.turns.delete(t.id);
    this.chats.delete(id);
    this.emit();
  }

  private patchChat(id: string, patch: Partial<Chat>) {
    const c = this.chats.get(id);
    if (c) this.chats.set(id, { ...c, ...patch, updatedAt: this.iso() });
  }

  private patchTurn(id: string, patch: Partial<Turn>) {
    const t = this.turns.get(id);
    if (t) this.turns.set(id, { ...t, ...patch });
  }

  async send(chatId: string, input: { text: string; mode?: ChatMode }): Promise<SendResult> {
    const chat = this.must(this.chats.get(chatId), "Chat");
    const running = [...this.turns.values()].find((t) => t.chatId === chatId && t.status === "running");
    if (running) {
      this.patchTurn(running.id, { activity: [...running.activity, { kind: "message", text: `Got it, also: ${input.text}`, at: this.iso() }] });
      this.emit();
      return { turn: this.turns.get(running.id)!, steered: true };
    }
    const mode = input.mode ?? chat.mode;
    const turn: Turn = {
      id: this.id("st"),
      appId: chat.appId,
      chatId,
      prompt: input.text,
      mode,
      via: "web",
      by: ME,
      status: "running",
      reply: "",
      discarded: false,
      activity: [],
      costUsd: 0,
      startedAt: this.iso(),
      runId: this.id("run"),
    };
    this.turns.set(turn.id, turn);
    this.patchChat(chatId, { status: "working", mode, question: undefined, runId: turn.runId });
    this.emit();
    this.play(turn.id, script(input.text, mode), 0);
    return { turn, steered: false };
  }

  private play(turnId: string, steps: Activity[], i: number) {
    this.schedule(() => {
      const t = this.turns.get(turnId);
      if (!t || t.status !== "running") return;
      if (i < steps.length) {
        this.patchTurn(turnId, { activity: [...t.activity, { ...steps[i]!, at: this.iso() }], costUsd: t.costUsd + 0.012 });
        this.emit();
        this.play(turnId, steps, i + 1);
      } else this.finish(turnId);
    }, this.stepMs);
  }

  private finish(turnId: string) {
    const t = this.turns.get(turnId)!;
    const outcome = outcomeFor(t.prompt, t.mode);
    const finished: Partial<Turn> = {
      status: "succeeded",
      finishedAt: this.iso(),
      reply: outcome.reply,
      title: outcome.title,
      summary: outcome.reply.split(". ")[0],
    };
    if (outcome.question) finished.question = outcome.question;
    if (t.mode === "plan") finished.plan = outcome.plan;
    if (outcome.changes && t.mode === "build") finished.checkpoint = this.sha();
    if (outcome.changes && t.mode !== "build") finished.discarded = true;
    this.patchTurn(turnId, finished);
    const project = this.appsById.get(t.appId)!;
    if (finished.checkpoint) {
      const list = this.unapplied.get(t.chatId) ?? [];
      this.unapplied.set(t.chatId, [...list, { sha: finished.checkpoint, title: outcome.title }]);
    }
    this.patchChat(t.chatId, outcome.question ? { status: "needs_you", question: outcome.question } : { status: "idle" });
    if (finished.checkpoint && project.shipMode === "cowboy") void this.apply(t.chatId);
    this.emit();
  }

  async apply(chatId: string): Promise<ApplyResult> {
    const chat = this.must(this.chats.get(chatId), "Chat");
    const list = this.unapplied.get(chatId) ?? [];
    if (!list.length) return { ok: false, nothing: true };
    const title = list
      .map((c) => c.title)
      .join("; ")
      .slice(0, 80);
    const version = this.addVersion(chat.appId, { title, kind: "apply", chatId });
    this.unapplied.set(chatId, []);
    this.patchChat(chatId, { appliedSha: list[list.length - 1]!.sha });
    this.emit();
    return { ok: true, version };
  }

  private addVersion(appId: string, v: Pick<Version, "title" | "kind"> & Partial<Version>): Version {
    const version: Version = { id: this.id("sv"), appId, sha: this.sha(), bookmarked: false, createdAt: this.iso(), ...v };
    this.versions.set(version.id, version);
    this.patchApp(appId, {});
    return version;
  }

  async chatDiff(chatId: string) {
    const chat = this.must(this.chats.get(chatId), "Chat");
    const titles = (this.unapplied.get(chatId) ?? []).map((c) => c.title);
    const turns = [...this.turns.values()].filter((t) => t.chatId === chatId && t.checkpoint).map((t) => t.title ?? "");
    return { diff: fakeDiff(this.appsById.get(chat.appId)?.name ?? "", (titles.length ? titles : turns.slice(-1)).join(" ")) };
  }

  async versionDiff(versionId: string) {
    const v = this.must(this.versions.get(versionId), "Version");
    return { diff: fakeDiff(this.appsById.get(v.appId)?.name ?? "", v.title) };
  }

  /** The fake preview page for an App at version `n`; it renders content that matches the App. */
  private previewUrl(target: string, appId: string, n: number): string {
    const app = this.appsById.get(appId);
    const kind = app?.source.kind === "repo" ? "&kind=store" : "";
    return `${this.previewBase}/${target}?app=${encodeURIComponent(app?.name ?? "App")}&n=${n}${kind}`;
  }

  private preview(target: string, appId: string, n: number): Preview {
    const first = this.started.get(target);
    if (first === undefined) this.started.set(target, this.now().getTime());
    const ready = first !== undefined && this.now().getTime() - first > this.stepMs;
    if (!ready) this.schedule(() => this.emit(), this.stepMs + 50);
    return { target, url: this.previewUrl(target, appId, n), status: ready ? "ready" : "starting" };
  }

  async chatPreview(chatId: string): Promise<Preview> {
    const chat = this.must(this.chats.get(chatId), "Chat");
    const versions = [...this.versions.values()].filter((v) => v.appId === chat.appId).length;
    return this.preview(chatId, chat.appId, versions + (this.unapplied.get(chatId)?.length ?? 0));
  }

  async versionPreview(versionId: string): Promise<Preview> {
    const v = this.must(this.versions.get(versionId), "Version");
    const n = [...this.versions.values()].filter((x) => x.appId === v.appId && x.createdAt <= v.createdAt).length;
    return this.preview(versionId, v.appId, n);
  }

  async restore(versionId: string): Promise<Version> {
    const v = this.must(this.versions.get(versionId), "Version");
    const restored = this.addVersion(v.appId, { title: `Restore: ${v.title}`, kind: "restore", restoredFrom: v.id });
    this.emit();
    return restored;
  }

  async bookmark(versionId: string, on: boolean): Promise<Version> {
    const v = this.must(this.versions.get(versionId), "Version");
    const next = { ...v, bookmarked: on };
    this.versions.set(versionId, next);
    this.emit();
    return next;
  }

  async status(): Promise<StatusReport> {
    return {
      apps: [...this.appsById.values()].map((p) => {
        const chats = [...this.chats.values()].filter((c) => c.appId === p.id);
        const latest = [...this.versions.values()].filter((v) => v.appId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return {
          id: p.id,
          name: p.name,
          working: chats.filter((c) => c.status === "working").map((c) => c.id),
          needsYou: chats
            .filter((c) => (c.status === "needs_you" || c.status === "conflict") && c.question)
            .map((c) => ({ chatId: c.id, question: c.question! })),
          latest: latest ? { title: latest.title, at: latest.createdAt } : undefined,
        };
      }),
    };
  }

  async ship(appId: string, input: { title?: string; state?: "uat" | "ready_for_review" | "cancelled" }): Promise<AppPullRequest> {
    const app = this.must(this.appsById.get(appId), "App");
    const open = this.pullRequests.get(appId);
    const live = open && open.state !== "merged" && open.state !== "cancelled" ? open : undefined;
    const latest = [...this.versions.values()].filter((v) => v.appId === appId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (input.state === "ready_for_review" || input.state === "cancelled") {
      if (!live) throw new StudioClientError("This App has no open pull request", 409);
      const next = { ...live, state: input.state, updatedAt: this.iso() };
      this.pullRequests.set(appId, next);
      if (input.state === "ready_for_review")
        this.schedule(() => {
          // The merge gate: an imported repository goes to review, a template App merges.
          const decided: AppPullRequest =
            app.source.kind === "repo"
              ? {
                  ...next,
                  state: "waiting_for_review",
                  reasons: ["Changes authentication code in app/api/auth", "Adds a dependency: stripe"],
                  updatedAt: this.iso(),
                }
              : { ...next, state: "merged", updatedAt: this.iso() };
          this.pullRequests.set(appId, decided);
          this.emit();
        }, this.stepMs * 2);
      this.emit();
      return next;
    }
    const repo = app.source.kind === "repo" ? app.source.repo : `acme/${app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const number = live?.number ?? 40 + this.pullRequests.size + 2;
    const pr: AppPullRequest = {
      id: live?.id ?? this.id("pr"),
      appId,
      forge: "github",
      repo,
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      branch: `studio/${appId}`,
      base: app.setup?.mainBranch ?? "main",
      state: "uat",
      versionId: latest?.id ?? "",
      builtInPreview: latest ? this.previewUrl(latest.id, appId, [...this.versions.values()].filter((v) => v.appId === appId).length) : undefined,
      previewUrl: `https://studio-${appId.replace(/_/g, "-")}.vercel.app`,
      createdBy: ME,
      createdAt: live?.createdAt ?? this.iso(),
      updatedAt: this.iso(),
    };
    this.pullRequests.set(appId, pr);
    this.emit();
    return pr;
  }

  async mergeReviews(state?: MergeReview["state"]): Promise<MergeReview[]> {
    const reviews = [...this.pullRequests.values()]
      .filter((p) => p.state === "waiting_for_review" || p.state === "merged")
      .map((p): MergeReview => ({
        id: `mrv_${p.id}`,
        scope: { kind: "app", appId: p.appId, team: "team" },
        repo: p.repo,
        number: p.number,
        url: p.url,
        title: this.versions.get(p.versionId)?.title ?? "Changes",
        author: p.createdBy,
        by: p.createdBy,
        state: p.state === "merged" ? "merged" : "needs_review",
        reasons: p.reasons ?? [],
        decision: { action: p.state === "merged" ? "merge" : "review" },
        mergedBy: p.state === "merged" ? "kiln-merge-gate" : undefined,
        previewUrl: p.previewUrl,
        link: `/studio/${p.appId}`,
        pullRequestId: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
    return state ? reviews.filter((r) => r.state === state) : reviews;
  }

  async interrupt(runId: string): Promise<void> {
    const chat = [...this.chats.values()].find((c) => c.runId === runId);
    if (!chat) throw new StudioClientError("Run not found", 404);
    const running = [...this.turns.values()].find((t) => t.chatId === chat.id && t.status === "running");
    if (running) this.patchTurn(running.id, { status: "cancelled", finishedAt: this.iso() });
    this.patchChat(chat.id, { status: "idle" });
    this.emit();
  }

  async repositories(): Promise<ForgeRepository[]> {
    return [
      { owner: "acme", name: "storefront", forge: "github" },
      { owner: "acme", name: "marketing-site", forge: "github" },
      { owner: "acme", name: "dashboard", forge: "github" },
    ];
  }

  /** Fills the fake with an app so the page has something to show. Returns the app id. */
  seed(scenario: FakeScenario): string | undefined {
    if (scenario === "none") return undefined;
    const now = this.now().getTime();
    const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    const project: StudioApp = {
      id: "sa_demo",
      team: "team",
      name: scenario === "empty" ? "Recipe box" : "Habit tracker",
      source: { kind: "template", template: "nextjs" },
      shipMode: "cowboy",
      harness: "claude-code",
      model: "claude-opus-5-5",
      status: "ready",
      createdBy: ME,
      createdAt: at(180),
      updatedAt: at(3),
    };
    this.appsById.set(project.id, project);
    this.versions.set("sv_initial", {
      id: "sv_initial",
      appId: project.id,
      sha: this.sha(),
      title: "Started from the Next.js template",
      kind: "initial",
      bookmarked: false,
      createdAt: at(180),
    });
    this.appsById.set("sa_portfolio", {
      ...project,
      id: "sa_portfolio",
      name: "Portfolio site",
      shipMode: "safe",
      createdAt: at(4000),
      updatedAt: at(2900),
    });
    if (scenario === "empty") return project.id;

    const chat = (id: string, title: string, minAgo: number, port: number): Chat => ({
      id,
      appId: project.id,
      title,
      mode: "build",
      harness: "claude-code",
      branch: `chat/${id}`,
      path: `chats/${id}`,
      port,
      status: "idle",
      createdAt: at(minAgo),
      updatedAt: at(minAgo),
    });
    this.chats.set("sc_main", { ...chat("sc_main", "Daily habits with streaks", 170, 4101), runId: "run_main" });
    this.chats.set("sc_pricing", { ...chat("sc_pricing", "Pricing page", 40, 4102), runId: "run_pricing" });
    this.chats.set("sc_a11y", {
      ...chat("sc_a11y", "Contrast check", 18, 4103),
      runId: "run_a11y",
      status: "needs_you",
      question: "Darken the badge, or lighten its text?",
    });
    const turn = (id: string, chatId: string, minAgo: number, prompt: string, mode: ChatMode = "build"): Turn => {
      const o = outcomeFor(prompt, mode);
      return {
        id,
        appId: project.id,
        chatId,
        prompt,
        mode,
        via: "web",
        by: ME,
        status: "succeeded",
        reply: o.reply,
        title: o.title,
        summary: o.reply,
        question: o.question,
        plan: mode === "plan" ? o.plan : undefined,
        checkpoint: o.changes && mode === "build" ? this.sha() : undefined,
        discarded: false,
        activity: script(prompt, mode).map((a, i) => ({ ...a, at: at(minAgo - i * 0.1) })),
        costUsd: 0.08,
        startedAt: at(minAgo),
        finishedAt: at(minAgo - 1),
      };
    };
    const turns = [
      turn("st_1", "sc_main", 170, "Daily habits I can tick off, with a streak counter for each"),
      turn("st_2", "sc_main", 120, "Make the streak a flame badge and add a weekly heatmap"),
      turn("st_3", "sc_main", 60, "Does the heatmap work on mobile?"),
      turn("st_4", "sc_main", 20, "Add a dark mode toggle in the header"),
      turn("st_5", "sc_pricing", 40, "Plan a pricing page with three tiers", "plan"),
    ];
    for (const t of turns) this.turns.set(t.id, t);
    const v = (id: string, t: Turn, bookmarked = false): Version => ({
      id,
      appId: project.id,
      sha: this.sha(),
      title: t.title!,
      kind: "apply",
      chatId: t.chatId,
      bookmarked,
      createdAt: t.finishedAt!,
    });
    for (const x of [v("sv_1", turns[0]!), v("sv_2", turns[1]!, true), v("sv_4", turns[3]!)]) this.versions.set(x.id, x);
    this.patchChat("sc_main", { appliedSha: turns[3]!.checkpoint });
    this.turns.set("st_7", turn("st_7", "sc_a11y", 18, "Check colour contrast in dark mode, ask me before changing colours"));
    return project.id;
  }
}

/** A short title from a prompt: its first clause, capitalised, without the polite opener. */
export function titleFrom(prompt: string): string {
  const clause = prompt
    .replace(/^(please|can you|could you|i want|i'd like)\s+/i, "")
    .split(/[.:,;!?\n]/)[0]!
    .trim();
  const list = clause.split(/\s+/).slice(0, 12);
  while (list.length > 1 && /^(a|an|the|and|with|in|to|of|for)$/i.test(list[list.length - 1]!)) list.pop();
  const words = list.join(" ");
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Untitled";
}

type Outcome = { title: string; reply: string; changes: boolean; question?: string; plan?: string };

/** What the fake agent says it did, by what was asked. */
const REPLIES: [RegExp, string][] = [
  [
    /flame|heatmap/i,
    "The streak count is now a badge on each habit, and a two-week heatmap sits under the list in `components/heatmap.tsx`. Darker cells are days with more habits done.",
  ],
  [
    /habit|streak/i,
    "Built the habit list in `app/page.tsx` with a `HabitCard` per habit. Ticking one saves to localStorage and adds a day to its streak; a missed day resets it.",
  ],
  [/dark mode|theme/i, "Added a `ThemeToggle` to the header. It follows the system theme until you pick one, then remembers your choice."],
  [
    /search|filter|tag/i,
    "Added a search field above the recipes that matches titles and ingredients as you type, plus tag chips (Quick, Vegetarian, Dessert, Batch cook) that combine.",
  ],
  [/pricing/i, "Added `/pricing` with three `PriceCard`s and a monthly/yearly switch. The middle tier is highlighted and the header links to it."],
  [/footer/i, "Added a footer with links to Today, History and Settings."],
  [/test/i, "Added three tests in `components/theme-toggle.test.tsx` for the default, toggling and the saved choice. All pass."],
];

const QUESTIONS: [RegExp, { reply: string; question: string }][] = [
  [
    /contrast|colou?r/i,
    { reply: "The streak badge is 2.8:1 against the dark card, below the 4.5:1 it needs.", question: "Darken the badge, or lighten its text?" },
  ],
];

function outcomeFor(prompt: string, mode: ChatMode): Outcome {
  const title = titleFrom(prompt);
  if (mode === "plan")
    return {
      title: `Plan: ${title}`,
      changes: false,
      reply: "This touches the header, a new route and one new component.",
      plan: "1. Add a `/pricing` route with a three-column layout.\n2. Make a `PriceCard` component: name, price, features, call to action.\n3. Highlight the middle tier and add a monthly/yearly switch.\n4. Link it from the header and the footer.",
    };
  if (/\bask me\b|\bnot sure\b/i.test(prompt)) {
    const q = QUESTIONS.find(([re]) => re.test(prompt))?.[1] ?? {
      reply: "There are two reasonable defaults here.",
      question: "Should the toggle follow the system theme, or start in light mode?",
    };
    return { title, changes: false, ...q };
  }
  if (/\?\s*$/.test(prompt) || mode === "chat")
    return {
      title,
      changes: mode === "chat" && /\b(add|make|change|fix)\b/i.test(prompt),
      reply: /heatmap|mobile/i.test(prompt)
        ? "Yes. The heatmap wraps to seven columns under 640px and each cell keeps a 32px tap target. It fits at 390px wide."
        : "The page renders on the server and hydrates the habit list; nothing else needs to change for that.",
    };
  return {
    title,
    changes: true,
    reply: REPLIES.find(([re]) => re.test(prompt))?.[1] ?? "Made the change in `app/page.tsx` and kept the existing components. The type check passes.",
  };
}

function script(prompt: string, mode: ChatMode): Activity[] {
  const at = "";
  const steps: Activity[] = [
    { kind: "reasoning", text: "Start from the page and the components it uses, then change the smallest set of files.", at },
    { kind: "tool", name: "Read", text: "app/page.tsx", at },
  ];
  if (mode === "build" && !/\?\s*$/.test(prompt)) {
    steps.push(
      { kind: "subagent", name: "Explore", text: "Found 4 components under components/ and the theme in app/globals.css", at },
      { kind: "tool", name: "Edit", text: "app/page.tsx", at },
      {
        kind: "tool",
        name: "Write",
        text: /search|filter|tag|recipe/i.test(prompt)
          ? "components/recipe-search.tsx"
          : /dark|theme/i.test(prompt)
            ? "components/theme-toggle.tsx"
            : "components/habit-card.tsx",
        at,
      },
      { kind: "tool", name: "Bash", text: "pnpm tsc --noEmit", at },
    );
  }
  steps.push({ kind: "message", text: mode === "plan" ? "Writing the plan." : "Wrapping up.", at });
  return steps;
}

/** A plausible diff for what was asked in this App. */
function fakeDiff(app: string, asked: string): string {
  if (/recipe/i.test(app) || /search|filter|tag/i.test(asked)) return RECIPE_SEARCH_DIFF;
  return THEME_TOGGLE_DIFF;
}

const RECIPE_SEARCH_DIFF = [
  "diff --git a/app/page.tsx b/app/page.tsx",
  "--- a/app/page.tsx",
  "+++ b/app/page.tsx",
  "@@ -1,9 +1,13 @@",
  ' import { RecipeGrid } from "@/components/recipe-grid";',
  '+import { RecipeSearch } from "@/components/recipe-search";',
  ' import { recipes } from "@/lib/recipes";',
  " ",
  " export default function Home() {",
  "   return (",
  '     <main className="mx-auto max-w-3xl p-6">',
  '       <h1 className="text-2xl font-semibold">Recipes</h1>',
  "-      <RecipeGrid recipes={recipes} />",
  "+      <RecipeSearch recipes={recipes}>",
  "+        {(found) => <RecipeGrid recipes={found} />}",
  "+      </RecipeSearch>",
  "     </main>",
  "   );",
  "diff --git a/components/recipe-search.tsx b/components/recipe-search.tsx",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/components/recipe-search.tsx",
  "@@ -0,0 +1,14 @@",
  '+"use client";',
  '+import { useState } from "react";',
  '+import type { Recipe } from "@/lib/recipes";',
  "+",
  '+const TAGS = ["Quick", "Vegetarian", "Dessert", "Batch cook"];',
  "+",
  "+export function RecipeSearch({ recipes, children }: { recipes: Recipe[]; children: (found: Recipe[]) => React.ReactNode }) {",
  '+  const [query, setQuery] = useState("");',
  "+  const [tags, setTags] = useState<string[]>([]);",
  "+  const q = query.toLowerCase();",
  '+  const found = recipes.filter((r) => (r.title + r.ingredients.join(" ")).toLowerCase().includes(q) && tags.every((t) => r.tags.includes(t)));',
  "+  return <>{/* search field and TAGS chips */}{children(found)}</>;",
  "+}",
  "+",
  "diff --git a/lib/recipes.ts b/lib/recipes.ts",
  "--- a/lib/recipes.ts",
  "+++ b/lib/recipes.ts",
  "@@ -1,3 +1,4 @@",
  " export type Recipe = {",
  "   title: string;",
  "   ingredients: string[];",
  "+  tags: string[];",
].join("\n");

const THEME_TOGGLE_DIFF = [
  "diff --git a/app/page.tsx b/app/page.tsx",
  "--- a/app/page.tsx",
  "+++ b/app/page.tsx",
  "@@ -1,8 +1,12 @@",
  ' import { HabitList } from "@/components/habit-list";',
  '+import { ThemeToggle } from "@/components/theme-toggle";',
  " ",
  " export default function Home() {",
  "   return (",
  '     <main className="mx-auto max-w-2xl p-6">',
  '-      <h1 className="text-2xl font-semibold">Habits</h1>',
  '+      <header className="flex items-center justify-between">',
  `+        <h1 className="text-2xl font-semibold">Habits</h1>`,
  "+        <ThemeToggle />",
  "+      </header>",
  "       <HabitList />",
  "     </main>",
  "   );",
  "diff --git a/components/theme-toggle.tsx b/components/theme-toggle.tsx",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/components/theme-toggle.tsx",
  "@@ -0,0 +1,9 @@",
  '+"use client";',
  '+import { Moon, Sun } from "lucide-react";',
  "+",
  "+export function ThemeToggle() {",
  '+  const toggle = () => document.documentElement.classList.toggle("dark");',
  '+  return <button onClick={toggle} aria-label="Toggle theme"><Sun /><Moon /></button>;',
  "+}",
  "+",
  "diff --git a/components/habit-card.tsx b/components/habit-card.tsx",
  "--- a/components/habit-card.tsx",
  "+++ b/components/habit-card.tsx",
  "@@ -12,3 +12,3 @@ export function HabitCard({ habit }: Props) {",
  "   return (",
  '-    <div className="rounded border p-4">',
  '+    <div className="rounded-xl border bg-card p-4 shadow-sm">',
  "       {habit.name}",
].join("\n");
