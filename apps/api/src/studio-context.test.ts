import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { createKilnMcpServer } from "@kiln/mcp";
import { FakeSandboxProvider } from "@kiln/sandbox/testing";
import { KilnClient } from "@kiln/sdk-ts";
import { CONTEXT_TOOL_NAMES, studioEngineHooks, YContextDoc, type ContextSnapshot } from "@kiln/studio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createApp } from "./app";
import { ROUTES } from "./openapi";
import { configureStudio, studioFor } from "./routes/studio";
import { contextFor, contextRepoFiles } from "./routes/studio-context";

const kilns: object[] = [];
type Tool = (name: string, input?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
type Script = (prompt: string, tool: Tool) => Promise<void>;

function setup(script: Script = async () => undefined) {
  let app!: ReturnType<typeof createApp>;
  const calls: { status: number; name: string }[] = [];
  const agent = new FakeHarness(async ({ opts, emit }) => {
    // What the run's Kiln MCP server does with its token: call the API as the run.
    const token = (opts.mcpServers?.[0] as { headers?: Record<string, string> } | undefined)?.headers?.authorization ?? "";
    await script(opts.prompt, async (name, input) => {
      const res = await app.request(`/api/v1/studio/context/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: token }, body: JSON.stringify({ input }) });
      calls.push({ status: res.status, name });
      return (await res.json()) as { ok: boolean };
    });
    emit({ type: "message", text: "Done." });
  });
  const t: ReturnType<typeof createTestKiln> = createTestKiln({
    preview: false,
    publicUrl: "http://kiln.test",
    harness: () => agent,
    sandboxes: { docker: new FakeSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-api-context-"))) },
    ...studioEngineHooks(() => studioFor(t.kiln)),
  });
  configureStudio(t.kiln, { templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 30", egress: [] } }, basePort: 30_000 + Math.floor(Math.random() * 20_000) });
  kilns.push(t.kiln);
  app = createApp(t.kiln, { devAuth: true });
  const client = new KilnClient({ baseUrl: "http://kiln.test", fetch: (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch });
  const studio = () => studioFor(t.kiln)!;
  const make = async () => {
    const created = await client.studioCreateApp({ name: "Recipe box", source: { kind: "template", template: "test" } });
    await studio().ready(created.id);
    return created.id;
  };
  const idle = async (appId: string) => {
    const chat = studio().getApp(appId)!.chats.at(-1);
    if (chat) await studio().idle(chat.id);
  };
  return { ...t, app, client, calls, make, idle, studio };
}

beforeEach(() => vi.stubEnv("KILN_STUDIO", "1"));
afterEach(async () => {
  for (const k of kilns.splice(0)) {
    const s = studioFor(k as never);
    if (s) await contextFor(k as never, s).shutdown();
    await s?.shutdown();
  }
  vi.unstubAllEnvs();
});

const json = (method: string, body: unknown, token?: string) => ({ method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Reads server-sent events from a response until `enough` says so. */
async function events(res: Response, enough: (seen: { event: string; data: string }[]) => boolean) {
  const reader = res.body!.getReader();
  const seen: { event: string; data: string }[] = [];
  let buffer = "";
  while (!enough(seen)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end < 0) break;
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      if (event) seen.push({ event, data: /^data: (.*)$/m.exec(chunk)?.[1] ?? "" });
    }
  }
  await reader.cancel();
  return seen;
}

describe("the Context over the API", () => {
  it("lists its routes with read for GET, and exposes the agent's tools over MCP", async () => {
    const paths = ROUTES.filter((r) => r.path.includes("/context")).map((r) => `${r.method} ${r.path.replace("/api/v1/studio", "")}`);
    expect(paths).toContain("get /apps/{id}/context");
    expect(paths).toContain("post /apps/{id}/context/sync");
    expect(paths).toContain("post /context/tools/{name}");
    expect(ROUTES.filter((r) => r.path.includes("/context") && r.method === "get").every((r) => r.scope === "read")).toBe(true);
    const t = setup();
    const server = createKilnMcpServer(t.client) as unknown as { _registeredTools: Record<string, unknown> };
    for (const name of ["context_read", "context_write", "context_remove", "context_ask", "context_link_preview", "context_mark_built"]) expect(Object.keys(server._registeredTools)).toContain(name);
    expect(CONTEXT_TOOL_NAMES).toHaveLength(6);
  });

  it("serves the snapshot, syncs the document over the stream and the POST, and settles a version", async () => {
    const t = setup();
    const appId = await t.make();
    const snap = (await (await t.app.request(`/api/v1/studio/apps/${appId}/context`)).json()) as ContextSnapshot;
    expect(snap).toMatchObject({ state: { version: 0 }, me: { permission: "owner" }, agent: { state: "idle" } });
    expect(await (await t.app.request(`/api/v1/studio/apps/${appId}/context/export`)).json()).toEqual({ markdown: "(The Context is empty.)", json: null });

    const stream = await t.app.request(`/api/v1/studio/apps/${appId}/context/sync`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const page = new Y.Doc();
    new YContextDoc(page, "page").insert({ type: "requirement", text: "Search by ingredient." }, "end");
    const posted = await t.app.request(`/api/v1/studio/apps/${appId}/context/sync`, json("POST", { update: b64(Y.encodeStateAsUpdate(page)), client: "page-1" }));
    expect(posted.status).toBe(200);
    const seen = await events(stream, (s) => s.some((e) => e.event === "update"));
    expect(seen[0]!.event).toBe("state");
    const update = seen.find((e) => e.event === "update")!;
    expect(JSON.parse(update.data)).toMatchObject({ from: "page-1" });
    const other = new Y.Doc();
    Y.applyUpdate(other, new Uint8Array(Buffer.from((JSON.parse(update.data) as { u: string }).u, "base64")));
    expect(new YContextDoc(other).read().map((b) => b.text)).toEqual(["Search by ingredient."]);

    await contextFor(t.kiln, t.studio()).flush();
    expect(((await (await t.app.request(`/api/v1/studio/apps/${appId}/context`)).json()) as ContextSnapshot).state.version).toBe(1);
    expect(((await (await t.app.request(`/api/v1/studio/apps/${appId}/context/export`)).json()) as { markdown: string }).markdown).toContain("- [requirement] Search by ingredient.");
    const out = (await (await t.app.request(`/api/v1/studio/apps/${appId}/context/export`)).json()) as { markdown: string; json: { version: number; builtVersion: number | null; fragments: { type: string; content: string }[]; questions: unknown[] } };
    expect(out.json).toMatchObject({ version: 1, builtVersion: null, questions: [], fragments: [{ type: "requirement", content: "Search by ingredient." }] });
    // What ships in the repository on a push.
    const kept = contextRepoFiles(await contextFor(t.kiln, t.studio()).export(appId))!;
    expect(Object.keys(kept.files)).toEqual(["docs/context.md", "docs/context.json"]);
    expect(kept.files["docs/context.md"]).toBe(`${out.markdown}\n`);
    expect(JSON.parse(kept.files["docs/context.json"]!)).toEqual(out.json);
    expect(contextRepoFiles(undefined)).toBeUndefined();
    expect((await t.app.request(`/api/v1/studio/apps/${appId}/context/sync`, json("POST", { update: "AQID+g==" }))).status).toBe(400);
    expect((await t.app.request(`/api/v1/studio/apps/sa_nope/context`)).status).toBe(404);
  });

  it("lets an App's run use the Context tools with its own token, as the person who prompted the turn", async () => {
    const t = setup(async (prompt, tool) => {
      if (!prompt.endsWith("recipes")) return;
      expect(await tool("context_read")).toMatchObject({ ok: true, data: { version: 0 } });
      expect(await tool("context_write", { type: "requirement", content: "Search by ingredient.", section: "Requirements" })).toMatchObject({ ok: true });
      expect(await tool("context_ask", { questions: [{ kind: "boolean", title: "Should it work offline?" }] })).toMatchObject({ ok: true, data: { asked: 1 } });
      expect(await tool("context_nope")).toMatchObject({ ok: false });
    });
    const appId = await t.make();
    const res = await t.app.request(`/api/v1/studio/apps/${appId}/context/prompt`, json("POST", { text: "recipes" }));
    expect(res.status).toBe(200);
    await t.idle(appId);
    expect(t.calls).toEqual([
      { status: 200, name: "context_read" },
      { status: 200, name: "context_write" },
      { status: 200, name: "context_ask" },
      { status: 200, name: "context_nope" },
    ]);
    const snap = (await (await t.app.request(`/api/v1/studio/apps/${appId}/context`)).json()) as ContextSnapshot;
    expect(snap.agent.state).toBe("waiting");
    expect(snap.turns.at(-1)).toMatchObject({ status: "needs_you", prompt: "recipes" });
    const state = await contextFor(t.kiln, t.studio()).syncState(appId, { user: snap.me.user, team: t.kiln.teams.ensureDefaultTeam().id, mayWrite: true });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state.update);
    const blocks = new YContextDoc(doc).read();
    expect(blocks.map((b) => b.type)).toEqual(["heading", "requirement", "heading", "question"]);
    expect(blocks[1]!.props).toMatchObject({ by: "agent" });

    // The answer comes in over the API and starts the next turn.
    const questionId = String(blocks[3]!.props.questionId);
    expect((await t.app.request(`/api/v1/studio/apps/${appId}/context/questions/${questionId}/answer`, json("POST", { answer: { type: "value", value: true } }))).status).toBe(200);
    await t.idle(appId);
    expect(((await (await t.app.request(`/api/v1/studio/apps/${appId}/context`)).json()) as ContextSnapshot).turns).toHaveLength(2);
  });

  it("needs an App from a person, and answers a tool's failure as its result", async () => {
    const t = setup();
    expect((await t.app.request("/api/v1/studio/context/tools/context_read", json("POST", {}))).status).toBe(400);
    const res = await t.app.request("/api/v1/studio/context/tools/context_read", json("POST", { app: "sa_nope" }));
    expect(await res.json()).toEqual({ ok: false, error: "App not found" });
    const appId = await t.make();
    expect(await t.client.studioContextTool("mark_built", {}, appId)).toMatchObject({ ok: true, data: { builtVersion: 0 } });
  });
});
