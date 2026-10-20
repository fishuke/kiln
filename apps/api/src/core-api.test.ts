import { issueToken } from "@kiln/auth";
import { createTestKiln, fakeAgentScript, sampleTree, waitFor, type Kiln } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { createMcpHandler } from "@kiln/mcp";
import { KilnClient } from "@kiln/sdk-ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { ROUTES } from "./openapi";

function setup(opts: Parameters<typeof createTestKiln>[0] = {}) {
  const t = createTestKiln({ preview: false, ...opts });
  let app: ReturnType<typeof createApp>;
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  app = createApp(t.kiln, { mcp: createMcpHandler("http://kiln.test", inProcess) });
  const token = (grants: string, subject?: string) =>
    issueToken(t.kiln.store, {
      name: grants,
      subject: subject ?? `${grants.split(":")[0]}@acme.test`,
      grants: grants.split(",").map((g) => {
        const parts = g.split(":");
        const factory = parts.pop()!;
        return { scope: parts.join(":") as never, factory };
      }),
    }).token;
  const client = (tok: string) => new KilnClient({ baseUrl: "http://kiln.test", token: tok, fetch: inProcess as typeof fetch });
  return { ...t, app, token, client, inProcess };
}

const wait = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("uploads and files", () => {
  it("uploads files, attaches them to a task and serves them with Range", async () => {
    const { kiln, token, client, app } = setup();
    const tok = token("read:webapp,send:webapp", "po@acme.test");
    const po = client(tok);
    const up = await po.uploadFiles([{ name: "brief.txt", bytes: new TextEncoder().encode("make it blue"), contentType: "text/plain" }], "webapp");
    expect(up).toMatchObject({ name: "brief.txt", contentType: "text/plain", size: 12 });
    expect(up.key).toMatch(/^uploads\/upl_[a-z0-9]+\/brief\.txt$/);
    const wi = await po.send({ factory: "webapp", title: "Make it blue", attachments: [up.key] });
    expect(wi.attachments).toEqual([expect.objectContaining({ key: up.key })]);
    const file = await po.file(up.key);
    expect(new TextDecoder().decode(file.bytes)).toBe("make it blue");
    const partial = await app.request(`/api/v1/files/${up.key}`, { headers: { authorization: `Bearer ${tok}`, range: "bytes=5-6" } });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("it");
    const outsider = client(token("read:payments"));
    await expect(outsider.file(up.key)).rejects.toMatchObject({ status: 403 });
    await expect(client(token("send:webapp", "other@acme.test")).send({ factory: "payments", title: "x", attachments: [up.key] })).rejects.toBeDefined();
    void kiln;
  });
});

describe("tasks and runs API", () => {
  it("dispatches, lists and patches tasks; lists runs with filters; follows up and reads timelines", async () => {
    const { kiln, token, client } = setup();
    const po = client(token("read:webapp,send:webapp,decide:merge:webapp", "po@acme.test"));
    const d = await po.dispatch("webapp", { prompt: "Fix typo in the footer", ticket_ref: "linear:ENG-9" });
    await waitFor(kiln, d.taskId, ["handed_off"]);
    const page = await po.tasks("webapp", { stage: ["REVIEW"], includeCurrentRun: true });
    expect(page.tasks.map((t) => t.id)).toEqual([d.taskId]);
    expect(page.tasks[0]).toMatchObject({ ticketId: "ENG-9", stage: "REVIEW" });
    expect((await po.taskOutputs("webapp", d.taskId)).outputs.map((o) => o.type)).toContain("PULL_REQUEST");
    const runs = await po.runsPage({ factory: "webapp", state: ["SUCCEEDED"], limit: 1 });
    expect(runs.runs[0]).toMatchObject({ state: "SUCCEEDED", taskStatus: "complete", source: "LINEAR" });
    expect(runs.pageInfo.hasNextPage).toBe(true);
    const next = await po.runsPage({ factory: "webapp", state: ["SUCCEEDED"], limit: 1, cursor: runs.pageInfo.nextCursor });
    expect(next.runs[0]!.id).not.toBe(runs.runs[0]!.id);
    const run = runs.runs[0]!;
    expect((await po.taskByRun("webapp", run.id)).id).toBe(d.taskId);
    expect((await po.runTimeline(run.id)).entries.length).toBeGreaterThan(1);
    expect(await po.runTranscript(run.id)).toContain("## Prompt");
    const f = await po.followup(run.id, "Also update the changelog");
    expect(f.delivered).toBe("continued");
    expect((await po.runByExternalReference(kiln.workflow.get(d.taskId)!.pr!.url)).taskId).toBe(d.taskId);
    const done = await po.updateTask("webapp", d.taskId, { stage: "COMPLETE" });
    expect(done.stage).toBe("COMPLETE");
    expect((await po.errors()).map((e) => e.code)).toContain("budget_exceeded");
  });

  it("run tokens reach only their own task and can spawn allowed subagents", async () => {
    const tree = sampleTree({ "agents/helper/agent.md": "---\nagentType: CUSTOM\nspawnableBy: [implement]\n---\nHelp.\n" });
    let kilnRef!: Kiln;
    const seen: { spawned?: string; denied?: number; foreign?: number; me?: unknown } = {};
    let api!: (tok: string) => KilnClient;
    const harness = new FakeHarness(async (ctx) => {
      const tok = ctx.opts.env?.KILN_RUN_TOKEN;
      if (ctx.opts.env?.KILN_AGENT_TYPE === "IMPLEMENT" && tok && !seen.spawned) {
        const c = api(tok);
        seen.me = await c.me();
        const child = await c.spawn(ctx.opts.env!.KILN_RUN_ID!, { agent: "helper", prompt: "write the tests" });
        seen.spawned = child.id;
        seen.denied = await c.spawn(ctx.opts.env!.KILN_RUN_ID!, { agent: "review", prompt: "x" }).then(() => 200, (e: { status: number }) => e.status);
        seen.foreign = await c.factories().then(() => 200, (e: { status: number }) => e.status);
        return { summary: "spawned" };
      }
      return fakeAgentScript(ctx);
    });
    const s = setup({ tree, harness: () => harness });
    kilnRef = s.kiln;
    api = s.client;
    const sha = kilnRef.defs.require("webapp").appliedSha!;
    const parent = await kilnRef.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "build", push: false });
    expect(seen.spawned).toBeDefined();
    expect(seen.denied).toBe(403);
    expect(seen.foreign).toBe(403);
    expect(seen.me).toMatchObject({ subject: "agent:implement", run: { runId: parent.id } });
    expect(kilnRef.runs.get(seen.spawned!)).toMatchObject({ parentRunId: parent.id, source: "ORCHESTRATION" });
  });
});

