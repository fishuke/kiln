import { jsonSchemaFor, type FileKind } from "@kiln/schema";
import { KilnClient } from "@kiln/sdk-ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/**
 * The Kiln MCP server: tasks, conversations, definitions, decide_gate, list_inbox,
 * plan_project and metrics tools. Every call goes through the API with the caller's token, so
 * per-factory scopes apply: a decide:preview token cannot write definitions.
 */
export function createKilnMcpServer(client: KilnClient): McpServer {
  const server = new McpServer({ name: "kiln", version: "1.0.0" });

  server.registerTool("list_factories", { description: "List the factories this token can see." }, async () => json(await client.factories()));

  server.registerTool(
    "send_task",
    {
      description: "Send work to a factory's foreman. Returns the new task (work item).",
      inputSchema: { factory: z.string(), title: z.string(), body: z.string().optional(), project_id: z.string().optional() },
    },
    async ({ factory, title, body, project_id }) => json(await client.send({ factory, title, body, projectId: project_id, via: "mcp" })),
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task by id or by its PR/issue URL. With start_working=true, returns the branch and clone URL to continue locally.",
      inputSchema: { reference: z.string(), factory_uid: z.string().optional(), start_working: z.boolean().optional() },
    },
    async ({ reference, start_working }) => {
      let id = reference;
      if (!reference.startsWith("wi_")) {
        const items = await client.workItems({});
        const hit = items.find((w) => w.pr?.url === reference || w.source.url === reference || w.trackerKey === reference);
        if (!hit) throw new Error(`no task for ${reference}`);
        id = hit.id;
      }
      return json(start_working ? await client.pull(id) : await client.workItem(id));
    },
  );

  server.registerTool(
    "message_foreman",
    { description: "Message the foreman of a task. Answers its open question if there is one.", inputSchema: { task_id: z.string(), text: z.string() } },
    async ({ task_id, text }) => json(await client.message(task_id, text)),
  );

  server.registerTool(
    "get_conversation",
    { description: "The task's conversation: requests, foreman messages, agent summaries and decisions.", inputSchema: { task_id: z.string() } },
    async ({ task_id }) => json((await client.workItem(task_id)).conversation),
  );

  server.registerTool(
    "complete_task",
    { description: "Hand a locally worked task back, or confirm a handed-off task landed (needs decide:merge).", inputSchema: { task_id: z.string(), note: z.string().optional(), confirm_landed: z.boolean().optional() } },
    async ({ task_id, note, confirm_landed }) => json(confirm_landed ? await client.complete(task_id) : await client.handback(task_id, note ?? "done locally")),
  );

  server.registerTool(
    "get_factory_file_schema",
    {
      description: "JSON Schema for a definition file kind.",
      inputSchema: { kind: z.enum(["factory", "agent", "automation", "pipeline", "gate", "policy", "runner", "router", "scorer", "benchmark-suite", "benchmark-task", "skill", "webhook", "decision", "memory"]) },
    },
    async ({ kind }) => json(jsonSchemaFor(kind as FileKind)),
  );

  server.registerTool(
    "validate_factory_files",
    {
      description: "Validate a definition tree (path → content). With apply=true, applies it (needs definitions:write).",
      inputSchema: { files: z.record(z.string(), z.string()), apply: z.boolean().optional(), factory: z.string().optional(), canary_percent: z.number().optional() },
    },
    async ({ files, apply, factory, canary_percent }) => json(apply ? await client.apply(files, { factory, canaryPercent: canary_percent }) : await client.validate(files)),
  );

  server.registerTool(
    "list_inbox",
    { description: "Open decisions waiting on people: spec approvals, questions, previews, merges.", inputSchema: { all: z.boolean().optional() } },
    async ({ all }) => json(await client.inbox({ all })),
  );

  server.registerTool(
    "decide_gate",
    {
      description: "Approve, reject or answer a gate. Needs the decide scope for the gate's kind.",
      inputSchema: { gate_id: z.string(), decision: z.enum(["approve", "reject", "answer"]), answer: z.string().optional() },
    },
    async ({ gate_id, decision, answer }) => json(await client.decide(gate_id, decision, answer, "mcp")),
  );

  server.registerTool(
    "plan_project",
    { description: "Turn a goal or PRD into a roadmap and tracker issues for a project.", inputSchema: { project_id: z.string(), goal: z.string(), prd: z.string().optional() } },
    async ({ project_id, goal, prd }) => json(await client.plan(project_id, { goal, prd })),
  );

  server.registerTool(
    "get_metrics",
    {
      description: "Factory metrics: PRs opened/merged, autonomy, cycle time, cost, cost per merged PR by agent, scores. `since` is an ISO date.",
      inputSchema: { factory: z.string(), since: z.string().optional(), agent: z.string().optional() },
    },
    async ({ factory, since, agent }) => json(await client.metrics(factory, { since, agent })),
  );

  server.registerTool(
    "query_runs",
    { description: "Raw rows (runs, scores or work_items) for your own analysis.", inputSchema: { factory: z.string(), kind: z.enum(["runs", "scores", "work_items"]), since: z.string().optional() } },
    async ({ factory, kind, since }) => json(await client.rawMetrics(factory, kind, since)),
  );

  server.registerTool(
    "steer_run",
    { description: "Send a steering message to a running agent.", inputSchema: { run_id: z.string(), text: z.string() } },
    async ({ run_id, text }) => json(await client.steer(run_id, text)),
  );

  server.registerTool("list_teams", { description: "List the teams you belong to, with your role in each. Pass a team's slug as X-Kiln-Team to act in it." }, async () => json(await client.teams()));

  server.registerTool(
    "create_team",
    { description: "Create a team. You become its owner. Needs a user token (session or personal API key).", inputSchema: { name: z.string(), slug: z.string().optional() } },
    async ({ name, slug }) => json(await client.createTeam({ name, slug })),
  );

  server.registerTool(
    "join_team",
    { description: "Join a team by accepting an invite. Takes the invite token or the whole invite link.", inputSchema: { invite: z.string() } },
    async ({ invite }) => {
      const token = /kinv_[\w-]+/.exec(invite)?.[0] ?? invite;
      return json(await client.acceptInvite(token));
    },
  );

  return server;
}

/** Stateless streamable-HTTP handler: one server per request, authenticated by the caller's bearer token. */
export function createMcpHandler(apiBaseUrl: string, fetchImpl?: typeof fetch) {
  return async (req: Request): Promise<Response> => {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "a bearer token is required" }), { status: 401, headers: { "content-type": "application/json" } });
    const server = createKilnMcpServer(new KilnClient({ baseUrl: apiBaseUrl, token, fetch: fetchImpl }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}
