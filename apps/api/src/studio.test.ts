import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { studioEngineHooks } from "@kiln/studio";
import { createMcpHandler } from "@kiln/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider } from "@kiln/sandbox";
import {
  KilnClient,
  type StudioApp,
  type StudioAppPullRequest,
  type StudioApplyResult,
  type StudioChat,
  type StudioPreview,
  type StudioStatusReport,
  type StudioToolResult,
  type StudioTurn,
  type StudioVersion,
} from "@kiln/sdk-ts";
import type { App, AppPullRequest, ApplyResult, Chat, Preview, StatusReport, ToolResult, Turn, Version } from "@kiln/studio";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createApp } from "./app";
import { ROUTES } from "./openapi";
import { configureStudio, routes as studioRoutes, studioFor } from "./routes/studio";
import { getPreviewResolver } from "./routes/studio-preview";

const kilns: object[] = [];

function setup() {
  const agent = new FakeHarness(async ({ opts, emit }) => {
    if (opts.prompt.startsWith("write ")) await opts.sandbox.writeFile(`${opts.cwd}/note.txt`, `${opts.prompt}\n`);
    // `rm -` is a command the guard asks a person about.
    if (opts.prompt === "clean up")
      return emit({ type: "message", text: await opts.sandbox.exec("rm -f note.tmp", { cwd: opts.cwd }).then(() => "ran", (e: Error) => e.message) });
    emit({ type: "message", text: "Done." });
  });
  // App turns run through the engine: its hooks answer from the Studio built for this Kiln, as config.ts wires them.
  const t: ReturnType<typeof createTestKiln> = createTestKiln({
    preview: false,
    harness: () => agent,
    sandboxes: { local: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-api-studio-"))) },
    ...studioEngineHooks(() => studioFor(t.kiln)),
  });
  configureStudio(t.kiln, {
    templates: {
      test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 30", egress: [] },
      broken: { id: "broken", name: "Broken", scaffold: ["echo no network >&2; exit 1"], install: [], dev: "sleep 30", egress: [] },
    },
    basePort: 30_000 + Math.floor(Math.random() * 20_000),
  });
  kilns.push(t.kiln);
  const app = createApp(t.kiln, { devAuth: true });
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  const client = new KilnClient({ baseUrl: "http://kiln.test", fetch: inProcess as typeof fetch });
  return { ...t, app, client };
}

beforeEach(() => {
  vi.stubEnv("KILN_STUDIO", "1");
});

afterEach(async () => {
  for (const k of kilns.splice(0)) await studioFor(k as never)?.shutdown();
  vi.unstubAllEnvs();
});

const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe("Studio API", () => {
  it("creates an App, chats with it, applies and restores through the SDK", async () => {
    const { client, kiln } = setup();
    const created = await client.studioCreateApp({ name: "Daily Done", source: { kind: "template", template: "test" } });
    expect(created).toMatchObject({ name: "Daily Done", status: "creating", shipMode: "cowboy" });
    await studioFor(kiln)!.ready(created.id);
    expect((await client.studioApps()).apps.map((a) => a.id)).toEqual([created.id]);

    const { chat } = await client.studioNewChat(created.id, {});
    const sent = await client.studioSend(chat.id, { text: "write hello" });
    expect(sent.steered).toBe(false);
    await studioFor(kiln)!.idle(chat.id);
    const { turns } = await client.studioChat(chat.id);
    expect(turns[0]).toMatchObject({ status: "succeeded", checkpoint: expect.any(String) });
    // A template App is cowboy: the turn is on the main line already.
    expect(await client.studioApply(chat.id)).toEqual({ ok: false, nothing: true });
    const { versions } = await client.studioApp(created.id);
    expect(versions[0]).toMatchObject({ kind: "apply", chatId: chat.id });
    expect((await client.studioVersionDiff(versions[0]!.id)).diff).toContain("+write hello");
    const initial = versions.find((v) => v.kind === "initial")!;
    expect((await client.studioBookmark(initial.id, true)).bookmarked).toBe(true);
    expect(await client.studioRestore(initial.id)).toMatchObject({ kind: "restore", restoredFrom: initial.id });
    expect((await client.studioVersionDiff(initial.id)).diff).toContain("README.md");
    expect((await client.studioStatus()).apps[0]).toMatchObject({ id: created.id, name: "Daily Done" });
    expect(await client.studioUpdateApp(created.id, { projectId: "prj_1" })).toMatchObject({ projectId: "prj_1" });
  });

  it("is off unless the server sets KILN_STUDIO=1", async () => {
    vi.stubEnv("KILN_STUDIO", "");
    const { app, kiln } = setup();
    expect(studioFor(kiln)).toBeUndefined();
    expect(getPreviewResolver(kiln)).toBeUndefined();
    const res = await app.request("/api/v1/studio/apps");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "Studio is not enabled on this server (KILN_STUDIO=1)" });
  });

  it("changes the ship mode only through ship-mode, within the App policy's cap", async () => {
    const { client, kiln } = setup();
    const created = await client.studioCreateApp({ name: "Daily Done", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(created.id);
    expect(await client.studioSetShipMode(created.id, "safe")).toMatchObject({ shipMode: "safe" });
    await client.studioEditDefinition({ app: created.id }, { policy: { maxShipMode: "review" } });
    await expect(client.studioSetShipMode(created.id, "cowboy")).rejects.toThrow(/at most review/);
    expect(kiln.auditLog().find((a) => a.action === "studio.ship_mode_changed")).toMatchObject({ target: created.id, details: { from: "cowboy", to: "safe" } });
  });

  it("ships an App's pull request and shows it with the App", async () => {
    vi.stubEnv("KILN_STUDIO_REPO_OWNER", "acme");
    const { client, kiln, forge } = setup();
    const created = await client.studioCreateApp({ name: "Daily Done", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(created.id);
    await client.studioSetShipMode(created.id, "safe");
    const { chat } = await client.studioNewChat(created.id, { prompt: "write hello" });
    await studioFor(kiln)!.idle(chat.id);
    await client.studioApply(chat.id);
    const pr = await client.studioShip(created.id, { title: "Say hello" });
    expect(pr).toMatchObject({ state: "uat", branch: `studio/${created.id}`, repo: expect.stringMatching(/^acme\/daily-done-/) });
    expect(forge.pulls.map((p) => p.title)).toEqual(["Say hello"]);
    expect((await client.studioApp(created.id)).pullRequest).toMatchObject({ id: pr.id, state: "uat" });
    expect((await client.studioTool("ship", { app: created.id, state: "cancelled" })) as unknown).toMatchObject({ ok: true, data: { state: "cancelled" } });
  });

  it("takes no ship mode from a create or an edit", async () => {
    const { app } = setup();
    expect((await app.request("/api/v1/studio/apps", json("POST", { name: "x", shipMode: "cowboy" }))).status).toBe(400);
  });

  it("imports only repositories in the team's enabled GitHub orgs, through the server's forge", async () => {
    const { app, kiln, forge } = setup();
    forge.createRepo({ owner: "other-org", name: "secret" });
    kiln.teams.updateSettings(kiln.teams.ensureDefaultTeam().id, { githubOrgs: ["acme"] }, "test");
    const outside = { name: "Theirs", source: { kind: "repo", repo: "other-org/secret" } };
    expect((await app.request("/api/v1/studio/apps", json("POST", outside))).status).toBe(403);
    const tool = await app.request("/api/v1/studio/tools/open_app", json("POST", outside));
    expect(tool.status).toBe(403);
    expect(kiln.store.list("studio_apps")).toEqual([]);
    const elsewhere = await app.request("/api/v1/studio/apps", json("POST", { name: "Lab", source: { kind: "repo", repo: "acme/web", connection: "gitlab" } }));
    expect(elsewhere.status).toBe(400);
    expect((await app.request("/api/v1/studio/apps", json("POST", { name: "Ours", source: { kind: "repo", repo: "acme/web" } }))).status).toBe(201);
  });

  it("declares a scope on every route: read to look, send to change", () => {
    const studio = studioRoutes;
    expect(studio.every((r) => r.scope === (r.method === "get" ? "read" : "send"))).toBe(true);
  });

  it("never fills an App's environment from server or team secrets", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server-key-123");
    const { client, kiln, forge } = setup();
    forge.createRepo({ owner: "acme", name: "envy" }, { "package.json": "{}", ".env.example": "ANTHROPIC_API_KEY=\nAPP_NAME=\n" });
    const created = await client.studioCreateApp({ name: "Envy", source: { kind: "repo", repo: "acme/envy" } });
    await studioFor(kiln)!.ready(created.id);
    const { app } = await client.studioApp(created.id);
    expect(app.setup).toMatchObject({ envRequired: ["ANTHROPIC_API_KEY", "APP_NAME"], envMissing: ["ANTHROPIC_API_KEY", "APP_NAME"] });
  });

  it("streams the team's Studio and merge gate events, and no other team's", async () => {
    const { app, client, kiln } = setup();
    const ours = await client.studioCreateApp({ name: "Ours", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(ours.id);
    const theirs = await studioFor(kiln)!.createApp({ team: "team_other", by: "x", name: "Theirs", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(theirs.id);
    const res = await app.request("/api/v1/studio/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const publish = (type: string, payload: Record<string, unknown>) =>
      (kiln.bus as unknown as { publish(t: string, p: unknown): void }).publish(type, payload);
    publish("merge_gate.review_updated", { appId: theirs.id, state: "waiting_for_review" });
    publish("merge_gate.review_updated", { appId: ours.id, state: "waiting_for_review" });
    publish("run.finished", { runId: "run_x", outcome: "succeeded", costUsd: 0 });
    while (!text.includes(ours.id)) text += decoder.decode((await reader.read()).value);
    await reader.cancel();
    expect(text).toContain("event: merge_gate.review_updated");
    expect(text).not.toContain(theirs.id);
    expect(text).not.toContain("run.finished");
  });

  it("streams a chat's events from the bus", async () => {
    const { app, client, kiln } = setup();
    const created = await client.studioCreateApp({ name: "Live", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(created.id);
    const { chat } = await client.studioNewChat(created.id, {});
    const res = await app.request(`/api/v1/studio/chats/${chat.id}/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const read = async (until: (t: string) => boolean) => {
      while (!until(text)) text += decoder.decode((await reader.read()).value);
    };
    await read((t) => t.includes("event: chat"));
    await client.studioSend(chat.id, { text: "write hello" });
    await read((t) => t.includes("event: turn") && t.includes('"status":"succeeded"'));
    await reader.cancel();
  });

  it("shows a command approval on the chat's turn; a person decides it through the gate decision API, a run token can't", async () => {
    const { app, client, kiln } = setup();
    const created = await client.studioCreateApp({ name: "Guarded", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(created.id);
    const { chat } = await client.studioNewChat(created.id, {});
    await client.studioSend(chat.id, { text: "clean up" });
    let waiting: StudioTurn | undefined;
    for (let i = 0; i < 200 && !waiting; i++) {
      waiting = (await client.studioChat(chat.id)).turns.find((t) => t.approval?.state === "waiting");
      if (!waiting) await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting!.approval).toMatchObject({ command: "rm -f note.tmp" });
    expect((await client.studioStatus()).apps[0]!.needsYou).toEqual([{ chatId: chat.id, question: "Allow this command? rm -f note.tmp" }]);

    const runToken = kiln.secrets.issueRunToken(waiting!.runId!, []);
    expect((await app.request(`/api/v1/gates/${waiting!.approval!.gateId}/decide`, json("POST", { decision: "approve" }, runToken))).status).toBe(403);

    await client.decide(waiting!.approval!.gateId, "approve", undefined, "web");
    await studioFor(kiln)!.idle(chat.id);
    const { turns } = await client.studioChat(chat.id);
    expect(turns.at(-1)).toMatchObject({ status: "succeeded", reply: "ran", approval: { state: "allowed", by: "dev@kiln.local" } });
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

  it("retries a failed App and deletes one through the SDK", async () => {
    const { client, kiln } = setup();
    const failed = await client.studioCreateApp({ name: "Broken", source: { kind: "template", template: "broken" } });
    await studioFor(kiln)!.ready(failed.id);
    const { app } = await client.studioApp(failed.id);
    expect(app).toMatchObject({ status: "failed", error: expect.stringContaining("no network") });
    // A failed App answers 503 with what failed.
    await expect(client.studioNewChat(failed.id, {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining("the app failed to start") });

    expect(await client.studioRetryApp(failed.id)).toMatchObject({ id: failed.id, status: "creating" });
    await studioFor(kiln)!.ready(failed.id);
    expect((await client.studioApp(failed.id)).app.status).toBe("failed");
    await client.studioDeleteApp(failed.id);
    expect((await client.studioApps()).apps).toEqual([]);
    await expect(client.studioApp(failed.id)).rejects.toMatchObject({ status: 404 });

    const ready = await client.studioCreateApp({ name: "Fine", source: { kind: "template", template: "test" } });
    await studioFor(kiln)!.ready(ready.id);
    await expect(client.studioDeleteApp(ready.id)).rejects.toMatchObject({ status: 400, message: "only a failed app can be deleted; this one is ready" });
    await expect(client.studioRetryApp(ready.id)).rejects.toMatchObject({ status: 400 });
  });

  it("serves the Studio tools over MCP with the caller's team", async () => {
    const { kiln } = setup();
    const app = createApp(kiln, {
      devAuth: true,
      mcp: createMcpHandler("http://kiln.test", async (input, init) => app.fetch(new Request(input as string, init))),
    });
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
    expectTypeOf<AppPullRequest>().toMatchTypeOf<StudioAppPullRequest>();
  });

  it("registers the preview resolver and lists its routes in the API reference", () => {
    const { kiln } = setup();
    expect(getPreviewResolver(kiln)).toBe(studioFor(kiln));
    expect(ROUTES.filter((r) => r.path.startsWith("/api/v1/studio/")).length).toBeGreaterThanOrEqual(18);
  });
});
