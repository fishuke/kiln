import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventBus } from "@kiln/events";
import { FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider } from "@kiln/sandbox";
import { MemoryObjectStore, MemoryStore } from "@kiln/store";
import { afterEach, describe, expect, it } from "vitest";
import { Studio } from "./studio";
import { runTool, STUDIO_TOOLS } from "./tools";

const caller = { team: "t1", by: "me@x.test", via: "mcp" as const };
const studios: Studio[] = [];

function make() {
  const harness = new FakeHarness(async ({ opts, emit }) => {
    if (opts.prompt.startsWith("write ")) await opts.sandbox.writeFile(`${opts.cwd}/note.txt`, `${opts.prompt}\n`);
    emit({ type: "message", text: "ok" });
  });
  let t = Date.parse("2026-10-22T10:00:00Z");
  const studio = new Studio({
    store: new MemoryStore(),
    objects: new MemoryObjectStore(),
    bus: new InMemoryEventBus(),
    clock: { now: () => new Date((t += 1000)) },
    sandboxes: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-tools-"))),
    harness: () => harness,
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 60", egress: [] } },
    image: "kiln-runner-studio:test",
    previewUrl: (target) => `https://${target}.preview.test`,
  });
  studios.push(studio);
  return studio;
}

afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

describe("studio tools", () => {
  it("names every tool once, with its kind", () => {
    expect(STUDIO_TOOLS.map((t) => `${t.name}:${t.kind}`)).toEqual([
      "status:server",
      "open_app:server",
      "new_chat:server",
      "send:server",
      "apply:server",
      "restore:server",
      "bookmark:server",
      "look:server",
      "ship:server",
      "focus:client",
      "show:client",
    ]);
  });

  it("rejects input that doesn't match the tool's schema, and unknown tools", async () => {
    const studio = make();
    expect(await runTool(studio, "send", { chat: "sc_x" }, caller)).toMatchObject({ ok: false, error: expect.stringContaining("text") });
    expect(await runTool(studio, "teleport", {}, caller)).toEqual({ ok: false, error: "unknown tool teleport" });
  });

  it("opens an app, starts a chat that the screen follows, and reports status", async () => {
    const studio = make();
    const opened = await runTool(studio, "open_app", { name: "Daily Done", source: { kind: "template", template: "test" } }, caller);
    expect(opened).toMatchObject({ ok: true, client: { focus: { app: expect.stringMatching(/^sa_/) } } });
    const appId = (opened as { client: { focus: { app: string } } }).client.focus.app;
    await studio.ready(appId);
    studio.updateApp(appId, { shipMode: "safe" }); // so the person applies
    const chat = await runTool(studio, "new_chat", { app: appId, prompt: "write hello" }, caller);
    expect(chat).toMatchObject({ ok: true, client: { focus: { app: appId, chat: expect.stringMatching(/^sc_/) } } });
    const chatId = (chat as { client: { focus: { chat: string } } }).client.focus.chat;
    await studio.idle(chatId);
    expect(await runTool(studio, "apply", { chat: chatId }, caller)).toMatchObject({ ok: true, data: { ok: true, version: { kind: "apply" } } });
    const status = await runTool(studio, "status", {}, caller);
    expect(status).toMatchObject({ ok: true, data: { apps: [{ id: appId, name: "Daily Done", latest: { title: "ok" } }] } });
    expect(await runTool(studio, "look", { chat: chatId }, caller)).toMatchObject({ ok: true, data: { url: `https://${chatId}.preview.test` } });
  });

  it("hides another team's app", async () => {
    const studio = make();
    const p = await studio.createApp({ team: "t2", by: "x", name: "Theirs", source: { kind: "template", template: "test" } });
    expect(await runTool(studio, "open_app", { app: p.id }, caller)).toEqual({ ok: false, error: `unknown app ${p.id}` });
  });

  it("answers client tools without touching the server", async () => {
    const studio = make();
    expect(await runTool(studio, "focus", { app: "sa_1", chat: "sc_1" }, caller)).toEqual({
      ok: true,
      data: null,
      client: { focus: { app: "sa_1", chat: "sc_1" } },
    });
    expect(await runTool(studio, "show", { view: "history" }, caller)).toEqual({ ok: true, data: null, client: { show: "history" } });
  });
});
