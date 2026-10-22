import { StudioClientError, type StudioClient } from "./client";
import type {
  Activity,
  ApplyResult,
  Chat,
  ChatDetail,
  ChatMode,
  CreateProjectInput,
  ForgeRepository,
  NewChatInput,
  NewChatResult,
  Preview,
  Project,
  ProjectDetail,
  SendResult,
  StatusReport,
  Turn,
  UpdateProjectInput,
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
  private projectsById = new Map<string, Project>();
  private chats = new Map<string, Chat>();
  private turns = new Map<string, Turn>();
  private versions = new Map<string, Version>();
  /** Chat id → checkpoints not yet applied, oldest first. */
  private unapplied = new Map<string, { sha: string; title: string }[]>();
  private started = new Map<string, number>();
  private env = new Map<string, Record<string, string>>();
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

  async projects() {
    return { projects: [...this.projectsById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const source = input.source ?? { kind: "template" as const, template: input.template ?? "nextjs" };
    const p: Project = {
      id: this.id("sp"),
      team: "team",
      name: input.name,
      template: source.kind === "template" ? source.template : "imported",
      source,
      shipMode: input.shipMode ?? "cowboy",
      harness: input.harness ?? "claude-code",
      model: input.model,
      status: "creating",
      createdBy: ME,
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    if (source.kind === "repo") {
      p.setup = {
        steps: [
          { id: "clone", status: "running" },
          { id: "install", status: "pending" },
          { id: "dev", status: "pending" },
          { id: "preview", status: "pending" },
        ],
        missingEnv: [],
      };
      this.runSetup(p.id, 0);
    } else {
      this.schedule(() => {
        this.patchProject(p.id, { status: "ready" });
        this.addVersion(p.id, { title: "Started from the Next.js template", kind: "initial" });
      }, this.stepMs * 2);
    }
    this.projectsById.set(p.id, p);
    this.emit();
    return p;
  }

  private runSetup(projectId: string, step: number) {
    this.schedule(() => {
      const p = this.projectsById.get(projectId);
      if (!p?.setup) return;
      const steps = p.setup.steps.map((s, i) =>
        i === step ? { ...s, status: "done" as const, detail: SETUP_DETAIL[s.id] } : i === step + 1 ? { ...s, status: "running" as const } : s,
      );
      const setup = { ...p.setup, steps };
      if (step === 0) Object.assign(setup, { packageManager: "pnpm", devCommand: "pnpm dev" });
      if (step === 1) setup.missingEnv = ["DATABASE_URL", "NEXTAUTH_SECRET"];
      const done = step === steps.length - 1;
      this.patchProject(projectId, { setup, ...(done ? { status: "ready" as const } : {}) });
      if (done) this.addVersion(projectId, { title: `Imported ${p.source?.kind === "repo" ? p.source.repo : p.name}`, kind: "initial" });
      else this.runSetup(projectId, step + 1);
    }, this.stepMs * 1.5);
  }

  private patchProject(id: string, patch: Partial<Project>) {
    const p = this.projectsById.get(id);
    if (!p) return;
    this.projectsById.set(id, { ...p, ...patch, updatedAt: this.iso() });
    this.emit();
  }

  async project(id: string): Promise<ProjectDetail> {
    const project = this.must(this.projectsById.get(id), "Project");
    const chats = [...this.chats.values()].filter((c) => c.projectId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const versions = [...this.versions.values()].filter((v) => v.projectId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { project, chats, versions };
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    const p = this.must(this.projectsById.get(id), "Project");
    const next: Partial<Project> = {};
    if (patch.name) next.name = patch.name;
    if (patch.shipMode) next.shipMode = patch.shipMode;
    if (p.setup && (patch.devCommand || patch.env)) {
      const env = { ...this.env.get(id), ...patch.env };
      this.env.set(id, env);
      next.setup = { ...p.setup, devCommand: patch.devCommand ?? p.setup.devCommand, missingEnv: p.setup.missingEnv.filter((k) => !env[k]) };
    }
    this.patchProject(id, next);
    return this.projectsById.get(id)!;
  }

  async newChat(projectId: string, input: NewChatInput): Promise<NewChatResult> {
    this.must(this.projectsById.get(projectId), "Project");
    const n = [...this.chats.values()].filter((c) => c.projectId === projectId).length;
    const id = this.id("sc");
    const chat: Chat = {
      id,
      projectId,
      title: input.title ?? (input.prompt ? titleFrom(input.prompt) : `Chat ${n + 1}`),
      mode: input.mode ?? "build",
      harness: input.harness ?? "claude-code",
      model: input.model,
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
      projectId: chat.projectId,
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
    };
    this.turns.set(turn.id, turn);
    this.patchChat(chatId, { status: "working", mode, question: undefined });
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
    const project = this.projectsById.get(t.projectId)!;
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
    const version = this.addVersion(chat.projectId, { title, kind: "apply", chatId });
    this.unapplied.set(chatId, []);
    this.patchChat(chatId, { appliedSha: list[list.length - 1]!.sha });
    this.emit();
    return { ok: true, version };
  }

  private addVersion(projectId: string, v: Pick<Version, "title" | "kind"> & Partial<Version>): Version {
    const version: Version = { id: this.id("sv"), projectId, sha: this.sha(), bookmarked: false, createdAt: this.iso(), ...v };
    this.versions.set(version.id, version);
    this.patchProject(projectId, {});
    return version;
  }

  async chatDiff(chatId: string) {
    this.must(this.chats.get(chatId), "Chat");
    const titles = (this.unapplied.get(chatId) ?? []).map((c) => c.title);
    const turns = [...this.turns.values()].filter((t) => t.chatId === chatId && t.checkpoint).map((t) => t.title ?? "");
    return { diff: fakeDiff(titles.length ? titles : turns.slice(-1)) };
  }

  async versionDiff(versionId: string) {
    const v = this.must(this.versions.get(versionId), "Version");
    return { diff: fakeDiff([v.title]) };
  }

  private preview(target: string, title: string, n: number): Preview {
    const first = this.started.get(target);
    if (first === undefined) this.started.set(target, this.now().getTime());
    const ready = first !== undefined && this.now().getTime() - first > this.stepMs;
    if (!ready) this.schedule(() => this.emit(), this.stepMs + 50);
    return { target, url: `${this.previewBase}/${target}?title=${encodeURIComponent(title)}&n=${n}`, status: ready ? "ready" : "starting" };
  }

  async chatPreview(chatId: string): Promise<Preview> {
    const chat = this.must(this.chats.get(chatId), "Chat");
    const turns = [...this.turns.values()].filter((t) => t.chatId === chatId && t.checkpoint);
    const latest = [...this.versions.values()].filter((v) => v.projectId === chat.projectId).length;
    return this.preview(chatId, turns.at(-1)?.title ?? this.projectsById.get(chat.projectId)?.name ?? "New app", latest + turns.length);
  }

  async versionPreview(versionId: string): Promise<Preview> {
    const v = this.must(this.versions.get(versionId), "Version");
    const n = [...this.versions.values()].filter((x) => x.projectId === v.projectId && x.createdAt <= v.createdAt).length;
    return this.preview(versionId, v.title, n);
  }

  async restore(versionId: string): Promise<Version> {
    const v = this.must(this.versions.get(versionId), "Version");
    const restored = this.addVersion(v.projectId, { title: `Restore: ${v.title}`, kind: "restore", restoredFrom: v.id });
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
      projects: [...this.projectsById.values()].map((p) => {
        const chats = [...this.chats.values()].filter((c) => c.projectId === p.id);
        const latest = [...this.versions.values()].filter((v) => v.projectId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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

  async repositories(): Promise<ForgeRepository[]> {
    return [
      { owner: "acme", name: "storefront", forge: "github" },
      { owner: "acme", name: "marketing-site", forge: "github" },
      { owner: "acme", name: "dashboard", forge: "github" },
    ];
  }

  /** Fills the fake with a project so the page has something to show. Returns the project id. */
  seed(scenario: FakeScenario): string | undefined {
    if (scenario === "none") return undefined;
    const now = this.now().getTime();
    const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    const project: Project = {
      id: "sp_demo",
      team: "team",
      name: scenario === "empty" ? "Recipe box" : "Habit tracker",
      template: "nextjs",
      source: { kind: "template", template: "nextjs" },
      shipMode: "cowboy",
      harness: "claude-code",
      status: "ready",
      createdBy: ME,
      createdAt: at(180),
      updatedAt: at(3),
    };
    this.projectsById.set(project.id, project);
    this.versions.set("sv_initial", {
      id: "sv_initial",
      projectId: project.id,
      sha: this.sha(),
      title: "Started from the Next.js template",
      kind: "initial",
      bookmarked: false,
      createdAt: at(180),
    });
    this.projectsById.set("sp_portfolio", {
      ...project,
      id: "sp_portfolio",
      name: "Portfolio site",
      shipMode: "safe",
      createdAt: at(4000),
      updatedAt: at(2900),
    });
    if (scenario === "empty") return project.id;

    const chat = (id: string, title: string, minAgo: number, port: number): Chat => ({
      id,
      projectId: project.id,
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
    this.chats.set("sc_main", chat("sc_main", "Habit tracker", 170, 4101));
    this.chats.set("sc_pricing", chat("sc_pricing", "Pricing page", 40, 4102));
    const turn = (id: string, chatId: string, minAgo: number, prompt: string, mode: ChatMode = "build"): Turn => {
      const o = outcomeFor(prompt, mode);
      return {
        id,
        projectId: project.id,
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
      turn("st_1", "sc_main", 170, "A habit tracker: a list of daily habits I can tick off, with a streak counter for each"),
      turn("st_2", "sc_main", 120, "Make the streak a flame badge and add a weekly heatmap"),
      turn("st_3", "sc_main", 60, "Does the heatmap work on mobile?"),
      turn("st_4", "sc_main", 20, "Add a dark mode toggle in the header"),
      turn("st_5", "sc_pricing", 40, "Plan a pricing page with three tiers", "plan"),
    ];
    for (const t of turns) this.turns.set(t.id, t);
    const v = (id: string, t: Turn, bookmarked = false): Version => ({
      id,
      projectId: project.id,
      sha: this.sha(),
      title: t.title!,
      kind: "apply",
      chatId: t.chatId,
      bookmarked,
      createdAt: t.finishedAt!,
    });
    for (const x of [v("sv_1", turns[0]!), v("sv_2", turns[1]!, true), v("sv_4", turns[3]!)]) this.versions.set(x.id, x);
    this.patchChat("sc_main", { appliedSha: turns[3]!.checkpoint });
    return project.id;
  }
}

const SETUP_DETAIL: Record<string, string> = {
  clone: "Cloned in 3s",
  install: "pnpm install, 412 packages",
  dev: "pnpm dev on port 4101",
  preview: "Ready",
};

/** A short title from a prompt: its first clause, capitalised, without the polite opener. */
export function titleFrom(prompt: string): string {
  const clause = prompt
    .replace(/^(please|can you|could you|i want|i'd like)\s+/i, "")
    .split(/[.:,;!?\n]/)[0]!
    .trim();
  const words = clause.split(/\s+/).slice(0, 7).join(" ");
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Untitled";
}

type Outcome = { title: string; reply: string; changes: boolean; question?: string; plan?: string };

function outcomeFor(prompt: string, mode: ChatMode): Outcome {
  const title = titleFrom(prompt);
  if (mode === "plan")
    return {
      title: `Plan: ${title}`,
      changes: false,
      reply: "Here is a plan. Say **Build it** when it looks right.",
      plan: `## ${title}\n\n1. Add a \`/pricing\` route with a three-column layout.\n2. Make a \`PriceCard\` component: name, price, features, call to action.\n3. Highlight the middle tier and add a monthly/yearly toggle.\n4. Link it from the header and the footer.`,
    };
  if (/\bask me\b|\bnot sure\b/i.test(prompt))
    return {
      title,
      changes: false,
      reply: "Before I start: which one do you want?",
      question: "Should the toggle follow the system theme by default, or start in light mode?",
    };
  if (/\?\s*$/.test(prompt) || mode === "chat")
    return {
      title,
      changes: mode === "chat" && /\b(add|make|change|fix)\b/i.test(prompt),
      reply:
        "Yes. The heatmap uses a CSS grid that wraps to four columns under 640px, and each cell keeps a 32px tap target. I checked it at 390px wide in the preview.",
    };
  return {
    title,
    changes: true,
    reply: `Done. ${title}, and the preview has the change. I kept the existing components and added tests for the new behaviour.`,
  };
}

function script(prompt: string, mode: ChatMode): Activity[] {
  const at = "";
  const steps: Activity[] = [
    { kind: "reasoning", text: `The person wants: ${prompt}. Look at the current page and components first.`, at },
    { kind: "tool", name: "Read", text: "app/page.tsx", at },
  ];
  if (mode === "build" && !/\?\s*$/.test(prompt)) {
    steps.push(
      { kind: "subagent", name: "Explore", text: "Found 4 components under components/ and the theme in app/globals.css", at },
      { kind: "tool", name: "Edit", text: "app/page.tsx", at },
      { kind: "tool", name: "Write", text: "components/habit-card.tsx", at },
      { kind: "tool", name: "Bash", text: "pnpm tsc --noEmit", at },
    );
  }
  steps.push({ kind: "message", text: mode === "plan" ? "Writing the plan." : "Wrapping up.", at });
  return steps;
}

function fakeDiff(titles: string[]): string {
  const title = titles.join("; ") || "No changes";
  return [
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
    `+// ${title}`,
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
}
