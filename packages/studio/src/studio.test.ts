import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventBus } from "@kiln/events";
import { FakeHarness, type FakeScript } from "@kiln/harness";
import { LocalSandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import { MemoryObjectStore, MemoryStore } from "@kiln/store";
import { afterEach, describe, expect, it } from "vitest";
import { Studio, type StudioOptions } from "./studio";
import type { Template } from "./templates";

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
  dev: `node -e "require('http').createServer((q, s) => s.end('preview ' + process.cwd() + ' ' + (process.env.KILN_STUDIO_PREVIEW_DOMAIN || ''))).listen({port}, '127.0.0.1')"`,
  ready: { path: "/", timeoutMs: 5000 },
  egress: [],
};

/** A scripted agent: "write <file> <text>" writes a file, "ask" asks a question, anything else just answers. */
const agent: FakeScript = async ({ opts, emit }) => {
  const write = async (path: string, text: string) => opts.sandbox.writeFile(`${opts.cwd}/${path}`, text);
  for (const line of opts.prompt.split("\n")) {
    const m = /^write (\S+) (.*)$/.exec(line);
    if (m) {
      await write(m[1]!, `${m[2]}\n`);
      emit({ type: "tool_call", name: "Write", input: { file_path: m[1] } });
    }
    if (line === "delegate") emit({ type: "tool_call", name: "Task", input: { description: "look around" } });
    if (line === "ask") await write(".kiln/studio.json", JSON.stringify({ title: "Asked", summary: "A question.", question: "Text logo or upload one?" }));
    if (line.startsWith("Run `git merge main`"))
      await opts.sandbox.exec("git merge main || (printf 'export const n = 3;\\n' > app.ts && git add -A && git commit -qm resolved)", {
        cwd: opts.cwd,
        trusted: true,
      });
  }
  const title = /^write (\S+)/m.exec(opts.prompt)?.[1];
  if (title) await write(".kiln/studio.json", JSON.stringify({ title: `Changed ${title}`, summary: "Done." }));
  emit({ type: "message", text: "Done." });
  return { summary: "Done." };
};

const studios: Studio[] = [];
let basePort = 20_000 + Math.floor(Math.random() * 20_000);

function make(over: Partial<StudioOptions> = {}) {
  const harness = new FakeHarness(agent);
  const bus = new InMemoryEventBus();
  const studio = new Studio({
    store: new MemoryStore(),
    objects: new MemoryObjectStore(),
    bus,
    clock: new TestClock(),
    sandboxes: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-"))),
    harness: () => harness,
    templates: { test: TEST },
    image: "kiln-runner-studio:test",
    previewUrl: (target, a) => `http://${a.host}:${a.port}/#${target}`,
    basePort: (basePort += 10),
    ...over,
  });
  studios.push(studio);
  return { studio, harness, bus };
}

afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

async function app(studio: Studio, shipMode: "safe" | "review" | "cowboy" = "cowboy") {
  const p = await studio.createApp({ team: "t1", by: "me@x.test", name: "Daily Done", source: { kind: "template", template: "test" }, shipMode });
  await studio.ready(p.id);
  return studio.getApp(p.id)!.app;
}

async function say(studio: Studio, chatId: string, text: string, mode?: "build" | "chat" | "plan") {
  const r = await studio.send(chatId, { by: "me@x.test", via: "web", text, ...(mode ? { mode } : {}) });
  await studio.idle(chatId);
  return studio.getChat(chatId)!.turns.find((t) => t.id === r.turn.id)!;
}

describe("apps", () => {
  it("scaffolds a template app with an initial version on main", async () => {
    const { studio } = make();
    const p = await app(studio);
    expect(p).toMatchObject({ status: "ready", shipMode: "cowboy" });
    expect(p.setup).toMatchObject({ mainBranch: "main", envMissing: [] });
    const { versions } = studio.getApp(p.id)!;
    expect(versions.map((v) => [v.kind, v.title])).toEqual([["initial", "Created Daily Done"]]);
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
    const { studio } = make({ clone: async () => ({ url: origin }), env: () => ({ API_URL: "https://api.test" }) });
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
    expect(studio.updateApp(p.id, { devCommand: "node other.js" }).setup?.dev).toBe("node other.js");
    expect(studio.updateApp(p.id, { devCommand: null }).setup?.dev).toBe("npm run dev");
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
    const slow = new FakeHarness(async ({ nextSteer }) => void (await nextSteer(500)));
    const { studio } = make({ harness: () => slow, maxRunningChats: 1 });
    const p = await app(studio, "safe");
    const a = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    const b = (await studio.newChat(p.id, { by: "me", via: "web" })).chat;
    await studio.send(a.id, { by: "me", via: "web", text: "work" });
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
