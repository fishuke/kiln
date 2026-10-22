import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { createMcpHandler } from "@kiln/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider } from "@kiln/sandbox";
import {
  KilnClient,
  type StudioApp,
  type StudioApplyResult,
  type StudioChat,
  type StudioPreview,
  type StudioStatusReport,
  type StudioToolResult,
  type StudioTurn,
  type StudioVersion,
} from "@kiln/sdk-ts";
import type { App, ApplyResult, Chat, Preview, StatusReport, ToolResult, Turn, Version } from "@kiln/studio";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createApp } from "./app";
import { ROUTES } from "./openapi";
import { configureStudio, studioFor } from "./routes/studio";
import { getPreviewResolver } from "./routes/studio-preview";

const kilns: object[] = [];

function setup() {
  const agent = new FakeHarness(async ({ opts, emit }) => {
    if (opts.prompt.startsWith("write ")) await opts.sandbox.writeFile(`${opts.cwd}/note.txt`, `${opts.prompt}\n`);
    emit({ type: "message", text: "Done." });
  });
  const t = createTestKiln({ preview: false, sandboxes: { local: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-api-studio-"))) } });
  configureStudio(t.kiln, {
    harness: () => agent,
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 30", egress: [] } },
    basePort: 30_000 + Math.floor(Math.random() * 20_000),
  });
  kilns.push(t.kiln);
  const app = createApp(t.kiln, { devAuth: true });
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  const client = new KilnClient({ baseUrl: "http://kiln.test", fetch: inProcess as typeof fetch });
  return { ...t, app, client };
}

afterEach(async () => {
  for (const k of kilns.splice(0)) await studioFor(k as never)?.shutdown();
});

describe("Studio API", () => {
  it("creates an App, chats with it, applies and restores through the SDK", async () => {
    const { client, kiln } = setup();
    const created = await client.studioCreateApp({ name: "Daily Done", source: { kind: "template", template: "test" }, shipMode: "safe" });
    expect(created).toMatchObject({ name: "Daily Done", status: "creating", shipMode: "safe" });
    await studioFor(kiln)!.ready(created.id);
    expect((await client.studioApps()).apps.map((a) => a.id)).toEqual([created.id]);

    const { chat } = await client.studioNewChat(created.id, {});
    const sent = await client.studioSend(chat.id, { text: "write hello" });
    expect(sent.steered).toBe(false);
    await studioFor(kiln)!.idle(chat.id);
    const { turns } = await client.studioChat(chat.id);
    expect(turns[0]).toMatchObject({ status: "succeeded", checkpoint: expect.any(String) });
    expect((await client.studioChatDiff(chat.id)).diff).toContain("+write hello");

    const applied = await client.studioApply(chat.id);
    expect(applied).toMatchObject({ ok: true, version: { kind: "apply" } });
    const { versions } = await client.studioApp(created.id);
    const initial = versions.find((v) => v.kind === "initial")!;
    expect((await client.studioBookmark(initial.id, true)).bookmarked).toBe(true);
    expect(await client.studioRestore(initial.id)).toMatchObject({ kind: "restore", restoredFrom: initial.id });
    expect((await client.studioVersionDiff(initial.id)).diff).toContain("README.md");
    expect((await client.studioStatus()).apps[0]).toMatchObject({ id: created.id, name: "Daily Done" });
    expect(await client.studioUpdateApp(created.id, { shipMode: "cowboy", projectId: "prj_1" })).toMatchObject({ shipMode: "cowboy", projectId: "prj_1" });
  });

  it("runs tools by name and answers bad input with 400", async () => {
    const { client, kiln } = setup();
    const opened = await client.studioTool("open_app", { name: "Voice made", source: { kind: "template", template: "test" } });
    expect(opened).toMatchObject({ ok: true, client: { focus: { app: expect.stringMatching(/^sa_/) } } });
    expect(await client.studioTool("show", { view: "code" })).toEqual({ ok: true, data: null, client: { show: "code" } });
    await studioFor(kiln)!.ready((opened as { client: { focus: { app: string } } }).client.focus.app);
    await expect(client.studioCreateApp({ name: "" })).rejects.toMatchObject({ status: 400 });
    await expect(client.studioTool("teleport", {})).rejects.toMatchObject({ status: 404 });
  });

  it("hides another team's Apps", async () => {
    const { app, kiln } = setup();
    const theirs = await studioFor(kiln)!.createApp({ team: "team_other", by: "x", name: "Theirs", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(theirs.id);
    expect((await app.request(`/api/v1/studio/apps/${theirs.id}`)).status).toBe(404);
    expect((await (await app.request("/api/v1/studio/apps")).json()) as unknown).toEqual({ apps: [] });
    const chat = await studioFor(kiln)!.newChat(theirs.id, { by: "x", via: "api" });
    expect((await app.request(`/api/v1/studio/chats/${chat.chat.id}`)).status).toBe(404);
  });

  it("maps Studio errors to HTTP statuses", async () => {
    const { app } = setup();
    const res = await app.request("/api/v1/studio/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", source: { kind: "template", template: "nope" } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown template nope", code: "invalid" });
  });

  it("serves the Studio tools over MCP with the caller's team", async () => {
    const { kiln } = setup();
    const app = createApp(kiln, { devAuth: true, mcp: createMcpHandler("http://kiln.test", async (input, init) => app.fetch(new Request(input as string, init))) });
    const mcp = new Client({ name: "test", version: "1.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("http://kiln.test/mcp"), {
        fetch: ((input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch,
        requestInit: { headers: { authorization: "Bearer dev" } },
      }),
    );
    const opened = await mcp.callTool({ name: "studio_open_app", arguments: { name: "By MCP", source: { kind: "template", template: "test" } } });
    const result = JSON.parse((opened.content as { text: string }[])[0]!.text) as { ok: boolean; client: { focus: { app: string } } };
    expect(result).toMatchObject({ ok: true, client: { focus: { app: expect.stringMatching(/^sa_/) } } });
    await studioFor(kiln)!.ready(result.client.focus.app);
    const status = await mcp.callTool({ name: "studio_status", arguments: {} });
    expect((status.content as { text: string }[])[0]!.text).toContain("By MCP");
    const bad = await mcp.callTool({ name: "studio_send", arguments: { chat: "sc_nope", text: "hi" } });
    expect((bad.content as { text: string }[])[0]!.text).toContain("unknown chat sc_nope");
  });

  it("keeps the SDK's Studio types assignable from packages/studio's", () => {
    expectTypeOf<App>().toMatchTypeOf<StudioApp>();
    expectTypeOf<Chat>().toMatchTypeOf<StudioChat>();
    expectTypeOf<Turn>().toMatchTypeOf<StudioTurn>();
    expectTypeOf<Version>().toMatchTypeOf<StudioVersion>();
    expectTypeOf<Preview>().toMatchTypeOf<StudioPreview>();
    expectTypeOf<ApplyResult>().toMatchTypeOf<StudioApplyResult>();
    expectTypeOf<StatusReport>().toMatchTypeOf<StudioStatusReport>();
    expectTypeOf<ToolResult>().toMatchTypeOf<StudioToolResult>();
  });

  it("registers the preview resolver and lists its routes in the API reference", () => {
    const { kiln } = setup();
    expect(getPreviewResolver(kiln)).toBe(studioFor(kiln));
    expect(ROUTES.filter((r) => r.path.startsWith("/api/v1/studio/")).length).toBeGreaterThanOrEqual(18);
  });
});