describe("inbox, scorers, metrics and definitions API", () => {
  it("marks inbox items read by bare gate id and exposes gate flags", async () => {
    const { kiln, token, client } = setup();
    const po = client(token("read:webapp,send:webapp,decide:spec:webapp", "po@acme.test"));
    const wi = await po.send({ factory: "webapp", title: "Team invites", body: "- Admins invite\n- Invites expire\n- Large redesign" });
    await waitFor(kiln, wi.id, ["awaiting_spec"]);
    const gate = (await po.inbox({ all: true }))[0]!;
    expect(gate).toMatchObject({ read: false, resolved: false });
    expect((await po.markRead([gate.id])).results).toEqual([{ id: gate.id, ok: true }]);
    expect((await po.inbox({ all: true }))[0]).toMatchObject({ read: true });
    const items = await po.inboxItems({ kind: ["spec_review"] });
    expect(items.items[0]).toMatchObject({ gateId: gate.id, isRead: true });
    await po.resolveInbox([gate.id]);
    expect((await po.inboxItems()).items).toHaveLength(0);
  });

  it("scores a run, reads metrics and edits definitions file by file", async () => {
    const { kiln, token, client } = setup();
    const admin = client(token("admin:*"));
    const wi = await admin.send({ factory: "webapp", title: "Fix typo" });
    await waitFor(kiln, wi.id, ["handed_off"]);
    const run = kiln.runs.list({ workItemId: wi.id }).find((r) => r.agent === "implement")!;
    const scored = await admin.scoreRunNow(run.id);
    expect(scored.results[0]).toMatchObject({ scorer: "criteria", status: "dispatched" });
    expect((await admin.scorerResults("webapp", "criteria")).results.length).toBeGreaterThan(0);
    const m = await admin.factoryMetrics("webapp", { groupByPeriod: "week" });
    expect(m).toMatchObject({ prCount: 1 });
    expect((await admin.costBreakdown("webapp", "model")).groups.length).toBeGreaterThan(0);
    expect((await admin.pullRequests("webapp")).pullRequests).toHaveLength(1);
    const files = await admin.files("webapp");
    expect(files.files.map((f) => f.path)).toContain("factory.yaml");
    const r = await admin.request<{ applied?: string }>("POST", "/api/v1/factories/webapp/files:batch", { message: "Add docs agent", changes: [{ path: "agents/docs/agent.md", content: "---\nagentType: CUSTOM\n---\nWrite docs.\n" }] });
    expect(r.applied).toMatch(/^[0-9a-f]{40}$/);
    expect(kiln.defs.current("webapp").agents.docs).toBeDefined();
    const bad = await admin.request("POST", "/api/v1/factories/webapp/files:batch", { message: "Break it", changes: [{ path: "agents/docs/agent.md", content: "---\nagentType: NOPE\n---\n" }] }).catch((e: { status: number }) => e.status);
    expect(bad).toBe(400);
    await admin.putAgent("webapp", "docs", { prompt: "Write better docs.", workerHost: "farm" });
    expect(kiln.defs.current("webapp").agents.docs!.workerHost).toBe("farm");
    expect((await admin.readFile("webapp", "agents/docs/agent.md")).content).toContain("Write better docs.");
    await admin.updateSettings("webapp", { description: "The storefront", benchmarkingModel: "claude-fable-5-1" });
    expect(await admin.settings("webapp")).toMatchObject({ benchmarkingModel: "claude-fable-5-1" });
  });

  it("creates a factory with the wizard and serves schemas and validation without a token", async () => {
    const { app, token, client } = setup();
    const admin = client(token("admin:*"));
    const created = await admin.createFactory({ name: "Docs", repos: [{ owner: "acme", name: "web" }], costPreset: "quality" });
    expect(created.factory?.id).toBe("docs");
    const anonymous = new KilnClient({ baseUrl: "http://kiln.test", fetch: ((i: string, init?: RequestInit) => app.fetch(new Request(i, init))) as typeof fetch });
    const index = await anonymous.schemaVersions();
    expect(index.currentVersion).toBe("v1");
    const res = await app.request("/api/v1/factory-files/schemas/v1/agent.schema.json");
    const etag = res.headers.get("etag")!;
    expect((await app.request("/api/v1/factory-files/schemas/v1/agent.schema.json", { headers: { "if-none-match": etag } })).status).toBe(304);
    const v = await anonymous.validateFiles(Object.entries(sampleTree()).map(([path, content]) => ({ path, content })));
    expect(v.ok).toBe(true);
    expect((await app.request("/api/v1/factories")).status).toBe(401);
  });
});

