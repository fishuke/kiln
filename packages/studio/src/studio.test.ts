import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { FakeHarness, type FakeScript } from "@kiln/harness";
import { LocalSandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import { MemoryStore } from "@kiln/store";
import { afterEach, describe, expect, it } from "vitest";
import { AppDefinitions } from "./app-definitions";
import { studioEngineHooks, studioRuns } from "./engine-port";
import { Studio, toolText, type StudioOptions } from "./studio";
import type { Template } from "./templates";
import type { App } from "./types";
import type { StudioTracer } from "./tracer";
import type { KilnEvent } from "@kiln/events";

class TestClock {
  private t = new Date("2026-10-22T10:00:00Z").getTime();
  now() {
    this.t += 1000;
    return new Date(this.t);
  }
}

const TEST: Template = {
  id: "test",
  name: "Test",
  scaffold: ["printf 'export const n = 1;\\n' > app.ts", "printf 'node_modules\\n' > .gitignore"],
  install: [],
  dev: `node -e "require('http').createServer((q, s) => s.end('preview ' + process.cwd() + ' ' + (process.env.KILN_STUDIO_PREVIEW_DOMAIN || '') + ' pid ' + process.pid)).listen({port}, '127.0.0.1')"`,
  ready: { path: "/", timeoutMs: 5000 },
  egress: [],
};

/**
 * A scripted agent, reading the newest message: "write <file> <text>" writes a file, "ask" asks a question,
 * "restart" asks Studio to restart the preview, anything else just answers.
 */
const agent: FakeScript = async ({ opts, emit }) => {
  const write = async (path: string, text: string) => opts.sandbox.writeFile(`${opts.cwd}/${path}`, text);
  // A continued run's prompt is the first message plus "## Follow-up from …" sections; a real agent acts on the newest.
  const latest = opts.prompt.split(/\n## Follow-up from [^\n]*\n/).at(-1)!;
  for (const line of latest.split("\n")) {
    const m = /^write (\S+) (.*)$/.exec(line);
    if (m) {
      await write(m[1]!, `${m[2]}\n`);
      emit({ type: "tool_call", name: "Write", input: { file_path: m[1] } });
    }
    if (line === "delegate")
      emit({
        type: "tool_call",
        name: "Task",
        input: { description: "look around" },
      });
    if (line === "restart") await write(".kiln/studio.json", JSON.stringify({ title: "Restarted", restartPreview: true }));
    if (line === "ask")
      await write(
        ".kiln/studio.json",
        JSON.stringify({
          title: "Asked",
          summary: "A question.",
          question: "Text logo or upload one?",
        }),
      );
    if (line.startsWith("Run `git merge main`"))
      await opts.sandbox.exec("git merge main || (printf 'export const n = 3;\\n' > app.ts && git add -A && git commit -qm resolved)", {
        cwd: opts.cwd,
        trusted: true,
      });
  }
  const title = /^write (\S+)/m.exec(latest)?.[1];
  if (title) await write(".kiln/studio.json", JSON.stringify({ title: `Changed ${title}`, summary: "Done." }));
  emit({ type: "message", text: "Done." });
  return { summary: "Done." };
};

const studios: Studio[] = [];
/** Each test Studio's team: its Kiln's default team (the engine runs only for a team it knows). */
const teams = new WeakMap<Studio, string>();
let basePort = 20_000 + Math.floor(Math.random() * 20_000);

/** A Studio on a test Kiln: every turn is a run of the App's agent through the engine, with `script` as the agent. */
function make(over: Partial<StudioOptions> = {}, script: FakeScript = agent, kilnOptions: { askHumanTimeoutMs?: number } = {}) {
  const harness = new FakeHarness(script);
  let studio!: Studio;
  const { kiln } = createTestKiln({
    harness: () => harness,
    ...studioEngineHooks(() => studio),
    ...kilnOptions,
  });
  const clock = new TestClock();
  const definitions = new AppDefinitions({ store: over.store ?? kiln.store, clock });
  studio = new Studio({
    store: kiln.store,
    objects: kiln.objects,
    bus: kiln.bus,
    clock,
    sandboxes: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-"))),
    definitions,
    runs: studioRuns(kiln.runs),
    gates: kiln.gates,
    templates: { test: TEST },
    image: "kiln-runner-studio:test",
    previewUrl: (target, a) => `http://${a.host}:${a.port}/#${target}`,
    basePort: (basePort += 10),
    ...over,
  });
  studios.push(studio);
  teams.set(studio, kiln.teams.ensureDefaultTeam().id);
  return { studio, harness, bus: kiln.bus, kiln, definitions };
}

afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

async function app(studio: Studio, shipMode: "safe" | "review" | "cowboy" = "cowboy") {
  // Ship mode is the source's default at creation; ship's setShipMode changes it through updateApp after its cap check.
  const p = await studio.createApp({ team: teams.get(studio)!, by: "me@x.test", name: "Daily Done", source: { kind: "template", template: "test" } });
  if (shipMode !== "cowboy") studio.updateApp(p.id, { shipMode });
  await studio.ready(p.id);
  return studio.getApp(p.id)!.app;
}

async function say(studio: Studio, chatId: string, text: string, mode?: "build" | "chat" | "plan") {
  const r = await studio.send(chatId, { by: "me@x.test", via: "web", text, ...(mode ? { mode } : {}) });
  await studio.idle(chatId);
  return studio.getChat(chatId)!.turns.find((t) => t.id === r.turn.id)!;
}

describe("apps", () => {
  it("runs a cowboy App's agents without the command guard, and other ship modes with it", async () => {
    const { studio } = make();
    const cowboy = await app(studio);
    expect(studio.definition(cowboy.id).unguarded).toBe(true);
    studio.updateApp(cowboy.id, { shipMode: "review" });
    expect(studio.definition(cowboy.id).unguarded).toBeUndefined();
  });

  it("scaffolds a template app with an initial version on main", async () => {
    const { studio } = make();
    const p = await app(studio);
    expect(p).toMatchObject({ status: "ready", shipMode: "cowboy" });
    expect(p.setup).toMatchObject({ mainBranch: "main", envMissing: [] });
    const { versions } = studio.getApp(p.id)!;
    expect(versions.map((v) => [v.kind, v.title])).toEqual([["initial", "Created Daily Done"]]);
  });

  it("returns while it is set up and starts the first chat with its prompt once setup is done", async () => {
    const { studio } = make();
    const p = await studio.createApp({
      team: teams.get(studio)!,
      by: "me@x.test",
      name: "Daily Done",
      source: { kind: "template", template: "test" },
      firstPrompt: { text: "write home.md", via: "web" },
    });
    expect(p).toMatchObject({ status: "creating", firstPrompt: { text: "write home.md", via: "web" } });
    expect(studio.getApp(p.id)!.chats).toEqual([]);
    await studio.ready(p.id);
    const { app: ready, chats } = studio.getApp(p.id)!;
    expect(ready.status).toBe("ready");
    expect(ready.firstPrompt).toBeUndefined();
    expect(chats).toHaveLength(1);
    await studio.idle(chats[0]!.id);
    expect(studio.getChat(chats[0]!.id)!.turns.map((t) => [t.prompt, t.by, t.via])).toEqual([["write home.md", "me@x.test", "web"]]);
  });

  it("keeps the first prompt of an App whose setup failed and starts it when the App is retried", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "kiln-marker-")), "ok");
    const { studio } = make({ templates: { test: { ...TEST, scaffold: [`test -e ${marker}`, ...TEST.scaffold] } } });
    const p = await studio.createApp({
      team: teams.get(studio)!,
      by: "me@x.test",
      name: "Daily Done",
      source: { kind: "template", template: "test" },
      firstPrompt: { text: "write home.md", via: "web" },
    });
    await studio.ready(p.id);
    expect(studio.getApp(p.id)!.app).toMatchObject({ status: "failed", firstPrompt: { text: "write home.md" } });
    expect(studio.getApp(p.id)!.chats).toEqual([]);
    writeFileSync(marker, "");
    await studio.retryApp(p.id);
    await studio.ready(p.id);
    expect(studio.getApp(p.id)!.app.firstPrompt).toBeUndefined();
    expect(studio.getApp(p.id)!.chats.map((c) => c.title)).toEqual(["write home.md"]);
  });

  it("imports a repository: package manager, dev command and missing environment", async () => {
    const origin = mkdtempSync(join(tmpdir(), "kiln-origin-"));
    writeFileSync(join(origin, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "node server.js" } }));
    writeFileSync(join(origin, ".env.example"), "API_URL=\n# comment\nSECRET_KEY=change-me\n");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: origin });
    git("init", "-q", "-b", "trunk");
    git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
    git("add", "-A");
    git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", "app");
    const env: Record<string, string> = { API_URL: "https://api.test" };
    const { studio } = make({ clone: async () => ({ url: origin }), env: () => ({ env: { ...env }, secretValues: [] }) });
    const created = await studio.createApp({ team: "t1", by: "me", name: "Imported", source: { kind: "repo", repo: "acme/app" } });
    await studio.ready(created.id);
    const p = studio.getApp(created.id)!.app;
    // Imported repositories ship by pull request unless the person picks otherwise.
    expect(p).toMatchObject({ status: "ready", shipMode: "review" });
    expect(p.setup).toMatchObject({
      mainBranch: "trunk",
      packageManager: "npm",
      devDetected: "npm run dev",
      dev: "npm run dev",
      envRequired: ["API_URL", "SECRET_KEY"],
      envMissing: ["SECRET_KEY"],
    });
    // A variable assigned after setup clears it on the next read.
    env.SECRET_KEY = "s3cret";
    expect(studio.getApp(p.id)!.app.setup?.envMissing).toEqual([]);
    expect(studio.updateApp(p.id, { devCommand: "node other.js" }).setup?.dev).toBe("node other.js");
    expect(studio.updateApp(p.id, { devCommand: null }).setup?.dev).toBe("npm run dev");
  });

  it("gives an App imported before ports were rewritten its own preview port", async () => {
    const origin = mkdtempSync(join(tmpdir(), "kiln-origin-"));
    writeFileSync(join(origin, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "next dev -p 4000" } }));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: origin });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", "app");
    const { studio, kiln } = make({ clone: async () => ({ url: origin }) });
    const created = await studio.createApp({ team: "t1", by: "me", name: "Old import", source: { kind: "repo", repo: "acme/app" } });
    await studio.ready(created.id);
    // What setup stored before a fixed port was rewritten: the script itself, which always listens on 4000.
    const stored = kiln.store.get<App>("studio_apps", created.id)!;
    kiln.store.put("studio_apps", { ...stored, setup: { ...stored.setup!, devDetected: "npm run dev", dev: "npm run dev" } });
    const { chat } = await studio.newChat(created.id, { by: "me", via: "web" });
    await studio.preview({ chatId: chat.id }).catch(() => undefined);
    expect(studio.getApp(created.id)!.app.setup).toMatchObject({
      devDetected: "npm exec -- next dev -p {port} --hostname 0.0.0.0",
      dev: "npm exec -- next dev -p {port} --hostname 0.0.0.0",
    });
    // A dev command the person set is theirs: it is never replaced.
    studio.updateApp(created.id, { devCommand: "npm run dev" });
    await studio.restartPreview(chat.id).catch(() => undefined);
    expect(studio.getApp(created.id)!.app.setup?.dev).toBe("npm run dev");
  });

  it("asks for preview sandboxes and keeps ports in the preview range", async () => {
    const local = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-")));
    const specs: SandboxSpec[] = [];
    const sandboxes = { name: "local", create: (spec: SandboxSpec) => (specs.push(spec), local.create(spec)), resume: local.resume.bind(local) };
    const { studio } = make({ sandboxes, basePort: undefined });
    const p = await app(studio);
    // preview: true puts it on the preview network (Docker) or gives it the kiln.dev/preview label (Kubernetes).
    expect(specs[0]).toMatchObject({ preview: true, labels: { "kiln.studio.app": p.id } });
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    expect(chat.port).toBe(4101);
    expect(chat.id).toMatch(/^sc_[0-9a-f]{32}$/);
  });

  it("starts a new chat's install from another worktree's dependencies", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-studio-"));
    // The install marks a fresh node_modules, and notes when it found one already there.
    const install = ["if [ -f node_modules/.installed ]; then touch node_modules/.reused; else mkdir -p node_modules && touch node_modules/.installed; fi"];
    const { studio } = make({ sandboxes: new LocalSandboxProvider(root), templates: { test: { ...TEST, install } } });
    const p = await app(studio);
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await studio.diff({ chatId: a.id });
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await studio.diff({ chatId: b.id });
    const files = readdirSync(root, { recursive: true }) as string[];
    expect(files.some((f) => f.endsWith(`${a.path}/node_modules/.reused`))).toBe(false);
    expect(files.some((f) => f.endsWith(`${b.path}/node_modules/.reused`))).toBe(true);
  });

  it("opens a new chat before its worktree is installed, and its first message waits for the install", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "kiln-marker-")), "go");
    // A chat's install waits for the marker; the App's own install (in app/) doesn't.
    const install = [`case "$PWD" in */chats/*) while [ ! -e ${marker} ]; do sleep 0.05; done ;; esac`];
    const { studio } = make({ templates: { test: { ...TEST, install } } });
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    expect(chat.status).toBe("idle");
    const sent = studio.send(chat.id, { by: "me", via: "web", text: "write early.md hi" });
    writeFileSync(marker, "");
    await sent;
    await studio.idle(chat.id);
    expect(await studio.diff({ chatId: chat.id })).toContain("+hi");
  });

  it("takes a model with a chat's first message, and keeps it afterwards", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.send(chat.id, { by: "me", via: "web", text: "hello", model: "claude-haiku-5-5" });
    await studio.idle(chat.id);
    expect(studio.getChat(chat.id)!.chat.model).toBe("claude-haiku-5-5");
    await studio.send(chat.id, { by: "me", via: "web", text: "again", model: "claude-opus-5-5" });
    await studio.idle(chat.id);
    expect(studio.getChat(chat.id)!.chat.model).toBe("claude-haiku-5-5");
  });

  it("gives a new chat its agent's harness and model from the App settings", async () => {
    const { studio, definitions } = make();
    const p = await app(studio);
    definitions.edit({ team: p.team, appId: p.id }, { agents: { general: { harness: "codex", model: "gpt-6" } } }, "me");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    expect(chat).toMatchObject({ harness: "codex", model: "gpt-6" });
    expect(studio.getApp(p.id)!.app).toMatchObject({ harness: "codex", model: "gpt-6" });
  });

  it("lets a chat choose its own harness, without the agent's model for another harness", async () => {
    const { studio, definitions } = make();
    const p = await app(studio);
    definitions.edit({ team: p.team, appId: p.id }, { agents: { general: { model: "claude-opus-5-5" } } }, "me");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web", harness: "codex" });
    expect(chat.harness).toBe("codex");
    expect(chat.model).toBeUndefined();
  });

  it("writes the harness an App is created with into its settings", async () => {
    const { studio, definitions } = make();
    const p = await studio.createApp({
      team: teams.get(studio)!,
      by: "me",
      name: "Codex app",
      source: { kind: "template", template: "test" },
      harness: "codex",
    });
    await studio.ready(p.id);
    expect(definitions.chatConfig({ team: p.team, appId: p.id }).harness).toBe("codex");
    expect((await studio.newChat(p.id, { by: "me", via: "web" })).chat.harness).toBe("codex");
  });

  it("may belong to a Kiln Project, and needs no factory", async () => {
    const { studio } = make();
    const created = await studio.createApp({ team: "t1", by: "me", name: "Frontend", projectId: "prj_shop", source: { kind: "template", template: "test" } });
    expect(created).toMatchObject({ id: expect.stringMatching(/^sa_[0-9a-f]{32}$/), projectId: "prj_shop" });
    expect(studio.updateApp(created.id, { projectId: null }).projectId).toBeUndefined();
    expect(studio.updateApp(created.id, { projectId: "prj_other" }).projectId).toBe("prj_other");
    await studio.ready(created.id);
  });
});

