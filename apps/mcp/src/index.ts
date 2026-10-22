import { AppSettingsPatch } from "@kiln/studio";
import { KilnClient, type TaskStage } from "@kiln/sdk-ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const STAGES = ["TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "COMPLETE", "CANCELLED"] as const;
const MODE = z.enum(["normal", "plan", "orchestrate"]);
const SpawnSpec = z.object({ agent: z.string().describe("Agent name in the factory"), prompt: z.string().describe("A complete brief"), title: z.string().optional(), mode: MODE.optional() });

/**
 * The Kiln MCP server. People's coding agents use it to find, take over and hand back tasks and to
 * set up factories; factory agents use it (with their run token) to spawn subagents, ask the
 * requester, propose definition changes and complete tasks. Every call goes through the API with
 * the caller's token, so per-factory scopes apply.
 */
export function createKilnMcpServer(client: KilnClient): McpServer {
  const server = new McpServer({ name: "kiln", version: "1.1.0" });

  /** The calling run, when the token is a run token. */
  const callerRun = async (explicit?: string) => {
    if (explicit) return explicit;
    const me = await client.me();
    const run = (me as { run?: { runId: string } }).run;
    if (!run) throw new Error("pass run_id (only run tokens have a calling run)");
    return run.runId;
  };
  const taskOf = async (taskId: string) => (await client.findTask(taskId)).task;

  // ---- factories and onboarding ----
  server.registerTool("list_factories", { description: "List the factories this token can see." }, async () => json(await client.factories()));

  server.registerTool(
    "list_forge_repositories",
    { description: "Repositories the code forge can reach, for picking a new factory's repos." },
    async () => json(await client.forgeRepositories()),
  );

  server.registerTool(
    "list_tracker_scopes",
    { description: "Teams (Linear) or projects (Jira) of the connected tracker." },
    async () => json(await client.trackerScopes()),
  );

  server.registerTool(
    "create_factory",
    {
      description: "Create a factory: repos, agents to enable (the foreman is always there), Slack, tracker, cost preset, self-improvement and starter automations. Use dry_run first to show the files.",
      inputSchema: {
        name: z.string(),
        alias: z.string().optional(),
        description: z.string().optional(),
        repos: z.array(z.object({ owner: z.string(), name: z.string(), forge: z.enum(["github", "gitlab"]).optional(), deferred: z.boolean().optional() })).min(1),
        agents: z.object({ triage: z.boolean().optional(), spec: z.boolean().optional(), implement: z.boolean().optional(), review: z.boolean().optional() }).optional(),
        slack: z.boolean().optional(),
        tracker: z.enum(["linear", "jira"]).optional(),
        tracker_scopes: z.array(z.string()).optional(),
        cost_preset: z.enum(["quality", "efficient"]).optional(),
        self_improvement: z.boolean().optional(),
        automation_templates: z.array(z.string()).optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async (a) =>
      json(
        await client.createFactory({
          name: a.name,
          alias: a.alias,
          description: a.description,
          repos: a.repos,
          agents: a.agents,
          communications: { slack: a.slack },
          ...(a.tracker ? { tracker: { type: a.tracker, scopes: a.tracker_scopes } } : {}),
          costPreset: a.cost_preset,
          selfImprovement: a.self_improvement,
          automationTemplates: a.automation_templates,
          dryRun: a.dry_run,
        }),
      ),
  );

  server.registerTool(
    "get_factory_file_schema",
    {
      description: "The definition schema catalog, or one document (e.g. agent.schema.json, factory.schema.json).",
      inputSchema: { document: z.string().optional(), version: z.string().optional(), kind: z.string().optional().describe("Older spelling: a file kind such as agent or factory") },
    },
    async ({ document, version, kind }) => {
      const doc = document ?? (kind ? `${kind.replace(/-task$/, "_task").replace(/^benchmark-suite$/, "benchmark_suite").replace(/^benchmark-task$/, "benchmark_suite_task")}.schema.json` : undefined);
      if (!doc) return json({ ...(await client.schemaVersions()), documents: Object.keys((await client.schemaBundle(version)).documents) });
      return json(await client.schemaDocument(doc, version));
    },
  );

  server.registerTool(
    "validate_factory_files",
    {
      description: "Validate a whole definition tree without saving it: diagnostics with file and line, plus what is resolved only when applied. With apply=true and a factory, applies it (definitions:write).",
      inputSchema: {
        files: z.union([z.array(z.object({ path: z.string(), content: z.string() })), z.record(z.string(), z.string())]),
        apply: z.boolean().optional(),
        factory: z.string().optional(),
        canary_percent: z.number().optional(),
      },
    },
    async ({ files, apply, factory, canary_percent }) => {
      const list = Array.isArray(files) ? files : Object.entries(files).map(([path, content]) => ({ path, content }));
      if (apply) return json(await client.apply(Object.fromEntries(list.map((f) => [f.path, f.content])), { factory, canaryPercent: canary_percent }));
      return json(await client.validateFiles(list));
    },
  );

  server.registerTool(
    "propose_definition_change",
    {
      description: "Propose a change to a factory definition (prompts, skills, settings). People review it in the inbox and approve & merge it. Set a file to null to delete it.",
      inputSchema: { factory: z.string(), title: z.string(), message: z.string().optional(), files: z.record(z.string(), z.string().nullable()) },
    },
    async ({ factory, title, message, files }) => json(await client.proposeDefinitionChange(factory, { title, message, files })),
  );

  // ---- tasks ----
  server.registerTool(
    "list_tasks",
    {
      description: "List tasks, newest first. Filter by factory, stage, creator (email) and dates (ISO).",
      inputSchema: { factory: z.string().optional(), stage: z.array(z.enum(STAGES)).optional(), created_by: z.array(z.string()).optional(), created_after: z.string().optional(), created_before: z.string().optional(), limit: z.number().optional(), cursor: z.string().optional() },
    },
    async (a) =>
      json(await client.allTasks({ factory: a.factory, stage: a.stage as TaskStage[] | undefined, createdBy: a.created_by, createdAfter: a.created_after, createdBefore: a.created_before, limit: a.limit, cursor: a.cursor, includeCurrentRun: true })),
  );

  server.registerTool(
    "search_task",
    { description: "Search task titles and descriptions across factories.", inputSchema: { query: z.string(), factory: z.string().optional() } },
    async ({ query, factory }) => json(await client.allTasks({ q: query, factory, limit: 20 })),
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task by id or reference (task or run URL, PR URL, issue URL or key, branch). With start_working=true, also returns git commands to continue it in a local worktree.",
      inputSchema: { reference: z.string(), start_working: z.boolean().optional() },
    },
    async ({ reference, start_working }) => json(await client.findTask(reference, start_working)),
  );

  server.registerTool(
    "send_task",
    {
      description: "Send new work to a factory's foreman (factory, title, note), or hand a task you worked on locally back (task_id, branch or pr_url, note).",
      inputSchema: {
        factory: z.string().optional(),
        title: z.string().optional(),
        note: z.string().optional(),
        body: z.string().optional(),
        mode: MODE.optional(),
        attachments: z.array(z.string()).optional().describe("Upload keys from /api/v1/uploads"),
        task_id: z.string().optional(),
        branch: z.string().optional(),
        pr_url: z.string().optional(),
        correlation_key: z.string().optional().describe("An incident id or alert fingerprint: reports with the same key join one task"),
      },
    },
    async (a) => {
      if (a.task_id) return json(await client.handbackTask(a.task_id, { note: a.note ?? a.body ?? "Handed back", branch: a.branch, prUrl: a.pr_url }));
      if (!a.factory || !a.title) throw new Error("pass factory and title for new work, or task_id to hand a task back");
      return json(await client.send({ factory: a.factory, title: a.title, body: a.note ?? a.body, via: "mcp", attachments: a.attachments, mode: a.mode, correlationKey: a.correlation_key }));
    },
  );

  server.registerTool(
    "message_foreman",
    { description: "Message the foreman of a task. Answers its open question if there is one.", inputSchema: { task_id: z.string(), text: z.string(), attachments: z.array(z.string()).optional() } },
    async ({ task_id, text, attachments }) => json(await client.message(task_id, text, attachments)),
  );

  server.registerTool(
    "get_conversation",
    { description: "A task's conversation (requests, foreman messages, agent summaries, decisions), or a run's normalized conversation.", inputSchema: { task_id: z.string().optional(), run_id: z.string().optional() } },
    async ({ task_id, run_id }) => {
      if (run_id) return json(await client.runConversation(run_id));
      if (!task_id) throw new Error("pass task_id or run_id");
      return json((await client.workItem(task_id)).conversation);
    },
  );

  server.registerTool(
    "list_notification_routes",
    { description: "Where updates about a task go: the originating thread, issue or PR.", inputSchema: { task_id: z.string() } },
    async ({ task_id }) => {
      const wi = await client.workItem(task_id);
      const routes = [
        ...(wi.source.channel ? [{ kind: `${wi.source.provider}_thread`, target: `${wi.source.channel}${wi.source.thread ? `/${wi.source.thread}` : ""}`, url: wi.source.url }] : []),
        ...(wi.trackerKey ? [{ kind: `${wi.source.provider}_issue`, target: wi.trackerKey, url: wi.source.url }] : []),
        ...(wi.source.repo && wi.source.number ? [{ kind: "github_issue", target: `${wi.source.repo}#${wi.source.number}`, url: wi.source.url }] : []),
        ...(wi.pr ? [{ kind: "pull_request", target: `${wi.pr.repo}#${wi.pr.number}`, url: wi.pr.url }] : []),
      ];
      return json({ routes });
    },
  );

  server.registerTool(
    "complete_task",
    {
      description: "Close a task. Safe to call more than once. A factory agent may close it only after its pull request merged; a person (decide:merge) confirms completion. Pass task_id, or run_id to find the task.",
      inputSchema: { task_id: z.string().optional(), run_id: z.string().optional() },
    },
    async ({ task_id, run_id }) => {
      const id = task_id ?? (await client.findTask(await callerRun(run_id))).task.id;
      const task = await taskOf(id);
      return json(await client.completeTask(task.factory, id));
    },
  );

  // ---- runs and subagents ----
  server.registerTool(
    "spawn_agent",
    {
      description: "Start a subagent of your factory for part of the work. Returns at once with the child run; follow it with get_run. Only agents whose spawnableBy allows you can be started.",
      inputSchema: { run_id: z.string().optional().describe("Your run id; defaults to the calling run"), ...SpawnSpec.shape, wait: z.boolean().optional() },
    },
    async ({ run_id, wait, ...spec }) => json(await client.spawn(await callerRun(run_id), { ...spec, wait })),
  );

  server.registerTool(
    "run_agents",
    {
      description: "Start several subagents at once (fan out). Returns their runs.",
      inputSchema: { run_id: z.string().optional(), runs: z.array(SpawnSpec).min(1).max(10), wait: z.boolean().optional() },
    },
    async ({ run_id, runs, wait }) => json(await client.runAgents(await callerRun(run_id), runs, wait)),
  );

  server.registerTool(
    "get_run",
    { description: "A run's state, summary, result, artifacts and children. With conversation=true, its messages too.", inputSchema: { run_id: z.string(), conversation: z.boolean().optional() } },
    async ({ run_id, conversation }) => json({ run: await client.run(run_id), ...(conversation ? { conversation: (await client.runConversation(run_id)).messages } : {}) }),
  );

  server.registerTool(
    "ask_user",
    {
      description: "Ask the requester a question and get a gate id; read the answer with get_gate. Questions can be single or multi select with a recommended option.",
      inputSchema: {
        run_id: z.string().optional(),
        title: z.string(),
        question: z.string().optional(),
        questions: z.array(z.object({ id: z.string(), question: z.string(), type: z.enum(["single_select", "multi_select"]), options: z.array(z.string()).min(2), recommendedOptionIndex: z.number().optional() })).optional(),
      },
    },
    async ({ run_id, ...q }) => json(await client.ask(await callerRun(run_id), q)),
  );

  server.registerTool("get_gate", { description: "A gate (decision) and its answer.", inputSchema: { gate_id: z.string() } }, async ({ gate_id }) => json(await client.gate(gate_id)));

  server.registerTool(
    "follow_up_run",
    { description: "Send a follow-up to a run: steers it while it runs, continues it when it finished.", inputSchema: { run_id: z.string(), message: z.string() } },
    async ({ run_id, message }) => json(await client.followup(run_id, message)),
  );

  server.registerTool(
    "steer_run",
    { description: "Send a steering message to a running agent.", inputSchema: { run_id: z.string(), text: z.string() } },
    async ({ run_id, text }) => json(await client.steer(run_id, text)),
  );

  // ---- inbox, planning, metrics ----
  server.registerTool(
    "list_inbox",
    { description: "Your inbox: questions, spec and PR reviews, blocked and failed tasks, definition changes. all=true lists the team's.", inputSchema: { all: z.boolean().optional(), kind: z.array(z.enum(["question", "answer_question", "spec_review", "pr_review", "blocked", "failed"])).optional() } },
    async ({ all, kind }) => json(await client.inboxItems({ scope: all ? "team" : "mine", kind })),
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
      description:
        "Factory metrics: PRs opened and merged, autonomy, cycle time, cost and cost per merged PR by agent (`since`), plus the autonomy funnel, PR latency medians, human interactions and period-over-period deltas (`start_date`, `end_date`, `group_by_period`). Dates are ISO.",
      inputSchema: { factory: z.string(), since: z.string().optional(), agent: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional(), group_by_period: z.enum(["day", "week", "month"]).optional() },
    },
    async ({ factory, since, agent, start_date, end_date, group_by_period }) => {
      const summary = await client.metrics(factory, { since, agent });
      const detail = await client.factoryMetrics(factory, { startDate: start_date ?? since, endDate: end_date, groupByPeriod: group_by_period });
      return json({ ...summary, detail });
    },
  );

  server.registerTool(
    "query_runs",
    {
      description: "Runs with filters: factory, state (QUEUED…CANCELLED), source, agent, q, created_after. Or raw rows (runs, scores, work_items) with kind.",
      inputSchema: { factory: z.string(), kind: z.enum(["runs", "scores", "work_items"]).optional(), since: z.string().optional(), state: z.array(z.string()).optional(), source: z.array(z.string()).optional(), agent: z.string().optional(), q: z.string().optional() },
    },
    async ({ factory, kind, since, state, source, agent, q }) =>
      json(kind ? await client.rawMetrics(factory, kind, since) : await client.runsPage({ factory, state: state as never, source, agent, q, createdAfter: since, limit: 100 })),
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

  // ---- Studio App definitions ----
  server.registerTool(
    "get_app_settings",
    { description: "A Studio App's definition: its agents (model, MCP servers, skills), shared skills (mandatory ones marked), ship mode cap, merge gate and budget, resolved from team and project defaults, plus what the App sets itself.", inputSchema: { app: z.string() } },
    async ({ app }) => json(await client.studioSettings({ app })),
  );

  server.registerTool(
    "update_app_settings",
    { description: "Change a Studio App's own definition layer. null removes the App's value so it inherits from its project or team again. Every change is a new version.", inputSchema: { app: z.string(), patch: AppSettingsPatch } },
    async ({ app, patch }) => json(await client.studioEditDefinition({ app }, patch)),
  );

  return server;
}

/**
 * Stateless streamable-HTTP handler: one server per request, authenticated by the caller's bearer token.
 * With `resourceMetadata`, a missing or rejected token gets a 401 that points MCP clients at Kiln's
 * OAuth server, so they can sign the person in through the browser.
 */
export function createMcpHandler(apiBaseUrl: string, fetchImpl?: typeof fetch, opts: { resourceMetadata?: string } = {}) {
  const unauthorized = (error: string) =>
    new Response(JSON.stringify({ error }), { status: 401, headers: { "content-type": "application/json", ...(opts.resourceMetadata ? { "www-authenticate": `Bearer resource_metadata="${opts.resourceMetadata}"` } : {}) } });
  return async (req: Request): Promise<Response> => {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return unauthorized("a bearer token is required");
    // X-Kiln-Team on the MCP connection picks the team the tools act in.
    const client = new KilnClient({ baseUrl: apiBaseUrl, token, fetch: fetchImpl, team: req.headers.get("x-kiln-team") ?? undefined });
    // Expired or revoked tokens answer 401 at the HTTP level, so clients sign in again.
    if (opts.resourceMetadata && req.method === "POST" && !(await client.me().then(() => true, (e: { status?: number }) => e.status !== 401))) return unauthorized("the token is invalid or expired");
    const server = createKilnMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}