describe("workers API and MCP", () => {
  it("connects a worker, routes a run to it, and reports Prometheus metrics", async () => {
    const tree = sampleTree({ "agents/remote/agent.md": "---\nagentType: CUSTOM\nworkerHost: farm\n---\nWork remotely.\n" });
    const { kiln, token, client, app } = setup({ tree });
    const w = client(token("worker:*", "worker@acme.test"));
    const rec = await w.workerConnect({ workerId: "farm", backend: "direct", maxConcurrent: 1 });
    const runP = kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "remote", prompt: "do it remotely", push: false });
    const claim = await w.workerClaim(rec.id, 5);
    expect(claim.job).toMatchObject({ agent: "remote", workerHost: "farm" });
    await w.workerEvents(rec.id, claim.job!.runId, [{ type: "started", text: "direct sandbox" }, { type: "message", text: "working" }]);
    await w.workerComplete(rec.id, claim.job!.runId, { outcome: "succeeded", summary: "done remotely", costUsd: 0.5, artifacts: [{ name: "shot.png", contentType: "image/png", base64: Buffer.from("png").toString("base64") }], pushed: [], startRepos: [] });
    const run = await runP;
    expect(run).toMatchObject({ status: "succeeded", summary: "done remotely", workerHost: "farm", costUsd: 0.5 });
    expect(run.artifacts[0]).toMatchObject({ name: "shot.png", kind: "image" });
    expect((await client(token("read:*")).workers()).workers.map((x) => x.workerId)).toEqual(["farm"]);
    const metrics = await (await app.request("/metrics")).text();
    expect(metrics).toContain("kiln_workers_connected 1");
    expect(metrics).toMatch(/kiln_runs_total\{factory="webapp",state="SUCCEEDED"\} 1/);
    await expect(client(token("read:*")).workerConnect({ workerId: "x", backend: "direct" })).rejects.toMatchObject({ status: 403 });
  });

  it("MCP: list_tasks, search_task and get_factory_file_schema", async () => {
    const { kiln, token, inProcess } = setup();
    await kiln.tasks.dispatch("webapp", { prompt: "Fix the nav typo", by: "po@acme.test" });
    const mcp = new Client({ name: "t", version: "1" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL("http://kiln.test/mcp"), { fetch: inProcess as typeof fetch, requestInit: { headers: { authorization: `Bearer ${token("read:*")}` } } }));
    const text = async (name: string, args: Record<string, unknown>) => JSON.parse(((await mcp.callTool({ name, arguments: args })).content as { text: string }[])[0]!.text);
    expect((await text("list_tasks", {})).tasks).toHaveLength(1);
    expect((await text("search_task", { query: "nav" })).tasks[0].title).toBe("Fix the nav typo");
    expect((await text("get_factory_file_schema", {})).documents).toContain("agent.schema.json");
    await wait(() => kiln.workflow.list().every((w) => w.state !== "triaging"));
  });

  it("lists every new route in the OpenAPI document", () => {
    const paths = ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const p of ["post /api/v1/uploads", "post /api/v1/runs/{id}/spawn", "get /api/v1/factories/{id}/tasks", "post /api/v1/factories/{id}/files:batch", "get /api/v1/workers", "post /api/v1/factory-files/validate"]) expect(paths).toContain(p);
  });
});