describe("turns and versions", () => {
  it("makes a checkpoint only when a turn changes files, and a question makes nothing", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const built = await say(studio, chat.id, "write todo.ts export const todo = [];");
    expect(built).toMatchObject({ status: "succeeded", title: "Changed todo.ts", discarded: false });
    expect(built.checkpoint).toMatch(/^[0-9a-f]{40}$/);
    const asked = await say(studio, chat.id, "how does it work?");
    expect(asked.checkpoint).toBeUndefined();
    expect(studio.getApp(p.id)!.versions).toHaveLength(1);
  });

  it("never counts what installing dependencies writes as the agent's change", async () => {
    // An install that generates a lockfile and edits a tracked file, like `pnpm install` in a repository without one.
    const { studio } = make({
      templates: { test: { ...TEST, install: ["printf 'lockfileVersion: 9\\n' > pnpm-lock.yaml", "printf 'export const n = 2;\\n' > app.ts"] } },
    });
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const asked = await say(studio, chat.id, "how does it work?");
    expect(asked.checkpoint).toBeUndefined();
    expect(await studio.diff({ chatId: chat.id })).toBe("");
  });

  it("reverts edits in chat and plan mode", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const t = await say(studio, chat.id, "write sneaky.ts nope", "chat");
    expect(t.discarded).toBe(true);
    expect(t.checkpoint).toBeUndefined();
    expect(await studio.diff({ chatId: chat.id })).toBe("");
    const plan = await say(studio, chat.id, "plan the drag feature", "plan");
    expect(plan.plan).toBe("Done.");
  });

  it("records subagents and a question that needs the person", async () => {
    const { studio, bus } = make();
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const t = await say(studio, chat.id, "delegate\nask");
    expect(t.activity.find((a) => a.kind === "subagent")).toMatchObject({ name: "Task", text: "look around" });
    expect(t.question).toBe("Text logo or upload one?");
    expect(studio.getChat(chat.id)!.chat).toMatchObject({ status: "needs_you", question: "Text logo or upload one?" });
    const needs = bus.outbox.filter((e) => e.type === "studio.needs_you");
    expect(needs.map((e) => e.payload)).toEqual([expect.objectContaining({ reason: "question", priority: "needs_you" })]);
    expect(bus.outbox.filter((e) => e.type === "studio.turn_finished").map((e) => (e.payload as { priority: string }).priority)).toEqual(["finished"]);
  });

  it("applies on a click in safe mode and restores an old version as a new one", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await say(studio, chat.id, "write a.ts one");
    expect(studio.getApp(p.id)!.versions).toHaveLength(1);
    const applied = await studio.apply(chat.id, "me");
    expect(applied).toMatchObject({ ok: true, version: { kind: "apply", title: "Changed a.ts", chatId: chat.id } });
    expect(await studio.apply(chat.id, "me")).toEqual({ ok: false, nothing: true });
    const initial = studio.getApp(p.id)!.versions.find((v) => v.kind === "initial")!;
    const restored = await studio.restore(initial.id, "me");
    expect(restored).toMatchObject({ kind: "restore", restoredFrom: initial.id, title: "Restore: Created Daily Done" });
    expect(studio.getApp(p.id)!.versions).toHaveLength(3);
    expect(await studio.diff({ versionId: restored.id })).toContain("-one");
    expect(studio.bookmark(initial.id, true).bookmarked).toBe(true);
  });

  it("applies every changed turn in cowboy mode, across two chats", async () => {
    const { studio, bus } = make();
    const p = await app(studio, "cowboy");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await say(studio, a.id, "write a.ts from a");
    await say(studio, b.id, "write b.ts from b");
    await say(studio, b.id, "just a question");
    const versions = studio.getApp(p.id)!.versions;
    expect(versions.map((v) => v.title)).toEqual(["Changed b.ts", "Changed a.ts", "Created Daily Done"]);
    expect(bus.outbox.filter((e) => e.type === "studio.version_created")).toHaveLength(3);
  });

  it("resolves a conflict with a resolve turn in cowboy mode", async () => {
    const { studio } = make();
    const p = await app(studio, "cowboy");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await say(studio, a.id, "write app.ts export const n = 2;");
    await say(studio, b.id, "write app.ts export const n = 3;");
    await studio.idle(b.id);
    const turns = studio.getChat(b.id)!.turns;
    expect(turns.some((t) => t.resolve)).toBe(true);
    expect(studio.getChat(b.id)!.chat.status).toBe("idle");
    expect(studio.getApp(p.id)!.versions[0]).toMatchObject({ kind: "apply", chatId: b.id });
  });

  it("reports a conflict in safe mode instead of merging", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await say(studio, a.id, "write app.ts export const n = 2;");
    await say(studio, b.id, "write app.ts export const n = 3;");
    expect(await studio.apply(a.id, "me")).toMatchObject({ ok: true });
    expect(await studio.apply(b.id, "me")).toEqual({ ok: false, conflict: ["app.ts"] });
    expect(studio.getChat(b.id)!.chat.status).toBe("conflict");
  });

  it("refuses a turn beyond the running-chat limit", async () => {
    const slow: FakeScript = async ({ nextSteer }) => void (await nextSteer(2000));
    const { studio } = make({ maxRunningChats: 1 }, slow);
    const p = await app(studio, "safe");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await studio.send(a.id, { by: "me", via: "web", text: "work" });
    // A turn can be steered once its run is working in the chat's worktree.
    await waitFor(async () => expect(studio.getChat(a.id)!.chat.runId).toBeDefined());
    expect((await studio.send(a.id, { by: "me", via: "web", text: "also this" })).steered).toBe(true);
    await expect(studio.send(b.id, { by: "me", via: "web", text: "work" })).rejects.toMatchObject({ code: "busy" });
    await studio.idle(a.id);
  });
});

