import { createHmac } from "node:crypto";
import { issueToken } from "@kiln/auth";
import { createTestKiln, sampleTree, waitFor } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { createMcpHandler } from "@kiln/mcp";
import { KilnApiError, KilnClient } from "@kiln/sdk-ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { openApiDocument, ROUTES } from "./openapi";

function setup() {
  const t = createTestKiln({ preview: false });
  let app: ReturnType<typeof createApp>;
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  app = createApp(t.kiln, { mcp: createMcpHandler("http://kiln.test", inProcess) });
  const token = (grants: string) =>
    issueToken(t.kiln.store, {
      name: grants,
      subject: `${grants.split(":")[0]}@acme.test`,
      grants: grants.split(",").map((g) => {
        const parts = g.split(":");
        const factory = parts.pop()!;
        return { scope: parts.join(":") as never, factory };
      }),
    }).token;
  const client = (tok: string) => new KilnClient({ baseUrl: "http://kiln.test", token: tok, fetch: inProcess as typeof fetch });
  return { ...t, app, token, client, inProcess };
}

describe("API", () => {
  it("rejects requests without a valid token", async () => {
    const { app } = setup();
    expect((await app.request("/api/v1/factories")).status).toBe(401);
    expect((await app.request("/api/v1/factories", { headers: { authorization: "Bearer kiln_tok_000000000000_x" } })).status).toBe(401);
    expect((await app.request("/api/v1/health")).status).toBe(200);
  });

  it("sends work, lists it and decides gates within scope", async () => {
    const { kiln, token, client } = setup();
    const po = client(token("read:webapp,send:webapp,decide:spec:webapp"));
    const wi = await po.send({ factory: "webapp", title: "Team invites", body: "- Admins invite by email\n- Invites expire" });
    await waitFor(kiln, wi.id, ["awaiting_spec"]);
    const inbox = await po.inbox({ all: true });
    expect(inbox[0]).toMatchObject({ kind: "spec", workItem: { id: wi.id, state: "awaiting_spec" } });
    await expect(po.apply(sampleTree(), { factory: "webapp" })).rejects.toMatchObject({ status: 403 });
    await po.decide(inbox[0]!.id, "approve");
    expect((await po.gate(inbox[0]!.id)).state).toBe("approved");
    const detail = await po.workItem(wi.id);
    expect(detail.runs.length).toBeGreaterThan(0);
    expect(detail.decisions.some((d) => d.decision === "triage")).toBe(true);
  });

  it("stopping a task from the work-item route stops the agent run it is running", async () => {
    const harness = new FakeHarness(async (ctx) => {
      if (ctx.opts.prompt.includes("[hold]")) {
        while (!ctx.signal.cancelled) await new Promise((r) => setTimeout(r, 10));
        return { summary: "stopped" };
      }
      return { summary: "done" };
    });
    const t = createTestKiln({ preview: false, harness: () => harness });
    let app: ReturnType<typeof createApp>;
    const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
    app = createApp(t.kiln, { mcp: createMcpHandler("http://kiln.test", inProcess) });
    const token = issueToken(t.kiln.store, {
      name: "po",
      subject: "po@acme.test",
      grants: [
        { scope: "send", factory: "webapp" },
        { scope: "read", factory: "webapp" },
      ],
    }).token;
    const { kiln } = t;
    const d = await kiln.tasks.dispatch("webapp", { prompt: "[hold] Fix the footer", by: "po@acme.test" });
    const live = () => kiln.runQuery.list({ factory: ["webapp"] }).runs.filter((r) => kiln.runs.isActive(r.id));
    for (let i = 0; i < 500 && !live().length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(live().length).toBeGreaterThan(0);

    const res = await app.request(`/api/v1/work-items/${d.taskId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    for (let i = 0; i < 500 && live().length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(live()).toEqual([]);
    expect(kiln.workflow.get(d.taskId)!.state).toBe("cancelled");
  });

  it("retries a spec within the decide:spec scope, on a valid model", async () => {
    const { kiln, token, client } = setup();
    const po = client(token("read:webapp,send:webapp,decide:spec:webapp"));
    const reader = client(token("read:webapp"));
    const wi = await po.send({ factory: "webapp", title: "Team invites", body: "- Admins invite by email\n- Invites expire" });
    await waitFor(kiln, wi.id, ["awaiting_spec"]);
    const [gate] = await po.inbox({ all: true });
    expect(await po.retryOptions(gate!.id)).toMatchObject({ agent: "spec", model: "claude-sonnet-5-5" });
    await expect(reader.retrySpec(gate!.id, "claude-haiku-5-5")).rejects.toMatchObject({ status: 403 });
    await expect(po.retrySpec(gate!.id, "not a model")).rejects.toMatchObject({ status: 400 });
    await expect(po.retrySpec(gate!.id, "router:missing")).rejects.toMatchObject({ status: 400 });
    expect(await po.retrySpec(gate!.id, "claude-haiku-5-5")).toMatchObject({ state: "expired", decision: "retry" });
    await expect(po.retrySpec(gate!.id)).rejects.toMatchObject({ status: 409 });
  });

  it("scopes are per factory", async () => {
    const { token, client } = setup();
    const other = client(token("read:payments,send:payments"));
    expect(await other.factories()).toEqual([]);
    await expect(other.send({ factory: "webapp", title: "x" })).rejects.toBeInstanceOf(KilnApiError);
  });

  it("validates, diffs and applies definitions; a broken tree keeps the last valid one", async () => {
    const { kiln, token, client } = setup();
    const admin = client(token("admin:*"));
    const before = kiln.defs.require("webapp").appliedSha;
    const broken = { ...sampleTree(), "agents/x/agent.md": "---\nagentType: NOPE\n---\n" };
    expect((await admin.validate(broken)).ok).toBe(false);
    await expect(admin.apply(broken)).rejects.toMatchObject({ status: 400 });
    expect(kiln.defs.require("webapp").appliedSha).toBe(before);
    const next = sampleTree({ "agents/docs/agent.md": "---\ndescription: docs\n---\nWrite docs.\n" });
    expect(await admin.diff("webapp", next)).toEqual({ added: ["agent/docs"], changed: [], removed: [] });
    const r = await admin.apply(next, { canaryPercent: 10 });
    expect(r.ok && r.canaryPercent).toBe(10);
  });

  it("verifies GitHub webhook signatures and starts work", async () => {
    const { kiln, app } = setup();
    kiln.secrets.setSecret("GITHUB_WEBHOOK_SECRET", "s3cret");
    const body = JSON.stringify({
      action: "labeled",
      label: { name: "kiln-ready" },
      repository: { full_name: "acme/web" },
      issue: { number: 4, title: "Fix typo", body: "", labels: [{ name: "kiln-ready" }] },
    });
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    const bad = await app.request("/webhooks/github", { method: "POST", body, headers: { "x-github-event": "issues", "x-hub-signature-256": "sha256=00" } });
    expect(bad.status).toBe(401);
    const ok = await app.request("/webhooks/github", {
      method: "POST",
      body,
      headers: { "x-github-event": "issues", "x-hub-signature-256": sig, "x-github-delivery": "d1" },
    });
    expect(((await ok.json()) as { started: unknown[] }).started).toHaveLength(1);
    const again = await app.request("/webhooks/github", {
      method: "POST",
      body,
      headers: { "x-github-event": "issues", "x-hub-signature-256": sig, "x-github-delivery": "d1" },
    });
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("answers Slack URL verification", async () => {
    const { app } = setup();
    const res = await app.request("/webhooks/slack", { method: "POST", body: JSON.stringify({ type: "url_verification", challenge: "abc" }) });
    expect(await res.json()).toEqual({ challenge: "abc" });
  });

  it("checks commands for agents holding a run token", async () => {
    const { kiln, app } = setup();
    const runToken = kiln.secrets.issueRunToken("run_x", ["acme/web"]);
    const check = (command: string, auth = runToken) =>
      app.request("/api/v1/guard", {
        method: "POST",
        body: JSON.stringify({ command }),
        headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      });
    expect(await (await check("rm -rf /")).json()).toEqual({ verdict: "block" });
    expect(await (await check("pnpm test")).json()).toEqual({ verdict: "allow" });
    expect((await check("ls", "nope")).status).toBe(401);
  });

  it("publishes an OpenAPI document covering every route", () => {
    const doc = openApiDocument();
    expect(Object.keys(doc.paths).length).toBe(new Set(ROUTES.map((r) => r.path)).size);
    expect(doc.paths["/api/v1/work-items"]!.post).toMatchObject({ "x-kiln-scope": "send" });
  });
});

describe("Kiln MCP with scoped tokens ", () => {
  async function mcpClient(inProcess: (i: string | URL | Request, init?: RequestInit) => Promise<Response>, token: string) {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://kiln.test/mcp"), {
        fetch: inProcess as typeof fetch,
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  it("lists every Kiln MCP tool", async () => {
    const { token, inProcess } = setup();
    const client = await mcpClient(inProcess, token("read:*"));
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ask_user",
        "complete_task",
        "create_factory",
        "create_team",
        "join_team",
        "list_teams",
        "decide_gate",
        "follow_up_run",
        "get_conversation",
        "get_factory_file_schema",
        "get_gate",
        "get_metrics",
        "get_run",
        "get_task",
        "list_factories",
        "list_forge_repositories",
        "list_inbox",
        "list_notification_routes",
        "list_tasks",
        "list_tracker_scopes",
        "message_foreman",
        "plan_project",
        "propose_definition_change",
        "query_runs",
        "run_agents",
        "search_task",
        "send_task",
        "spawn_agent",
        "steer_run",
        "studio_apply",
        "studio_bookmark",
        "studio_focus",
        "studio_look",
        "studio_new_chat",
        "studio_open_app",
        "studio_restore",
        "studio_send",
        "studio_set_ship_mode",
        "studio_ship",
        "studio_show",
        "studio_status",
        "validate_factory_files",
        "get_app_settings",
        "update_app_settings",
      ].sort(),
    );
  });

  it("a decide:preview token cannot call validate_factory_files with write", async () => {
    const { kiln, token, inProcess } = setup();
    const client = await mcpClient(inProcess, token("read:webapp,decide:preview:webapp"));
    const before = kiln.defs.require("webapp").appliedSha;
    const result = await client.callTool({
      name: "validate_factory_files",
      arguments: { files: sampleTree({ "agents/x/agent.md": "---\ndescription: x\n---\n" }), apply: true, factory: "webapp" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("token lacks definitions:write on webapp");
    expect(kiln.defs.require("webapp").appliedSha).toBe(before);
    const readOnly = await client.callTool({ name: "validate_factory_files", arguments: { files: sampleTree() } });
    expect(readOnly.isError).toBeFalsy();
  });

  it("answers 'cost per merged PR by agent last week' through MCP alone ", async () => {
    const { kiln, forge, token, inProcess } = setup();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    const pr = kiln.workflow.get(wi.id)!.pr!;
    await forge.merge({ owner: "acme", name: "web" }, pr.number, "alice");
    await kiln.workflow.onPullRequestMerged(pr.repo, pr.number, "alice");
    const client = await mcpClient(inProcess, token("read:webapp"));
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const res = await client.callTool({ name: "get_metrics", arguments: { factory: "webapp", since } });
    const metrics = JSON.parse((res.content as { text: string }[])[0]!.text);
    expect(metrics.prsMerged).toBe(1);
    const implement = metrics.byAgent.find((a: { agent: string }) => a.agent === "implement");
    expect(implement.costPerMergedPrUsd).toBeGreaterThan(0);
  });

  it("send_task then get_task by PR URL with start_working", async () => {
    const { kiln, token, inProcess } = setup();
    const client = await mcpClient(inProcess, token("read:webapp,send:webapp"));
    const sent = JSON.parse(
      ((await client.callTool({ name: "send_task", arguments: { factory: "webapp", title: "Fix typo in nav" } })).content as { text: string }[])[0]!.text,
    );
    const wi = await waitFor(kiln, sent.id, ["handed_off"]);
    const got = JSON.parse(
      ((await client.callTool({ name: "get_task", arguments: { reference: wi.pr!.url, start_working: true } })).content as { text: string }[])[0]!.text,
    );
    expect(got.startWorking).toMatchObject({ branch: wi.branch, repo: "acme/web" });
    expect(got.startWorking.commands.join("\n")).toContain("git worktree add");
    expect(got.task).toMatchObject({ id: wi.id, stage: "REVIEW" });
  });
});