describe("previews and pausing", () => {
  it("serves a chat's dev server and a version's, and resumes after a pause", async () => {
    const { studio } = make({ previewDomain: "preview.localhost" });
    const p = await app(studio, "cowboy");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await say(studio, chat.id, "write a.ts one");
    const preview = await studio.preview({ chatId: chat.id });
    expect(preview).toMatchObject({ url: `http://127.0.0.1:${chat.port}/#${chat.id}`, status: "starting" });
    expect(await studio.resolvePreview(chat.id)).toEqual({ host: "127.0.0.1", port: chat.port });
    // The ready check answers once the dev server does.
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("ready"));
    const body = await (await fetch(`http://127.0.0.1:${chat.port}/`)).text();
    expect(body).toContain(`chats/${chat.id}`);
    // The template's next.config.ts allows dev origins under the preview domain.
    expect(body).toContain("preview.localhost");
    const v = studio.getApp(p.id)!.versions.at(-1)!;
    expect((await studio.preview({ versionId: v.id })).target).toBe(v.id);
    expect(await studio.resolvePreview("sc_unknown")).toBeUndefined();

    expect((await studio.pause(p.id)).status).toBe("paused");
    expect(await studio.resolvePreview(chat.id)).toBeUndefined();
    const again = await say(studio, chat.id, "write b.ts two");
    expect(again.checkpoint).toBeDefined();
    expect(studio.getApp(p.id)!.app.status).toBe("ready");
    expect(studio.getApp(p.id)!.versions[0]!.title).toBe("Changed b.ts");
  });
});

describe("restarting a preview", () => {
  const pid = async (port: number) => /pid (\d+)/.exec(await (await fetch(`http://127.0.0.1:${port}/`)).text())?.[1];

  it("starts the chat's dev server again on the same port, when asked or when the agent asks", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-studio-"));
    const { studio } = make({ sandboxes: new LocalSandboxProvider(root) });
    const p = await app(studio, "cowboy");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.preview({ chatId: chat.id });
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("ready"));
    const first = await pid(chat.port);

    expect((await studio.restartPreview(chat.id)).status).toBe("starting");
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("ready"));
    const second = await pid(chat.port);
    expect(second).not.toBe(first);

    // The agent can read the dev server's output in its worktree.
    const log = () => {
      const f = (readdirSync(root, { recursive: true }) as string[]).find((x) => x.endsWith(`${chat.path}/.kiln/dev.log`));
      return f ? readFileSync(join(root, f), "utf8") : "";
    };
    await waitFor(async () => expect(log()).toContain("[kiln] the dev server was stopped"));

    await say(studio, chat.id, "restart");
    await waitFor(async () => expect(await pid(chat.port).catch(() => undefined)).not.toBe(second));
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("ready"));
  });
});

describe("deleting chats", () => {
  it("removes a chat's preview, worktree, branch and turns, keeps its versions, and reuses its port", async () => {
    const { studio, kiln } = make();
    const p = await app(studio, "cowboy");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await say(studio, a.id, "write a.ts one");
    await studio.preview({ chatId: a.id });
    expect(await studio.resolvePreview(a.id)).toBeDefined();

    await studio.deleteChat(a.id);
    expect(studio.getChat(a.id)).toBeUndefined();
    expect(studio.getApp(p.id)!.chats.map((c) => c.id)).toEqual([b.id]);
    expect(kiln.store.list<{ id: string; chatId: string }>("studio_turns", (t) => t.chatId === a.id)).toEqual([]);
    expect(studio.getApp(p.id)!.versions[0]!.title).toBe("Changed a.ts");
    expect(await studio.resolvePreview(a.id)).toBeUndefined();
    const git = await studio.withWorkspace(p.id, async (s) => (await s.exec("git worktree list; git branch --list", { cwd: "app", trusted: true })).stdout);
    expect(git).not.toContain(a.id);
    expect(git).toContain(b.id);

    const c = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    expect(c.port).toBe(a.port);
    await expect(studio.deleteChat(a.id)).rejects.toThrow(`unknown chat ${a.id}`);
  });

  it("refuses a chat that is working", async () => {
    const slow: FakeScript = async ({ nextSteer }) => void (await nextSteer(2000));
    const { studio } = make({}, slow);
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.send(chat.id, { by: "me", via: "web", text: "work" });
    await expect(studio.deleteChat(chat.id)).rejects.toThrow("the chat is working; stop it first");
    await studio.idle(chat.id);
    await studio.deleteChat(chat.id);
    expect(studio.getChat(chat.id)).toBeUndefined();
  });
});

describe("subagents", () => {
  it("gives a run an App agent spawns its own chat, worktree and turn", async () => {
    let kiln!: ReturnType<typeof make>["kiln"];
    const lead: FakeScript = async (ctx) => {
      if (ctx.opts.prompt.includes("split the work")) {
        await kiln.runs.spawn(ctx.opts.env!.KILN_RUN_ID!, { agent: "helper", prompt: "write helper.ts from the helper", name: "helper", wait: true });
        return { summary: "Split." };
      }
      return agent(ctx);
    };
    const made = make({}, lead);
    kiln = made.kiln;
    const p = await app(made.studio, "safe");
    made.definitions.save({ team: p.team, appId: p.id }, { "agents/helper/agent.md": "---\nspawnableBy: [general]\n---\nHelp the lead.\n" }, "me");
    const { chat } = await made.studio.newChat(p.id, { by: "me", via: "web" });
    await say(made.studio, chat.id, "split the work");
    const child = made.studio.getApp(p.id)!.chats.find((c) => c.agent === "helper")!;
    expect(child).toMatchObject({ title: "helper", parentRunId: made.studio.getChat(chat.id)!.chat.runId, status: "idle" });
    await made.studio.idle(child.id);
    const [turn] = made.studio.getChat(child.id)!.turns;
    expect(turn).toMatchObject({ status: "succeeded", title: "Changed helper.ts", checkpoint: expect.any(String) });
    expect(await made.studio.diff({ chatId: child.id })).toContain("+from the helper");
  });
});

describe("restarts", () => {
  it("fails what a restart cut off: a creating App, a running turn and its working chat", () => {
    const store = new MemoryStore();
    const at = "2026-10-22T10:00:00.000Z";
    store.put("studio_apps", {
      id: "sa_1",
      team: "t1",
      name: "A",
      source: { kind: "template", template: "test" },
      shipMode: "cowboy",
      harness: "claude-code",
      status: "creating",
      createdBy: "me",
      createdAt: at,
      updatedAt: at,
    });
    store.put("studio_chats", {
      id: "sc_1",
      appId: "sa_2",
      title: "Chat",
      mode: "build",
      harness: "claude-code",
      branch: "chat/sc_1",
      path: "chats/sc_1",
      port: 4101,
      status: "working",
      createdAt: at,
      updatedAt: at,
    });
    store.put("studio_turns", {
      id: "st_1",
      appId: "sa_2",
      chatId: "sc_1",
      prompt: "go",
      mode: "build",
      via: "web",
      by: "me",
      status: "running",
      reply: "",
      discarded: false,
      activity: [],
      costUsd: 0,
      startedAt: at,
    });
    const { studio } = make({ store });
    expect(store.get("studio_apps", "sa_1")).toMatchObject({ status: "failed", error: "interrupted by a restart" });
    expect(store.get("studio_turns", "st_1")).toMatchObject({ status: "failed", reply: "interrupted by a restart" });
    expect(studio.getChat("sc_1")!.chat).toMatchObject({ status: "needs_you", question: "The agent failed: interrupted by a restart" });
  });

  it("gives a chat saved before chats had an agent the general agent", () => {
    const store = new MemoryStore();
    const at = "2026-10-22T10:00:00.000Z";
    store.put("studio_chats", {
      id: "sc_old",
      appId: "sa_2",
      title: "Chat",
      mode: "build",
      harness: "claude-code",
      branch: "chat/sc_old",
      path: "chats/sc_old",
      port: 4101,
      status: "idle",
      createdAt: at,
      updatedAt: at,
    });
    const { studio } = make({ store });
    expect(studio.getChat("sc_old")!.chat.agent).toBe("general");
  });
});

describe("activity", () => {
  it("says what each tool call acted on", () => {
    expect(toolText({ command: "pnpm typecheck\n&& pnpm test" })).toBe("pnpm typecheck");
    expect(toolText({ file_path: "/workspace/chats/sc_1/app/page.tsx" })).toBe("app/page.tsx");
    expect(toolText({ pattern: "TodoItem", path: "/workspace/chats/sc_1/components" })).toBe("TodoItem in components");
    expect(toolText({ pattern: "**/*.tsx" })).toBe("**/*.tsx");
    expect(toolText({ url: "https://nextjs.org/docs" })).toBe("https://nextjs.org/docs");
    expect(toolText({})).toBeUndefined();
  });

  it("records a command's text on its activity line", async () => {
    const ran: FakeScript = async ({ emit }) => {
      emit({ type: "tool_call", name: "Bash", input: { command: "pnpm typecheck" } });
      return { summary: "checked" };
    };
    const { studio } = make({}, ran);
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const t = await say(studio, chat.id, "check it");
    expect(t.activity).toContainEqual(expect.objectContaining({ kind: "tool", name: "Bash", text: "pnpm typecheck" }));
    expect(t.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("command approvals", () => {
  /** An agent that runs a command the guard asks a person about (`rm -` is risky), then says what happened. */
  const risky: FakeScript = async ({ opts, emit }) => {
    emit({ type: "tool_call", name: "Bash", input: { command: "rm -f notes.tmp" } });
    const r = await opts.sandbox.exec("rm -f notes.tmp", { cwd: opts.cwd }).then(
      () => "ran",
      (e: Error) => e.message,
    );
    emit({ type: "message", text: r });
    return { summary: r };
  };
  const waitUntil = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(ok()).toBe(true);
  };

  it("asks the person in the chat, and the turn continues once they allow the command", async () => {
    const { studio, kiln, bus } = make({}, risky);
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.send(chat.id, { by: "me", via: "web", text: "clean up" });
    await waitUntil(() => studio.getChat(chat.id)!.chat.status === "needs_you");

    const waiting = studio.getChat(chat.id)!;
    expect(waiting.chat.question).toBe("Allow this command? rm -f notes.tmp");
    const approval = waiting.turns.at(-1)!.approval!;
    expect(approval).toMatchObject({ command: "rm -f notes.tmp", state: "waiting" });
    expect(kiln.gates.get(approval.gateId)).toMatchObject({ runId: waiting.turns.at(-1)!.runId, state: "open" });
    expect(bus.outbox.filter((e) => e.type === "studio.needs_you").map((e) => e.payload)).toEqual([
      { appId: p.id, chatId: chat.id, question: "Allow this command? rm -f notes.tmp", reason: "approval", priority: "needs_you" },
    ]);
    expect(studio.status({ team: p.team }).apps[0]!.needsYou).toEqual([{ chatId: chat.id, question: "Allow this command? rm -f notes.tmp" }]);

    await kiln.gates.decide(approval.gateId, { decision: "approve", by: "ada@x.test", via: "web" });
    expect(studio.getChat(chat.id)!.chat).toMatchObject({ status: "working", question: undefined });
    expect(bus.outbox.find((e) => e.type === "studio.approval_decided")?.payload).toEqual({
      appId: p.id,
      chatId: chat.id,
      turnId: waiting.turns.at(-1)!.id,
      decision: "allowed",
      by: "ada@x.test",
      priority: "progress",
    });
    await studio.idle(chat.id);
    const done = studio.getChat(chat.id)!;
    expect(done.turns.at(-1)).toMatchObject({ status: "succeeded", reply: "ran", approval: { state: "allowed", by: "ada@x.test" } });
    expect(done.chat.status).toBe("idle");
  });

  it("blocks the command when nobody answers in time, and the turn goes on without it", async () => {
    const { studio, kiln } = make({}, risky, { askHumanTimeoutMs: 100 });
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const t = await say(studio, chat.id, "clean up");
    expect(t.reply).not.toBe("ran");
    expect(t.approval).toMatchObject({ command: "rm -f notes.tmp", state: "blocked" });
    expect(kiln.gates.get(t.approval!.gateId)?.state).toBe("expired");
    expect(studio.getChat(chat.id)!.chat.status).toBe("idle");
  });
});

describe("environment", () => {
  it("passes the App's assigned values to the agent and redacts secret values from what it stores", async () => {
    const seen: Record<string, string>[] = [];
    const leaky: FakeScript = async ({ opts, emit }) => {
      seen.push(opts.env ?? {});
      emit({ type: "message", text: "the key is s3cr3t-value-123" });
      emit({ type: "tool_call", name: "Bash", input: { command: "echo s3cr3t-value-123" } });
      return { summary: "used s3cr3t-value-123" };
    };
    const { studio } = make({ env: () => ({ env: { API_KEY: "s3cr3t-value-123", REGION: "eu" }, secretValues: ["s3cr3t-value-123"] }) }, leaky);
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    const t = await say(studio, chat.id, "hi");
    expect(seen[0]).toMatchObject({ API_KEY: "s3cr3t-value-123", REGION: "eu" });
    expect(JSON.stringify(t)).not.toContain("s3cr3t-value-123");
    expect(t.reply).toContain("[redacted]");
  });
});

describe("preview addresses", () => {
  it("asks the sandbox for a dev server's address once, not on every request", async () => {
    const local = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-")));
    let calls = 0;
    const sandboxes = {
      name: "local",
      create: async (spec: SandboxSpec) => {
        const s = await local.create(spec);
        const expose = s.expose!.bind(s);
        s.expose = async (port: number) => (calls++, expose(port));
        return s;
      },
      resume: local.resume.bind(local),
    };
    const { studio } = make({ sandboxes });
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.preview({ chatId: chat.id });
    const before = calls;
    for (let i = 0; i < 5; i++) await studio.resolvePreview(chat.id);
    expect(calls).toBe(before);
  });
});

describe("a dev server that exits", () => {
  it("stays failed with its reason and output until restarted, and starts again with the App's current environment", async () => {
    let env: Record<string, string> = {};
    const { studio, bus } = make({
      templates: { test: { ...TEST, dev: `echo "key=$KEY"; [ -n "$KEY" ] || exit 2; ${TEST.dev}` } },
      env: () => ({ env, secretValues: [] }),
    });
    const failed: KilnEvent<"studio.preview_failed">[] = [];
    bus.subscribe("studio.preview_failed", (e) => void failed.push(e));
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.preview({ chatId: chat.id });
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("failed"));
    // Asking again doesn't start it again.
    await new Promise((r) => setTimeout(r, 300));
    expect(await studio.preview({ chatId: chat.id })).toMatchObject({ status: "failed", reason: "the dev server exited with code 2", output: "key=" });
    expect(failed).toHaveLength(1);

    env = { KEY: "set" };
    expect((await studio.restartPreview(chat.id)).status).toBe("starting");
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("ready"));
  });

  it("restarts the version preview", async () => {
    const { studio } = make();
    const p = await app(studio, "safe");
    const v = studio.getApp(p.id)!.versions[0]!;
    await studio.preview({ versionId: v.id });
    await waitFor(async () => expect((await studio.preview({ versionId: v.id })).status).toBe("ready"));
    expect((await studio.restartVersionPreview(v.id)).status).toBe("starting");
    await waitFor(async () => expect((await studio.preview({ versionId: v.id })).status).toBe("ready"));
  });
});

describe("a dev server that never answers", () => {
  it("marks the preview failed after the template's ready timeout", async () => {
    const { studio } = make({ templates: { test: { ...TEST, dev: "sleep 30", ready: { path: "/", timeoutMs: 300 } } } });
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    expect((await studio.preview({ chatId: chat.id })).status).toBe("starting");
    await waitFor(async () => expect((await studio.preview({ chatId: chat.id })).status).toBe("failed"));
  });
});

async function waitFor<T>(fn: () => Promise<T>, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Records each span's name, attributes and whether it failed. */
function recordingTracer() {
  const spans: { name: string; attributes: Record<string, unknown>; error?: string }[] = [];
  const tracer: StudioTracer = {
    span: async (name, attributes, fn) => {
      const s: (typeof spans)[number] = { name, attributes };
      spans.push(s);
      try {
        return await fn();
      } catch (err) {
        s.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },
  };
  return { tracer, spans };
}

describe("failures are reported", () => {
  it("publishes studio.app_failed when setup fails, with secret values redacted, and fails the provision span", async () => {
    const { tracer, spans } = recordingTracer();
    const { studio, bus } = make({
      tracer,
      templates: { test: { ...TEST, scaffold: ["echo 'token s3cr3t-value-123' >&2; exit 3"] } },
      env: () => ({ env: {}, secretValues: ["s3cr3t-value-123"] }),
    });
    const failed: KilnEvent<"studio.app_failed">[] = [];
    bus.subscribe("studio.app_failed", (e) => void failed.push(e));
    const p = await app(studio);
    expect(p.status).toBe("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload).toMatchObject({ appId: p.id, priority: "needs_you" });
    expect(failed[0]!.payload.error).toContain("token [redacted]");
    expect(spans.map((s) => [s.name, Boolean(s.error)])).toEqual([
      ["studio.provision", true],
      ["studio.scaffold", true],
    ]);
  });

  it("traces provision steps, snapshots, apply and the dev server", async () => {
    const { tracer, spans } = recordingTracer();
    const { studio } = make({ tracer });
    const p = await app(studio, "safe");
    expect(spans.map((s) => s.name)).toEqual(["studio.provision", "studio.scaffold", "studio.commit", "studio.snapshot"]);
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await say(studio, chat.id, "write a.ts one");
    await studio.apply(chat.id, "me");
    await studio.preview({ chatId: chat.id });
    await waitFor(async () => expect(spans.map((s) => s.name)).toContain("studio.ready_check"));
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining(["studio.apply", "studio.dev_server_start"]));
    expect(spans.find((s) => s.name === "studio.apply")!.attributes).toMatchObject({ "kiln.studio.app.id": p.id, "kiln.studio.chat.id": chat.id });
    expect(spans.every((s) => !s.error)).toBe(true);
  });

  it("publishes studio.preview_failed when a dev server never answers, with its last output lines", async () => {
    const { tracer, spans } = recordingTracer();
    const dev = `for i in $(seq 1 45); do echo line $i; done; echo 'key s3cr3t-value-123'; echo 'boom' >&2; sleep 30`;
    const { studio, bus } = make({
      tracer,
      templates: { test: { ...TEST, dev, ready: { path: "/", timeoutMs: 500 } } },
      env: () => ({ env: {}, secretValues: ["s3cr3t-value-123"] }),
    });
    const failed: KilnEvent<"studio.preview_failed">[] = [];
    bus.subscribe("studio.preview_failed", (e) => void failed.push(e));
    const p = await app(studio, "safe");
    const { chat } = await studio.newChat(p.id, { by: "me", via: "web" });
    await studio.preview({ chatId: chat.id });
    await waitFor(async () => expect(failed).toHaveLength(1));
    const e = failed[0]!.payload;
    expect(e).toMatchObject({ appId: p.id, chatId: chat.id, port: chat.port, priority: "progress" });
    expect(e.reason).toBe(`the dev server didn't answer GET / on port ${chat.port} within 500 ms`);
    const lines = e.output.split("\n");
    expect(lines).toHaveLength(40);
    expect(lines.slice(-2)).toEqual(["key [redacted]", "boom"]);
    expect(spans.find((s) => s.name === "studio.ready_check")!.error).toBe(e.reason);
  });

  it("publishes studio.preview_failed once when a dev server exits", async () => {
    const { studio, bus } = make({ templates: { test: { ...TEST, dev: "echo 'Error: Cannot find module next'; exit 2" } } });
    const failed: KilnEvent<"studio.preview_failed">[] = [];
    bus.subscribe("studio.preview_failed", (e) => void failed.push(e));
    const p = await app(studio, "safe");
    const v = studio.getApp(p.id)!.versions[0]!;
    await studio.preview({ versionId: v.id });
    await waitFor(async () => expect(failed).toHaveLength(1));
    expect(failed[0]!.payload).toMatchObject({
      appId: p.id,
      versionId: v.id,
      reason: "the dev server exited with code 2",
      output: "Error: Cannot find module next",
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(failed).toHaveLength(1);
  });
});

describe("a failed App", () => {
  it("is set up again on a fresh sandbox when retried", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "kiln-marker-")), "ok");
    const local = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-")));
    let created = 0;
    let destroyed = 0;
    const sandboxes = {
      name: "local",
      create: async (spec: SandboxSpec) => {
        created++;
        const s = await local.create(spec);
        const destroy = s.destroy.bind(s);
        s.destroy = async () => (destroyed++, destroy());
        return s;
      },
      resume: local.resume.bind(local),
    };
    const { studio } = make({ sandboxes, templates: { test: { ...TEST, scaffold: [`test -e ${marker}`, ...TEST.scaffold] } } });
    const p = await app(studio);
    expect(p).toMatchObject({ status: "failed", error: expect.stringContaining(`test -e ${marker} failed`) });
    writeFileSync(marker, "");
    const retried = await studio.retryApp(p.id);
    expect(retried.status).toBe("creating");
    expect(retried.error).toBeUndefined();
    await studio.ready(p.id);
    expect(studio.getApp(p.id)!.app.status).toBe("ready");
    expect(studio.getApp(p.id)!.versions.map((v) => v.title)).toEqual(["Created Daily Done"]);
    expect([created, destroyed]).toEqual([2, 1]);
    await expect(studio.retryApp(p.id)).rejects.toThrow("only a failed app can be retried; this one is ready");
  });

  it("is deleted with its records", async () => {
    const { studio, kiln } = make({ templates: { test: { ...TEST, scaffold: ["exit 1"] } } });
    const p = await app(studio);
    await studio.deleteApp(p.id);
    expect(studio.getApp(p.id)).toBeUndefined();
    expect(kiln.store.list<{ id: string; appId: string }>("studio_versions", (v) => v.appId === p.id)).toEqual([]);
    await expect(studio.deleteApp(p.id)).rejects.toThrow(`unknown app ${p.id}`);
  });

  it("can't be deleted unless it failed", async () => {
    const { studio } = make();
    const p = await app(studio);
    await expect(studio.deleteApp(p.id)).rejects.toThrow("only a failed app can be deleted; this one is ready");
  });
});
