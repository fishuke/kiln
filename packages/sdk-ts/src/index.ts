import type {
  ApplyResult,
  Attachment,
  ApprovalLink,
  AutomationTemplate,
  CheckOutcome,
  Connection,
  EventDelivery,
  NotificationRoute,
  WebhookDelivery,
  WebhookSource,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkTrial,
  ConfigSummary,
  ConversationMessage,
  DefinitionChange,
  DefinitionRecord,
  DeferredResolution,
  Diagnostic,
  FactoryBinding,
  FactoryMetrics,
  Gate,
  GateQuestion,
  InboxItem,
  Memory,
  PrRecord,
  Project,
  Proposal,
  Roadmap,
  Run,
  RunEvent,
  RunMode,
  RunState,
  RunView,
  Score,
  SkillListing,
  TaskOutput,
  TaskStage,
  TaskView,
  TimelineEntry,
  WorkerControl,
  WorkerEvent,
  WorkerJob,
  WorkerRecord,
  WorkerResult,
  WorkItem,
  WriteResult,
} from "@kiln/engine";
import type {
  ApiKeyRow,
  Appearance,
  BuiltinMcpRow,
  EnvironmentInput,
  EnvironmentTemplate,
  FactoryMember,
  FactoryMemberRow,
  FactoryRole,
  InviteRow,
  IssuedInvite,
  LinkedAccount,
  LinkProvider,
  McpServer,
  McpServerInput,
  Me,
  Membership,
  ModelKeyProvider,
  PoolEntry,
  ChatgptSignIn,
  NotificationPrefs,
  NotificationRecord,
  PublicUser,
  SecretMeta,
  SecretType,
  Session,
  TeamDetail,
  TeamMemberRow,
  TeamRole,
  TeamSettings,
  TeamSummary,
  UsageEntry,
  UsageSummary,
} from "./platform";

export type * from "./platform";

export type {
  ApplyResult,
  Attachment,
  ApprovalLink,
  AutomationTemplate,
  CheckOutcome,
  Connection,
  EventDelivery,
  NotificationRoute,
  WebhookDelivery,
  WebhookSource,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkTrial,
  ConfigSummary,
  ConversationMessage,
  DefinitionChange,
  DefinitionRecord,
  DeferredResolution,
  Diagnostic,
  FactoryBinding,
  FactoryMetrics,
  Gate,
  GateQuestion,
  InboxItem,
  Memory,
  PrRecord,
  Project,
  Proposal,
  Roadmap,
  Run,
  RunEvent,
  RunMode,
  RunState,
  RunView,
  Score,
  SkillListing,
  TaskOutput,
  TaskStage,
  TaskView,
  TimelineEntry,
  WorkerControl,
  WorkerEvent,
  WorkerJob,
  WorkerRecord,
  WorkerResult,
  WorkItem,
  WriteResult,
};

export type PageInfo = { hasNextPage: boolean; nextCursor?: string };
export type RunPage = { runs: RunView[]; pageInfo: PageInfo };
export type TaskPage = { tasks: TaskView[]; pageInfo: PageInfo };
export type RangeOpts = { startDate?: string; endDate?: string; groupByPeriod?: "day" | "week" | "month" };
export type RunFilterOpts = {
  factory?: string;
  workItem?: string;
  agent?: string;
  kind?: string;
  limit?: number;
  cursor?: string;
  state?: RunState[];
  taskStatus?: ("running" | "failed" | "blocked" | "cancelled" | "complete")[];
  source?: string[];
  factoryUid?: string[];
  ancestorRunId?: string;
  artifactType?: string;
  q?: string;
  creator?: string;
  mine?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  metadata?: Record<string, string>;
  sortBy?: "created_at" | "updated_at" | "title" | "agent";
  sortOrder?: "asc" | "desc";
};
export type TaskFilterOpts = {
  stage?: TaskStage[];
  createdBy?: string[];
  q?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  sortBy?: "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  includeCurrentRun?: boolean;
};
export type CreateFactoryInput = {
  name: string;
  alias?: string;
  description?: string;
  avatar?: string;
  repos: { owner: string; name: string; forge?: "github" | "gitlab"; deferred?: boolean }[];
  agents?: { triage?: boolean; spec?: boolean; implement?: boolean; review?: boolean };
  communications?: { slack?: boolean };
  tracker?: { type: "linear" | "jira"; scopes?: string[] };
  costPreset?: "quality" | "efficient";
  harness?: "claude-code" | "codex" | "opencode" | "gemini" | "pi";
  selfImprovement?: boolean;
  automationTemplates?: string[];
  runner?: { image?: string; setupCommands?: string[] };
  workerHost?: string;
  dryRun?: boolean;
};
export type ScorerInput = {
  name: string;
  slug?: string;
  description?: string;
  scoringPrompt: string;
  classifications: { value: string; score: number; description?: string }[];
  threshold: number;
  scopeMode: "all_agents" | "selected_agents";
  agents?: (string | { name: string; includeDescendants?: boolean })[];
  samplingRate?: number;
  model: string;
  selfImprovementEnabled?: boolean;
};
export type ValidateFilesResult = { ok: boolean; schemaVersion: string; diagnostics: Diagnostic[]; deferredResolutions: DeferredResolution[] };
export type SpawnInput = { agent: string; prompt: string; title?: string; mode?: RunMode; attachments?: (string | Attachment)[]; metadata?: Record<string, string>; wait?: boolean };

export class KilnApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export type FactorySummary = FactoryBinding & { description?: string; repositories: { owner: string; name: string }[]; agents: number; openGates: number };
export type FactoryDetail = {
  factory: FactoryBinding;
  definition: Record<string, any>;
  agents: { name: string; agentType: string; description?: string; instructions: string; harness: { type: string; model?: string }; runner?: string; skills: string[] }[];
  automations: { name: string; agent: string; enabled: boolean; prompt: string; triggers: { provider: string; event: string; filter?: Record<string, unknown>; schedule?: { cron: string; name?: string } }[] }[];
  pipelines: Record<string, { stages: Record<string, unknown>[] }>;
  gates: Record<string, Record<string, unknown>>;
  policies: Record<string, Record<string, unknown>>;
  runners: Record<string, Record<string, unknown>>;
  routers: Record<string, Record<string, unknown>>;
  scorers: Record<string, { name: string; agents: string[]; labels: { value: string; score: number; description?: string }[]; passingScore: number; samplingRate: number; model: string; selfImprovement: boolean; rubric: string }>;
  benchmarks: Record<string, { name: string; agent: string; configurations: { name: string }[]; tasks: string[] }>;
  skills: Record<string, { name: string; description: string; owner?: string; version?: string; body: string }>;
  decisions: Record<string, Record<string, unknown>>;
  memories: Record<string, { title: string; body: string; tags: string[] }>;
  warnings: { file: string; line: number; message: string }[];
};
export type WorkItemListRow = Omit<WorkItem, "conversation"> & { messages: number };
export type WorkItemDetail = WorkItem & { runs: Run[]; gates: Gate[]; decisions: { decision: string; action: string; provider: string; at: string }[] };
/** A row of GET /api/v1/inbox: an open gate and its work item. */
/** What a spec retry can run on: the spec agent's harness and configured model, the factory's routers and the model that wrote the spec. */
export type SpecRetryOptions = { gateId: string; agent: string; harness: string; model?: string; routers: string[]; writtenWith?: string };
export type GateInboxItem = Gate & { workItem?: Pick<WorkItem, "id" | "title" | "state" | "factory" | "pr" | "previewUrl" | "spec"> };
export type Portfolio = {
  projects: { project: Project; factories: FactoryMetrics[]; totals: { prsOpened: number; prsMerged: number; costUsd: number; activeWorkItems: number; pendingDecisions: number } }[];
  totals: { factories: number; prsMerged: number; costUsd: number; activeWorkItems: number };
};
export type CatalogRow = { name: string; description: string; owner: string; version: string; factories: string[]; usage: number; listingId?: string };

export class KilnClient {
  constructor(
    private readonly options: { baseUrl: string; token?: string; fetch?: typeof fetch; headers?: Record<string, string>; /** Team id or slug sent as X-Kiln-Team. */ team?: string },
  ) {}

  /** The same client acting in another team (X-Kiln-Team). */
  withTeam(team: string): KilnClient {
    return new KilnClient({ ...this.options, team });
  }

  /** The same client with another token, e.g. after login. */
  withToken(token: string): KilnClient {
    return new KilnClient({ ...this.options, token });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined && !form ? { "content-type": "application/json" } : {}),
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        ...(this.options.team ? { "x-kiln-team": this.options.team } : {}),
        ...this.options.headers,
      },
      body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
      cache: "no-store",
    } as RequestInit);
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    if (!res.ok) throw new KilnApiError(res.status, (data as { error?: string })?.error ?? `${method} ${path} returned ${res.status}`, data);
    return data as T;
  }

  /** Raw text responses (transcripts, Prometheus metrics). */
  async text(path: string): Promise<string> {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, { headers: { ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}), ...this.options.headers }, cache: "no-store" } as RequestInit);
    const body = await res.text();
    if (!res.ok) throw new KilnApiError(res.status, body || `GET ${path} returned ${res.status}`);
    return body;
  }

  private q(params: Record<string, string | number | boolean | string[] | undefined>) {
    const s = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v))}`)
      .join("&");
    return s ? `?${s}` : "";
  }

  private f = (id: string) => `/api/v1/factories/${encodeURIComponent(id)}`;
  private range = (o: RangeOpts = {}) => ({ start_date: o.startDate, end_date: o.endDate, group_by_period: o.groupByPeriod });

  health = () => this.request<{ ok: boolean; factories: number }>("GET", "/api/v1/health");
  me = () => this.request<Me>("GET", "/api/v1/me");

  factories = () => this.request<FactorySummary[]>("GET", "/api/v1/factories");
  factory = (id: string) => this.request<FactoryDetail>("GET", `/api/v1/factories/${encodeURIComponent(id)}`);
  definition = (id: string, sha?: string) => this.request<{ sha: string; tree: Record<string, string>; canary?: FactoryBinding["canary"]; previousSha?: string }>("GET", `/api/v1/factories/${encodeURIComponent(id)}/definition${this.q({ sha })}`);
  validate = (tree: Record<string, string>) => this.request<{ ok: boolean; sha: string; errors?: string[]; warnings?: string[] }>("POST", "/api/v1/definitions/validate", { tree });
  diff = (factory: string, tree: Record<string, string>) => this.request<{ added: string[]; changed: string[]; removed: string[] }>("POST", "/api/v1/definitions/diff", { factory, tree });
  apply = (tree: Record<string, string>, opts: { factory?: string; canaryPercent?: number; dryRun?: boolean } = {}) => this.request<ApplyResult>("POST", "/api/v1/definitions/apply", { tree, ...opts });
  connect = (repo: { owner: string; name: string; ref?: string; dir?: string }) => this.request<ApplyResult>("POST", "/api/v1/factories/connect", repo);
  sync = (id: string) => this.request<ApplyResult>("POST", `/api/v1/factories/${encodeURIComponent(id)}/sync`);
  canary = (id: string, action: "promote" | "rollback") => this.request<FactoryBinding>("POST", `/api/v1/factories/${encodeURIComponent(id)}/canary/${action}`);

  workItems = (filter: { factory?: string; state?: string; project?: string } = {}) => this.request<WorkItemListRow[]>("GET", `/api/v1/work-items${this.q(filter)}`);
  workItem = (id: string) => this.request<WorkItemDetail>("GET", `/api/v1/work-items/${id}`);
  send = (input: { factory: string; title: string; body?: string; projectId?: string; pipeline?: string; budgetUsd?: number; via?: "api" | "kiln" | "mcp" | "cli"; attachments?: (string | Attachment)[]; mode?: RunMode; correlationKey?: string; dedupe?: boolean }) =>
    this.request<WorkItem>("POST", "/api/v1/work-items", input);
  message = (id: string, text: string, attachments?: (string | Attachment)[]) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/messages`, { text, ...(attachments?.length ? { attachments } : {}) });
  cancel = (id: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/cancel`);
  complete = (id: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/complete`);
  pull = (id: string) => this.request<{ workItem: WorkItem; branch: string; cloneUrl: string; repo: string; brief: string }>("POST", `/api/v1/work-items/${id}/pull`);
  handback = (id: string, text: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/handback`, { text });

  /** Runs matching the filter (one page; use runsPage for cursors). */
  runs = async (filter: RunFilterOpts = {}) => (await this.runsPage(filter)).runs;
  runsPage = (filter: RunFilterOpts = {}) => {
    const { factoryUid, taskStatus, ancestorRunId, artifactType, createdAfter, createdBefore, updatedAfter, sortBy, sortOrder, metadata, mine, ...rest } = filter;
    const meta = Object.fromEntries(Object.entries(metadata ?? {}).map(([k, v]) => [`metadata[${k}]`, v]));
    return this.request<RunPage>(
      "GET",
      `/api/v1/runs${this.q({ ...rest, factory_uid: factoryUid, task_status: taskStatus, ancestor_run_id: ancestorRunId, artifact_type: artifactType, created_after: createdAfter, created_before: createdBefore, updated_after: updatedAfter, sort_by: sortBy, sort_order: sortOrder, mine: mine ? "true" : undefined, ...meta })}`,
    );
  };
  run = (id: string) => this.request<RunView & { live: boolean; scores: Score[] }>("GET", `/api/v1/runs/${id}`);
  startRun = (input: { factory: string; prompt: string; agent?: string; title?: string; mode?: RunMode; attachments?: (string | Attachment)[]; metadata?: Record<string, string>; model?: string; workerHost?: string | null; idleTimeoutMinutes?: number; branch?: string; source?: "API" | "CLI" | "WEB_APP" | "MCP" }) =>
    this.request<RunView>("POST", "/api/v1/agent-runs", input);
  runTimeline = (id: string) => this.request<{ entries: TimelineEntry[] }>("GET", `/api/v1/runs/${id}/timeline`);
  runConversation = (id: string) => this.request<{ runId: string; messages: ConversationMessage[] }>("GET", `/api/v1/runs/${id}/conversation`);
  runTranscript = (id: string) => this.text(`/api/v1/runs/${id}/transcript`);
  runScores = (id: string) => this.request<{ scores: (Record<string, unknown> & { scorer: string; classification: string; score: number; outcome: "pass" | "fail" })[] }>("GET", `/api/v1/runs/${id}/scores`);
  followup = (id: string, message: string, opts: { attachments?: (string | Attachment)[]; mode?: RunMode } = {}) => this.request<{ delivered: "steered" | "continued"; run: RunView }>("POST", `/api/v1/runs/${id}/followups`, { message, ...opts });
  scoreRunNow = (id: string, scorers?: string[]) => this.request<{ results: { runId: string; scorer: string; status: string }[]; scores: Record<string, unknown>[] }>("POST", `/api/v1/runs/${id}/score`, scorers ? { scorers } : {});
  interrupt = (id: string) => this.request<{ ok: true }>("POST", `/api/v1/runs/${id}/interrupt`);
  spawn = (id: string, input: SpawnInput) => this.request<RunView>("POST", `/api/v1/runs/${id}/spawn`, input);
  runAgents = (id: string, runs: Omit<SpawnInput, "wait">[], wait?: boolean) => this.request<{ runs: RunView[] }>("POST", `/api/v1/runs/${id}/run-agents`, { runs, wait });
  ask = (id: string, input: { title: string; question?: string; questions?: GateQuestion[] }) => this.request<Gate>("POST", `/api/v1/runs/${id}/questions`, input);
  shareRun = (id: string, publicAccess: "VIEWER" | "EDITOR" | null) => this.request<RunView>("PUT", `/api/v1/runs/${id}/sharing`, { publicAccess });
  runByExternalReference = (url: string) => this.request<RunView>("GET", `/api/v1/run-by-external-reference${this.q({ url })}`);
  errors = () => this.request<{ code: string; http: number; retryable: boolean | "automatic"; taskState: "FAILED" | "ERROR"; title: string }[]>("GET", "/api/v1/errors");

  // files
  uploadFiles = async (files: { name: string; bytes: Uint8Array | Blob; contentType?: string }[], factory?: string) => {
    const form = new FormData();
    for (const f of files) form.append("files", f.bytes instanceof Blob ? f.bytes : new Blob([f.bytes as never], { type: f.contentType ?? "application/octet-stream" }), f.name);
    if (factory) form.append("factory", factory);
    return this.request<Attachment & { attachments: Attachment[] }>("POST", "/api/v1/uploads", form);
  };
  file = async (key: string) => {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/api/v1/files/${key.split("/").map(encodeURIComponent).join("/")}`, { headers: this.options.token ? { authorization: `Bearer ${this.options.token}` } : {} } as RequestInit);
    if (!res.ok) throw new KilnApiError(res.status, `GET file ${key} returned ${res.status}`);
    return { contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await res.arrayBuffer()) };
  };

  // tasks
  dispatch = (factory: string, input: { prompt: string; title?: string; ticket_ref?: string; ticket_url?: string; branch?: string; mode?: RunMode; attachments?: (string | Attachment)[]; correlation_key?: string; dedupe?: boolean }) =>
    this.request<{ taskId: string; runId?: string; runUrl: string; state: RunState; factory: string; foremanAgent?: string; ticketRef?: string; configSource: { sha: string }; deduplicated?: { into: string; reason: string; score: number } }>("POST", `${this.f(factory)}/runs`, input);
  private taskQ = (o: TaskFilterOpts) =>
    this.q({ stage: o.stage, created_by: o.createdBy, q: o.q, created_after: o.createdAfter, created_before: o.createdBefore, updated_after: o.updatedAfter, updated_before: o.updatedBefore, sort_by: o.sortBy, sort_order: o.sortOrder, limit: o.limit, cursor: o.cursor, include_current_run: o.includeCurrentRun ? "true" : undefined });
  tasks = (factory: string, filter: TaskFilterOpts = {}) => this.request<TaskPage>("GET", `${this.f(factory)}/tasks${this.taskQ(filter)}`);
  allTasks = (filter: TaskFilterOpts & { factory?: string } = {}) => this.request<TaskPage>("GET", `/api/v1/tasks${this.taskQ(filter)}${filter.factory ? `${this.taskQ(filter) ? "&" : "?"}factory=${encodeURIComponent(filter.factory)}` : ""}`);
  task = (factory: string, id: string) => this.request<TaskView>("GET", `${this.f(factory)}/tasks/${id}`);
  createTask = (factory: string, input: { title: string; conversationId: string; description?: string; stage?: TaskStage }) => this.request<TaskView>("POST", `${this.f(factory)}/tasks`, input);
  updateTask = (factory: string, id: string, patch: { title?: string; description?: string; stage?: TaskStage }) => this.request<TaskView>("PATCH", `${this.f(factory)}/tasks/${id}`, patch);
  deleteTask = (factory: string, id: string) => this.request<{ ok: true }>("DELETE", `${this.f(factory)}/tasks/${id}`);
  cancelTask = (factory: string, id: string) => this.request<TaskView>("POST", `${this.f(factory)}/tasks/${id}/cancel`);
  completeTask = (factory: string, id: string) => this.request<{ completed: boolean; reason?: string; task: TaskView }>("POST", `${this.f(factory)}/tasks/${id}/complete`);
  taskOutputs = (factory: string, id: string) => this.request<{ outputs: TaskOutput[] }>("GET", `${this.f(factory)}/tasks/${id}/outputs`);
  taskByRun = (factory: string, runId: string) => this.request<TaskView>("GET", `${this.f(factory)}/task-by-run${this.q({ run_id: runId })}`);
  taskByConversation = (factory: string, conversationId: string) => this.request<TaskView>("GET", `${this.f(factory)}/task-by-conversation${this.q({ conversation_id: conversationId })}`);
  findTask = (reference: string, startWorking = false) =>
    this.request<{ task: TaskView; startWorking?: { repo: string; cloneUrl: string; branch: string; brief: string; commands: string[] } }>("GET", `/api/v1/tasks/lookup${this.q({ reference, start_working: startWorking ? "true" : undefined })}`);
  handbackTask = (id: string, input: { note: string; branch?: string; prUrl?: string }) => this.request<TaskView>("POST", `/api/v1/tasks/${id}/handback`, input);
  runEvents = (id: string, after = 0) => this.request<RunEvent[]>("GET", `/api/v1/runs/${id}/events?after=${after}`);
  steer = (id: string, text: string) => this.request<{ ok: true }>("POST", `/api/v1/runs/${id}/steer`, { text });
  replay = (id: string, sha?: string) => this.request<Run>("POST", `/api/v1/runs/${id}/replay`, { sha });
  pauseRun = (id: string) => this.request<{ key: string }>("POST", `/api/v1/runs/${id}/pause`);
  resumeRun = (id: string) => this.request<Run>("POST", `/api/v1/runs/${id}/resume`);
  cancelRun = (id: string) => this.request<{ ok: true }>("POST", `/api/v1/runs/${id}/cancel`);
  saveBenchmark = (id: string, input: { suite: string; slug: string; title?: string; successCriteria?: string[]; tags?: string[] }) => this.request<{ files: Record<string, string> }>("POST", `/api/v1/runs/${id}/save-benchmark`, input);

  inbox = (opts: { assignee?: string; all?: boolean } = {}) => this.request<GateInboxItem[]>("GET", `/api/v1/inbox${this.q({ assignee: opts.assignee, all: opts.all ? 1 : undefined })}`);
  inboxItems = (opts: { scope?: "mine" | "team"; factory?: string; kind?: InboxItem["kind"][]; read?: boolean; q?: string; includeResolved?: boolean; limit?: number; cursor?: string } = {}) =>
    this.request<{ items: InboxItem[]; pageInfo: PageInfo; unread?: number }>(
      "GET",
      `/api/v1/inbox/items${this.q({ scope: opts.scope, factory: opts.factory, kind: opts.kind, read: opts.read === undefined ? undefined : String(opts.read), q: opts.q, include_resolved: opts.includeResolved ? "true" : undefined, limit: opts.limit, cursor: opts.cursor })}`,
    );
  markRead = (ids: string[]) => this.request<{ results: { id: string; ok: boolean }[] }>("POST", "/api/v1/inbox/read", { ids });
  markUnread = (ids: string[]) => this.request<{ results: { id: string; ok: boolean }[] }>("POST", "/api/v1/inbox/unread", { ids });
  resolveInbox = (ids: string[]) => this.request<{ results: { id: string; ok: boolean }[] }>("POST", "/api/v1/inbox/resolve", { ids });
  unresolveInbox = (ids: string[]) => this.request<{ results: { id: string; ok: boolean }[] }>("POST", "/api/v1/inbox/unresolve", { ids });
  definitionChanges = (factory: string, state?: DefinitionChange["state"]) => this.request<{ changes: DefinitionChange[] }>("GET", `${this.f(factory)}/definition-changes${this.q({ state })}`);
  proposeDefinitionChange = (factory: string, input: { title: string; message?: string; files: Record<string, string | null> }) => this.request<DefinitionChange>("POST", `${this.f(factory)}/definition-changes`, input);
  definitionChange = (id: string) => this.request<DefinitionChange>("GET", `/api/v1/definition-changes/${id}`);
  approveDefinitionChange = (id: string) => this.request<DefinitionChange>("POST", `/api/v1/definition-changes/${id}/approve`);
  requestDefinitionChanges = (id: string, text: string) => this.request<DefinitionChange>("POST", `/api/v1/definition-changes/${id}/request-changes`, { text });
  commentDefinitionChange = (id: string, input: { text: string; path?: string; line?: number }) => this.request<DefinitionChange>("POST", `/api/v1/definition-changes/${id}/comments`, input);
  rejectDefinitionChange = (id: string) => this.request<DefinitionChange>("POST", `/api/v1/definition-changes/${id}/reject`);
  gate = (id: string) => this.request<Gate & { workItem?: WorkItem }>("GET", `/api/v1/gates/${id}`);
  decide = (id: string, decision: "approve" | "reject" | "answer", answer?: string, via?: string) => this.request<Gate>("POST", `/api/v1/gates/${id}/decide`, { decision, answer, via });
  retryOptions = (id: string) => this.request<SpecRetryOptions>("GET", `/api/v1/gates/${id}/retry`);
  /** Write the spec again from scratch, optionally on another model for that one run. */
  retrySpec = (id: string, model?: string, via?: string) => this.request<Gate>("POST", `/api/v1/gates/${id}/retry`, { model, via });

  projects = () => this.request<Project[]>("GET", "/api/v1/projects");
  project = (id: string) => this.request<Project & { roadmap?: Roadmap; workItems: WorkItem[] }>("GET", `/api/v1/projects/${id}`);
  createProject = (input: { name: string; factories: string[] }) => this.request<Project>("POST", "/api/v1/projects", input);
  plan = (projectId: string, input: { goal: string; prd?: string; notes?: string; createIssues?: boolean }) => this.request<Roadmap>("POST", `/api/v1/projects/${projectId}/plan`, input);
  portfolio = (since?: string) => this.request<Portfolio>("GET", `/api/v1/portfolio${this.q({ since })}`);
  digest = () => this.request<{ person: string; text: string; items: { gateId: string; title: string; ageHours: number; link: string }[] }[]>("GET", "/api/v1/digest");

  metrics = (factory: string, opts: { since?: string; agent?: string } = {}) => this.request<FactoryMetrics>("GET", `/api/v1/metrics${this.q({ factory, ...opts })}`);
  allMetrics = (since?: string) => this.request<FactoryMetrics[]>("GET", `/api/v1/metrics${this.q({ since })}`);
  rawMetrics = (factory: string, kind: "runs" | "scores" | "work_items", since?: string) => this.request<Record<string, unknown>[]>("GET", `/api/v1/metrics/raw${this.q({ factory, kind, since })}`);
  scores = (factory: string, filter: { agent?: string; run?: string } = {}) => this.request<Score[]>("GET", `/api/v1/scores${this.q({ factory, ...filter })}`);
  selfImprovement = (factory: string) => this.request<{ proposals: Proposal[]; failures: Score[] }>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/self-improvement`);
  runSelfImprovement = (factory: string) => this.request<Proposal[]>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/self-improvement/run`);
  approveProposal = (id: string, opts: { force?: boolean } = {}) => this.request<Proposal>("POST", `/api/v1/proposals/${id}/approve`, opts);
  rejectProposal = (id: string, reason?: string) => this.request<Proposal>("POST", `/api/v1/proposals/${id}/reject`, { reason });
  benchmarks = (factory: string) => this.request<{ suites: string[]; results: BenchmarkResult[]; summary: Record<string, ConfigSummary[]> }>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/benchmarks`);
  runBenchmark = (factory: string, suite: string) => this.request<{ results: BenchmarkResult[]; summary: ConfigSummary[] }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/benchmarks/${encodeURIComponent(suite)}/run`);
  proposeRouter = (factory: string, suite: string) => this.request<{ rules: { tag: string; model: string }[]; prUrl?: string }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/benchmarks/${encodeURIComponent(suite)}/router`);

  memories = (factory: string) => this.request<Memory[]>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/memories`);
  proposeMemory = (factory: string, input: { title: string; body: string; tags?: string[] }) => this.request<Memory>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/memories`, input);
  acceptMemory = (id: string) => this.request<Memory>("POST", `/api/v1/memories/${id}/accept`);
  rejectMemory = (id: string) => this.request<{ ok: true }>("POST", `/api/v1/memories/${id}/reject`);
  skills = () => this.request<{ catalog: CatalogRow[]; listings: SkillListing[] }>("GET", "/api/v1/skills");
  publishSkill = (factory: string, name: string) => this.request<SkillListing>("POST", "/api/v1/skills/publish", { factory, name });
  installSkill = (id: string, factory: string) => this.request<{ prUrl?: string; sha?: string }>("POST", `/api/v1/skills/${id}/install`, { factory });

  // factory metrics, costs and pull requests
  factoryMetrics = (factory: string, o: RangeOpts = {}) => this.request<Record<string, any>>("GET", `${this.f(factory)}/metrics${this.q(this.range(o))}`);
  costPerPr = (factory: string, o: RangeOpts = {}) => this.request<Record<string, any>>("GET", `${this.f(factory)}/costs/per-pr${this.q(this.range(o))}`);
  costBreakdown = (factory: string, groupBy: "source" | "user" | "agent" | "model", o: RangeOpts = {}) => this.request<Record<string, any>>("GET", `${this.f(factory)}/costs/breakdown${this.q({ ...this.range(o), group_by: groupBy })}`);
  topPrCosts = (factory: string, o: RangeOpts & { limit?: number } = {}) => this.request<Record<string, any>>("GET", `${this.f(factory)}/costs/per-pr/top${this.q({ ...this.range(o), limit: o.limit })}`);
  costBySize = (factory: string, o: RangeOpts = {}) => this.request<Record<string, any>>("GET", `${this.f(factory)}/costs/per-pr/by-size${this.q(this.range(o))}`);
  runBreakdown = (factory: string, groupBy: "agent_type" | "status" | "source" | "root_vs_subrun" | "model" | "harness", o: RangeOpts = {}) =>
    this.request<Record<string, any>>("GET", `${this.f(factory)}/metrics/run-breakdown${this.q({ ...this.range(o), group_by: groupBy })}`);
  pullRequests = (factory: string, o: { limit?: number; cursor?: string; repo?: string; state?: ("open" | "draft" | "merged" | "closed")[]; openedAfter?: string; openedBefore?: string; mergedAfter?: string; mergedBefore?: string; updatedAfter?: string } = {}) =>
    this.request<{ pullRequests: PrRecord[]; pageInfo: PageInfo }>(
      "GET",
      `${this.f(factory)}/pull-requests${this.q({ limit: o.limit, cursor: o.cursor, repo: o.repo, state: o.state, opened_after: o.openedAfter, opened_before: o.openedBefore, merged_after: o.mergedAfter, merged_before: o.mergedBefore, updated_after: o.updatedAfter })}`,
    );

  // scorers
  scorersOf = (factory: string) => this.request<{ scorers: Record<string, any>[] }>("GET", `${this.f(factory)}/scorers`);
  scorer = (factory: string, slug: string) => this.request<Record<string, any>>("GET", `${this.f(factory)}/scorers/${slug}`);
  createScorer = (factory: string, input: ScorerInput) => this.request<{ slug: string; result: WriteResult; scorer?: Record<string, any> }>("POST", `${this.f(factory)}/scorers`, input);
  updateScorer = (factory: string, slug: string, patch: Partial<Omit<ScorerInput, "slug">>) => this.request<{ slug: string; result: WriteResult; scorer?: Record<string, any> }>("PATCH", `${this.f(factory)}/scorers/${slug}`, patch);
  deleteScorer = (factory: string, slug: string) => this.request<{ slug: string; deletedScores: number }>("DELETE", `${this.f(factory)}/scorers/${slug}`);
  scorerResults = (factory: string, slug: string, o: { limit?: number; cursor?: string; includeReasons?: boolean; runIds?: string[] } = {}) =>
    this.request<{ results: Record<string, any>[]; pageInfo: PageInfo }>("GET", `${this.f(factory)}/scorers/${slug}/results${this.q({ limit: o.limit, cursor: o.cursor, include_reasons: o.includeReasons ? "true" : undefined, run_id: o.runIds })}`);
  scorerMetrics = (factory: string, slug: string, o: RangeOpts & { includeCost?: boolean } = {}) =>
    this.request<Record<string, any>>("GET", `${this.f(factory)}/scorers/${slug}/metrics${this.q({ ...this.range(o), include_cost: o.includeCost ? "true" : undefined })}`);
  scoreRuns = (factory: string, slug: string, runIds: string[]) => this.request<{ results: { runId: string; scorer: string; status: string; scoreId?: string }[] }>("POST", `${this.f(factory)}/scorers/${slug}/dispatch`, { runIds });
  scoreRun = (factory: string, runId: string, scorers: string[]) => this.request<{ results: { runId: string; scorer: string; status: string; scoreId?: string }[] }>("POST", `${this.f(factory)}/runs/${runId}/scorer-dispatch`, { scorers });

  // benchmarks
  benchmarkSuites = (factory: string) => this.request<{ suites: Record<string, any>[] }>("GET", `${this.f(factory)}/benchmark-suites`);
  benchmarkSuite = (factory: string, suite: string) => this.request<Record<string, any>>("GET", `${this.f(factory)}/benchmark-suites/${suite}`);
  createBenchmarkSuite = (factory: string, input: Record<string, unknown>) => this.request<{ slug: string; result: WriteResult }>("POST", `${this.f(factory)}/benchmark-suites`, input);
  updateBenchmarkSuite = (factory: string, suite: string, patch: Record<string, unknown>) => this.request<{ slug: string; result: WriteResult }>("PATCH", `${this.f(factory)}/benchmark-suites/${suite}`, patch);
  deleteBenchmarkSuite = (factory: string, suite: string) => this.request<{ slug: string; result: WriteResult }>("DELETE", `${this.f(factory)}/benchmark-suites/${suite}`);
  createBenchmarkTask = (factory: string, suite: string, input: Record<string, unknown>) => this.request<{ slug: string; created: boolean }>("POST", `${this.f(factory)}/benchmark-suites/${suite}/tasks`, input);
  deleteBenchmarkTask = (factory: string, suite: string, task: string) => this.request<{ slug: string }>("DELETE", `${this.f(factory)}/benchmark-suites/${suite}/tasks/${task}`);
  startBenchmark = (factory: string, suite: string, input: { configurations?: { name: string; agents: { agent: string; harness?: string; model?: string; runner?: string }[] }[]; repetitions?: number; scorers?: string[]; tasks?: string[] } = {}) =>
    this.request<BenchmarkRun>("POST", `${this.f(factory)}/benchmark-suites/${suite}/runs`, input);
  benchmarkRuns = (factory: string, suite: string) => this.request<{ runs: BenchmarkRun[] }>("GET", `${this.f(factory)}/benchmark-suites/${suite}/runs`);
  benchmarkRun = (id: string) => this.request<BenchmarkRun>("GET", `/api/v1/benchmark-runs/${id}`);
  cancelBenchmarkRun = (id: string) => this.request<BenchmarkRun>("POST", `/api/v1/benchmark-runs/${id}/cancel`);
  benchmarkResults = (id: string) => this.request<Record<string, any>>("GET", `/api/v1/benchmark-runs/${id}/results`);
  benchmarkTrials = (id: string, f: { task?: string; configuration?: string; agentRunId?: string } = {}) =>
    this.request<{ trials: BenchmarkTrial[]; matchedAttemptNumber?: number }>("GET", `/api/v1/benchmark-runs/${id}/trials${this.q({ task: f.task, configuration: f.configuration, agent_run_id: f.agentRunId })}`);
  runToBenchmarkTask = (runId: string, input: { suite: string; slug?: string; title?: string; successCriteria?: string[]; tags?: string[] }) => this.request<{ slug: string; created: boolean }>("POST", `/api/v1/runs/${runId}/benchmark-task`, input);

  // self-improvement
  selfImprovementSettings = (factory: string) => this.request<Record<string, any>>("GET", `${this.f(factory)}/self-improvement/settings`);
  updateSelfImprovementSettings = (factory: string, patch: { enabled?: boolean; failedRunThreshold?: number; maxAgeDays?: number; reviewers?: { type: "admins" | "team" | "custom" | "none"; emails?: string[] }; model?: string | null; scorers?: Record<string, boolean> }) =>
    this.request<WriteResult>("PUT", `${this.f(factory)}/self-improvement/settings`, patch);

  // definition editing
  files = (factory: string) => this.request<{ sha: string; managed: boolean; files: { path: string; size: number }[] }>("GET", `${this.f(factory)}/files`);
  readFile = (factory: string, path: string) => this.request<{ path: string; content: string }>("GET", `${this.f(factory)}/files/${path.split("/").map(encodeURIComponent).join("/")}`);
  writeFile = (factory: string, path: string, content: string, message?: string) => this.request<WriteResult>("PUT", `${this.f(factory)}/files/${path.split("/").map(encodeURIComponent).join("/")}`, { content, message });
  deleteFile = (factory: string, path: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/files/${path.split("/").map(encodeURIComponent).join("/")}`);
  commitFiles = (factory: string, files: Record<string, string | null>, message: string, dryRun?: boolean) => this.request<WriteResult>("POST", `${this.f(factory)}/files/commit`, { files, message, dryRun });
  agents = (factory: string) => this.request<{ agents: Record<string, any>[] }>("GET", `${this.f(factory)}/agents`);
  putAgent = (factory: string, name: string, spec: Record<string, unknown>) => this.request<WriteResult>("PUT", `${this.f(factory)}/agents/${encodeURIComponent(name)}`, spec);
  deleteAgent = (factory: string, name: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/agents/${encodeURIComponent(name)}`);
  putAutomation = (factory: string, name: string, spec: Record<string, unknown>) => this.request<WriteResult>("PUT", `${this.f(factory)}/automations/${name}`, spec);
  deleteAutomation = (factory: string, name: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/automations/${name}`);
  putRunner = (factory: string, name: string, spec: Record<string, unknown>) => this.request<WriteResult>("PUT", `${this.f(factory)}/runners/${name}`, spec);
  deleteRunner = (factory: string, name: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/runners/${name}`);
  putRouter = (factory: string, name: string, spec: Record<string, unknown>) => this.request<WriteResult>("PUT", `${this.f(factory)}/routers/${name}`, spec);
  deleteRouter = (factory: string, name: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/routers/${name}`);
  putSkill = (factory: string, name: string, spec: { description: string; body: string; owner?: string; version?: string; agent?: string }) => this.request<WriteResult>("PUT", `${this.f(factory)}/skills/${name}`, spec);
  deleteSkill = (factory: string, name: string, agent?: string) => this.request<WriteResult>("DELETE", `${this.f(factory)}/skills/${name}${this.q({ agent })}`);
  settings = (factory: string) => this.request<Record<string, any>>("GET", `${this.f(factory)}/settings`);
  updateSettings = (factory: string, patch: Record<string, unknown>) => this.request<WriteResult>("PATCH", `${this.f(factory)}/settings`, patch);
  setAvatar = (factory: string, fileKey: string) => this.request<{ avatarUrl: string }>("POST", `${this.f(factory)}/avatar`, { file: fileKey });
  migrateFactory = (factory: string, repo: { owner: string; name: string; ref?: string; dir?: string }) => this.request<{ prUrl: string; branch: string }>("POST", `${this.f(factory)}/migrate`, repo);
  completeMigration = (factory: string) => this.request<{ switched: boolean; factory: FactoryBinding }>("POST", `${this.f(factory)}/migrate/complete`);

  // factory creation and onboarding
  createFactory = (input: CreateFactoryInput) => this.request<{ factory?: FactoryBinding; sha: string; files: string[]; dryRun: boolean; tree?: Record<string, string> }>("POST", "/api/v1/factories", input);
  enableLearning = (factory: string) => this.request<RunView>("POST", `${this.f(factory)}/learning`);
  forgeRepositories = () => this.request<{ forge: string; repositories: { owner: string; name: string; forge: string }[] }>("GET", "/api/v1/forge/repositories");
  trackerScopes = () => this.request<{ tracker: string; scopes: { id: string; name: string }[] }>("GET", "/api/v1/tracker/scopes");

  // definition schemas (no token needed)
  schemaVersions = () => this.request<{ currentVersion: string; versions: { schemaVersion: string; schemaUrl: string }[] }>("GET", "/api/v1/factory-files/schemas");
  schemaBundle = (version = "v1") => this.request<{ schemaVersion: string; documents: Record<string, Record<string, unknown>> }>("GET", `/api/v1/factory-files/schemas/${version}`);
  schemaDocument = (document: string, version = "v1") => this.request<Record<string, unknown>>("GET", `/api/v1/factory-files/schemas/${version}/${document}`);
  validateFiles = (files: { path: string; content: string }[]) => this.request<ValidateFilesResult>("POST", "/api/v1/factory-files/validate", { files });

  // self-hosted workers
  workers = () => this.request<{ workers: (WorkerRecord & { stale: boolean })[]; queue: { runId: string; workerHost: string; queuedAt: string }[] }>("GET", "/api/v1/workers");
  workerConnect = (input: { workerId: string; backend: "docker" | "kubernetes" | "direct"; version?: string; maxConcurrent?: number; instance?: string }) => this.request<WorkerRecord>("POST", "/api/v1/workers/connect", input);
  workerHeartbeat = (instance: string) => this.request<WorkerControl>("POST", `/api/v1/workers/${instance}/heartbeat`);
  workerClaim = (instance: string, waitSeconds = 25) => this.request<{ job?: WorkerJob; control: WorkerControl }>("POST", `/api/v1/workers/${instance}/claim${this.q({ wait: waitSeconds })}`);
  workerEvents = (instance: string, runId: string, events: WorkerEvent[]) => this.request<WorkerControl>("POST", `/api/v1/workers/${instance}/runs/${runId}/events`, { events });
  workerComplete = (instance: string, runId: string, result: WorkerResult) => this.request<{ ok: true }>("POST", `/api/v1/workers/${instance}/runs/${runId}/complete`, result);
  workerDisconnect = (instance: string) => this.request<{ ok: true }>("DELETE", `/api/v1/workers/${instance}`);
  metricsText = () => this.text("/metrics");

  audit = (limit = 200) => this.request<{ id: string; at: string; actor: string; action: string; target: string; details?: unknown }[]>("GET", `/api/v1/audit?limit=${limit}`);
  decisions = (workItem?: string) => this.request<{ id: string; decision: string; action: string; provider: string; workItemId?: string; runId?: string; at: string }[]>("GET", `/api/v1/decisions${this.q({ workItem })}`);
  tokens = () => this.request<{ id: string; name: string; subject: string; grants: { scope: string; factory: string }[]; createdAt: string; expiresAt?: string; revoked?: boolean }[]>("GET", "/api/v1/tokens");
  issueToken = (input: { name: string; subject: string; grants: { scope: string; factory: string }[]; ttlHours?: number }) => this.request<{ token: string; record: { id: string } }>("POST", "/api/v1/tokens", input);
  integrations = () => this.request<{ forge: string; tracker: string; chat: string; preview: string; decisions: { primary: string; fallback: string }; judge: string; sandboxes: string[]; defaultBackend: string; agents: string; publicUrl?: string }>("GET", "/api/v1/integrations");
  secrets = () => this.request<string[]>("GET", "/api/v1/secrets");
  setSecret = (name: string, value: string) => this.request<{ ok: true }>("PUT", `/api/v1/secrets/${encodeURIComponent(name)}`, { value });

  // ---- auth ----
  authProviders = () => this.request<{ password: boolean; github: boolean; openSignup: boolean; needsOwner: boolean }>("GET", "/api/v1/auth/providers");
  signup = (input: { name?: string; email: string; password: string; invite?: string }) => this.request<Session>("POST", "/api/v1/auth/signup", input);
  login = (email: string, password: string) => this.request<Session>("POST", "/api/v1/auth/login", { email, password });
  logout = () => this.request<{ ok: true }>("POST", "/api/v1/auth/logout");
  githubLoginUrl = (opts: { redirect?: string; invite?: string } = {}) => this.request<{ url: string; state: string }>("GET", `/api/v1/auth/github/start${this.q({ ...opts, json: 1 })}`);
  githubCallback = (code: string, state: string) => this.request<Session & { created: boolean }>("GET", `/api/v1/auth/github/callback${this.q({ code, state })}`);
  invite = (token: string) => this.request<{ team: { id: string; name: string; slug: string; avatar?: string }; email: string; role: TeamRole; expiresAt: string }>("GET", `/api/v1/invites/${encodeURIComponent(token)}`);
  acceptInvite = (token: string) => this.request<{ team: { id: string; name: string; slug: string }; role: TeamRole }>("POST", "/api/v1/invites/accept", { token });

  // ---- user settings ----
  updateMe = (patch: { name?: string; email?: string; avatar?: string | null; appearance?: Appearance; notifications?: Partial<NotificationPrefs>; digest?: Partial<{ daily: boolean; hourUtc: number; channels: ("email" | "slack" | "discord")[]; only: boolean }> }) => this.request<PublicUser>("PATCH", "/api/v1/me", patch);
  changePassword = (next: string, current?: string) => this.request<{ ok: true }>("PUT", "/api/v1/me/password", { next, current });
  uploadAvatar = (bytes: Uint8Array | ArrayBuffer | Blob, contentType: string) => this.upload<PublicUser>("PUT", "/api/v1/me/avatar", bytes, contentType);
  notifications = (limit = 50) => this.request<NotificationRecord[]>("GET", `/api/v1/me/notifications?limit=${limit}`);
  linkedAccounts = () => this.request<LinkedAccount[]>("GET", "/api/v1/me/linked-accounts");
  linkAccount = (provider: LinkProvider, externalId: string, handle?: string) => this.request<LinkedAccount[]>("POST", "/api/v1/me/linked-accounts", { provider, externalId, handle });
  unlinkAccount = (provider: LinkProvider) => this.request<LinkedAccount[]>("DELETE", `/api/v1/me/linked-accounts/${provider}`);
  apiKeys = () => this.request<ApiKeyRow[]>("GET", "/api/v1/api-keys");
  createApiKey = (input: { name: string; type?: "personal" | "agent" | "worker"; expiresIn?: "1d" | "30d" | "90d" | "never" }) => this.request<{ token: string; record: ApiKeyRow }>("POST", "/api/v1/api-keys", input);
  revokeApiKey = (id: string) => this.request<{ ok: true }>("DELETE", `/api/v1/api-keys/${encodeURIComponent(id)}`);

  // ---- teams ----
  teams = () => this.request<TeamSummary[]>("GET", "/api/v1/teams");
  createTeam = (input: { name: string; slug?: string }) => this.request<TeamSummary>("POST", "/api/v1/teams", input);
  team = (team: string) => this.request<TeamDetail>("GET", `/api/v1/teams/${encodeURIComponent(team)}`);
  updateTeam = (team: string, patch: { name?: string; slug?: string; avatar?: string | null }) => this.request<TeamSummary>("PATCH", `/api/v1/teams/${encodeURIComponent(team)}`, patch);
  uploadTeamAvatar = (team: string, bytes: Uint8Array | ArrayBuffer | Blob, contentType: string) => this.upload<TeamSummary>("PUT", `/api/v1/teams/${encodeURIComponent(team)}/avatar`, bytes, contentType);
  teamMembers = (team: string) => this.request<TeamMemberRow[]>("GET", `/api/v1/teams/${encodeURIComponent(team)}/members`);
  setTeamRole = (team: string, userId: string, role: TeamRole) => this.request<Membership>("PATCH", `/api/v1/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(userId)}`, { role });
  removeTeamMember = (team: string, userId: string) => this.request<{ ok: true }>("DELETE", `/api/v1/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(userId)}`);
  invites = (team: string) => this.request<InviteRow[]>("GET", `/api/v1/teams/${encodeURIComponent(team)}/invites`);
  inviteMember = (team: string, email: string, role: TeamRole = "member") => this.request<IssuedInvite>("POST", `/api/v1/teams/${encodeURIComponent(team)}/invites`, { email, role });
  resendInvite = (team: string, inviteId: string) => this.request<IssuedInvite>("POST", `/api/v1/teams/${encodeURIComponent(team)}/invites/${encodeURIComponent(inviteId)}/resend`);
  revokeInvite = (team: string, inviteId: string) => this.request<{ ok: true }>("DELETE", `/api/v1/teams/${encodeURIComponent(team)}/invites/${encodeURIComponent(inviteId)}`);
  teamSettings = (team: string) => this.request<TeamSettings>("GET", `/api/v1/teams/${encodeURIComponent(team)}/settings`);
  updateTeamSettings = (team: string, patch: Partial<TeamSettings>) => this.request<TeamSettings>("PATCH", `/api/v1/teams/${encodeURIComponent(team)}/settings`, patch);
  testStorage = (team: string, category: "artifacts" | "transcripts" | "attachments") => this.request<{ ok: boolean; error?: string }>("POST", `/api/v1/teams/${encodeURIComponent(team)}/storage/${category}/test`);
  modelKeys = (team: string) => this.request<Record<ModelKeyProvider, { set: boolean; updatedAt?: string; updatedBy?: string }>>("GET", `/api/v1/teams/${encodeURIComponent(team)}/model-keys`);
  setModelKey = (team: string, provider: ModelKeyProvider, value: string | Record<string, string>) => this.request<SecretMeta>("PUT", `/api/v1/teams/${encodeURIComponent(team)}/model-keys/${provider}`, { value });
  claudeTokens = (team: string) => this.request<PoolEntry[]>("GET", `/api/v1/teams/${encodeURIComponent(team)}/claude-tokens`);
  checkClaudeToken = (team: string, name: string) => this.request<PoolEntry>("POST", `/api/v1/teams/${encodeURIComponent(team)}/claude-tokens/${encodeURIComponent(name)}/check`);
  chatgptLogins = (team: string) => this.request<PoolEntry[]>("GET", `/api/v1/teams/${encodeURIComponent(team)}/chatgpt-logins`);
  startChatgptSignIn = (team: string, body: { name: string; scope?: "team" | "personal" }) => this.request<ChatgptSignIn>("POST", `/api/v1/teams/${encodeURIComponent(team)}/chatgpt-logins/sign-in`, body);
  chatgptSignIn = (team: string, id: string) => this.request<ChatgptSignIn>("GET", `/api/v1/teams/${encodeURIComponent(team)}/chatgpt-logins/sign-in/${encodeURIComponent(id)}`);
  cancelChatgptSignIn = (team: string, id: string) => this.request<ChatgptSignIn>("DELETE", `/api/v1/teams/${encodeURIComponent(team)}/chatgpt-logins/sign-in/${encodeURIComponent(id)}`);
  checkChatgptLogin = (team: string, name: string) => this.request<PoolEntry>("POST", `/api/v1/teams/${encodeURIComponent(team)}/chatgpt-logins/${encodeURIComponent(name)}/check`);
  deleteModelKey = (team: string, provider: ModelKeyProvider) => this.request<{ ok: true }>("DELETE", `/api/v1/teams/${encodeURIComponent(team)}/model-keys/${provider}`);

  // ---- factory roles ----
  factoryMembers = (factory: string) => this.request<FactoryMemberRow[]>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/members`);
  addFactoryMember = (factory: string, input: { userId?: string; email?: string; role: FactoryRole }) => this.request<FactoryMember>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/members`, input);
  setFactoryRole = (factory: string, userId: string, role: FactoryRole) => this.request<FactoryMember>("PATCH", `/api/v1/factories/${encodeURIComponent(factory)}/members/${encodeURIComponent(userId)}`, { role });
  removeFactoryMember = (factory: string, userId: string) => this.request<{ ok: true }>("DELETE", `/api/v1/factories/${encodeURIComponent(factory)}/members/${encodeURIComponent(userId)}`);

  // ---- secrets, MCP servers, environments, usage (current team) ----
  managedSecrets = () => this.request<SecretMeta[]>("GET", "/api/v1/managed-secrets");
  createManagedSecret = (input: { scope?: "team" | "personal"; name: string; type?: SecretType; value: unknown; description?: string }) => this.request<SecretMeta>("POST", "/api/v1/managed-secrets", input);
  updateManagedSecret = (scope: "team" | "personal", name: string, patch: { value?: unknown; description?: string }) => this.request<SecretMeta>("PATCH", `/api/v1/managed-secrets/${scope}/${encodeURIComponent(name)}`, patch);
  deleteManagedSecret = (scope: "team" | "personal", name: string) => this.request<{ ok: true }>("DELETE", `/api/v1/managed-secrets/${scope}/${encodeURIComponent(name)}`);
  mcpServers = () => this.request<{ servers: McpServer[]; builtins: BuiltinMcpRow[] }>("GET", "/api/v1/mcp-servers");
  mcpServer = (id: string) => this.request<McpServer>("GET", `/api/v1/mcp-servers/${encodeURIComponent(id)}`);
  createMcpServer = (input: McpServerInput) => this.request<McpServer>("POST", "/api/v1/mcp-servers", input);
  updateMcpServer = (id: string, patch: Partial<McpServerInput>) => this.request<McpServer>("PATCH", `/api/v1/mcp-servers/${encodeURIComponent(id)}`, patch);
  deleteMcpServer = (id: string) => this.request<{ ok: true }>("DELETE", `/api/v1/mcp-servers/${encodeURIComponent(id)}`);
  environments = () => this.request<EnvironmentTemplate[]>("GET", "/api/v1/environments");
  environment = (id: string) => this.request<EnvironmentTemplate>("GET", `/api/v1/environments/${encodeURIComponent(id)}`);
  createEnvironment = (input: EnvironmentInput) => this.request<EnvironmentTemplate>("POST", "/api/v1/environments", input);
  updateEnvironment = (id: string, patch: Partial<EnvironmentInput>) => this.request<EnvironmentTemplate>("PATCH", `/api/v1/environments/${encodeURIComponent(id)}`, patch);
  deleteEnvironment = (id: string) => this.request<{ ok: true }>("DELETE", `/api/v1/environments/${encodeURIComponent(id)}`);
  usage = (filter: { since?: string; until?: string; factory?: string; user?: string; entries?: boolean } = {}) =>
    this.request<UsageSummary & { entries?: UsageEntry[] }>("GET", `/api/v1/usage${this.q({ ...filter, entries: filter.entries ? 1 : undefined })}`);

  /** Raw-body uploads (avatars). */
  async upload<T>(method: string, path: string, body: Uint8Array | ArrayBuffer | Blob, contentType: string): Promise<T> {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "content-type": contentType,
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        ...(this.options.team ? { "x-kiln-team": this.options.team } : {}),
        ...this.options.headers,
      },
      body: body as unknown as RequestInit["body"],
    } as RequestInit);
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new KilnApiError(res.status, (data as { error?: string })?.error ?? `${method} ${path} returned ${res.status}`, data);
    return data as T;
  }

  /** Delete a factory (Admin role). Irreversible. */
  deleteFactory = (id: string) => this.request<{ ok: true; factory: string; cancelled: string[] }>("DELETE", `/api/v1/factories/${encodeURIComponent(id)}`);

  // Workspace connections
  connections = () => this.request<ConnectionRow[]>("GET", "/api/v1/connections");
  /** Start creating Kiln's own GitHub App: post `manifest` (as a form field) to `action` from the browser. */
  githubAppManifest = (input: { org?: string; name?: string } = {}) => this.request<{ action: string; state: string; manifest: Record<string, unknown> }>("POST", "/api/v1/connections/github/app-manifest", input);
  githubApps = () => this.request<{ appId: string; slug: string; owner?: string; installationId?: string; createdBy: string; createdAt: string; installUrl: string }[]>("GET", "/api/v1/connections/github/apps");
  githubApp = () => this.request<{ appId: string; slug: string; owner?: string; installationId?: string; createdBy: string; createdAt: string; installUrl: string } | null>("GET", "/api/v1/connections/github/app");
  startConnection = (provider: string) => this.request<{ provider: string; state: string; url?: string; steps: string[]; fields?: { name: string; label: string; secret?: boolean; optional?: boolean }[] }>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/start`);
  completeConnection = (provider: string, input: { code?: string; state?: string; params?: Record<string, string> }) => this.request<Connection>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/complete`, input);
  testConnection = (provider: string) => this.request<{ ok: boolean; message: string }>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/test`);
  disconnect = (provider: string) => this.request<{ ok: true }>("DELETE", `/api/v1/connections/${encodeURIComponent(provider)}`);
  setConnectionDirectory = (provider: string, directory: Record<string, Record<string, string>>) => this.request<Record<string, Record<string, string>>>("PUT", `/api/v1/connections/${encodeURIComponent(provider)}/directory`, directory);
  approvalLinks = (provider: string) => this.request<ApprovalLink[]>("GET", `/api/v1/connections/${encodeURIComponent(provider)}/approval-links`);
  createApprovalLink = (provider: string, email?: string) => this.request<ApprovalLink & { token: string; url: string }>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/approval-links`, { email });
  resendApprovalLink = (id: string) => this.request<ApprovalLink & { token: string; url: string }>("POST", `/api/v1/approval-links/${encodeURIComponent(id)}/resend`);
  revokeApprovalLink = (id: string) => this.request<{ ok: true }>("DELETE", `/api/v1/approval-links/${encodeURIComponent(id)}`);
  /** Start linking your GitHub account (a GitHub OAuth URL); the callback adds it to your linked accounts. */
  linkGitHubAccount = () => this.request<{ url: string }>("POST", "/api/v1/me/linked-accounts/github/start");

  /** A task's pull request for review in Kiln: changed files with patches and whether you can review as your GitHub account. */
  taskReview = (id: string) => this.request<TaskReview>("GET", `/api/v1/tasks/${encodeURIComponent(id)}/review`);
  /** Submit a review as your linked GitHub account; requested changes go to the agents. */
  submitReview = (id: string, input: ReviewSubmission) => this.request<{ id: string; url: string }>("POST", `/api/v1/tasks/${encodeURIComponent(id)}/review`, input);
  /** Merge the task's pull request as your linked GitHub account. */
  mergeTask = (id: string) => this.request<{ pr: { url: string; state: string } }>("POST", `/api/v1/tasks/${encodeURIComponent(id)}/merge`);
  /** Handed-off tasks that need no code review, only a person's merge. */
  readyToMerge = (factory?: string) => this.request<{ items: ReadyToMerge[] }>("GET", `/api/v1/ready-to-merge${this.q({ factory })}`);
  /** Link a chat account from the token a `sign in` command sent you. */
  claimLinkToken = (token: string) => this.request<LinkedAccount[]>("POST", "/api/v1/me/linked-accounts/claim", { token });
  factoryIntegrations = (factory: string) => this.request<FactoryIntegrations>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/integrations`);
  setFactoryIntegrations = (factory: string, integrations: (string | Record<string, unknown>)[]) => this.request<ApplyResult & { integrations: FactoryIntegrations["integrations"] }>("PUT", `/api/v1/factories/${encodeURIComponent(factory)}/integrations`, { integrations });
  notificationRoutes = (opts: { factory?: string; workItem?: string; subject?: string } = {}) => this.request<NotificationRoute[]>("GET", `/api/v1/notification-routes${this.q(opts)}`);
  registerDiscordCommands = (guildId?: string) => this.request<{ registered: string[]; scope: string }>("POST", "/api/v1/integrations/discord/commands", { guildId });
  /** The Microsoft Teams app package (zip with manifest.json, color.png, outline.png). */
  teamsAppPackage = async (opts: { name?: string; developer?: string; website?: string; color?: string } = {}): Promise<ArrayBuffer> => {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/api/v1/integrations/teams/app-package${this.q(opts)}`, {
      headers: { ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}), ...this.options.headers },
    });
    if (!res.ok) throw new KilnApiError(res.status, `GET app-package returned ${res.status}`, await res.text());
    return res.arrayBuffer();
  };

  // Automations
  automationTemplates = (opts: { factory?: string; category?: "default" | "suggested" } = {}) => this.request<(AutomationTemplate & { connected: boolean })[]>("GET", `/api/v1/automation-templates${this.q(opts)}`);
  addAutomationFromTemplate = (factory: string, template: string, name?: string) => this.request<{ applied: boolean; files: Record<string, string>; reason?: string }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/automations/from-template`, { template, name });
  automationCatalog = () => this.request<{ providers: Record<string, Record<string, Record<string, string>>>; defaults: Record<string, unknown> }>("GET", "/api/v1/automation-catalog");
  deliveries = (opts: { provider?: string; limit?: number } = {}) => this.request<EventDelivery[]>("GET", `/api/v1/deliveries${this.q(opts)}`);
  runAutomation = (factory: string, automation: string) =>
    this.request<{ workItemId: string; deduplicated?: { into: string; reason: string; score: number } }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/automations/${encodeURIComponent(automation)}/run`);
  testFilter = (factory: string, automation: string, deliveryId: string) => this.request<TestFilterResult>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/automations/${encodeURIComponent(automation)}/test-filter`, { deliveryId });

  // Custom webhooks
  webhooks = (factory: string) => this.request<(WebhookSource & { url: string })[]>("GET", `/api/v1/factories/${encodeURIComponent(factory)}/webhooks`);
  createWebhook = (factory: string, input: { name: string; authMode?: "token" | "url_token" | "signature"; signatureScheme?: string; secret?: string; deliveryIdHeader?: string }) => this.request<{ webhook: WebhookSource; url: string; secret?: string }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/webhooks`, input);
  webhook = (uid: string) => this.request<WebhookSource & { url: string }>("GET", `/api/v1/webhooks/${encodeURIComponent(uid)}`);
  updateWebhook = (uid: string, patch: { enabled?: boolean; deliveryIdHeader?: string | null }) => this.request<WebhookSource>("PATCH", `/api/v1/webhooks/${encodeURIComponent(uid)}`, patch);
  deleteWebhook = (uid: string) => this.request<{ ok: true }>("DELETE", `/api/v1/webhooks/${encodeURIComponent(uid)}`);
  rotateWebhookSecret = (uid: string, secret?: string) => this.request<{ webhook: WebhookSource; url: string; secret?: string }>("POST", `/api/v1/webhooks/${encodeURIComponent(uid)}/rotate`, { secret });
  finishWebhook = (uid: string, secret: string) => this.request<WebhookSource>("POST", `/api/v1/webhooks/${encodeURIComponent(uid)}/finish`, { secret });
  webhookDeliveries = (uid: string) => this.request<(Omit<WebhookDelivery, "payload"> & { hasPayload: boolean })[]>("GET", `/api/v1/webhooks/${encodeURIComponent(uid)}/deliveries`);
  webhookDelivery = (uid: string, id: string) => this.request<WebhookDelivery>("GET", `/api/v1/webhooks/${encodeURIComponent(uid)}/deliveries/${encodeURIComponent(id)}`);
}

export type ConnectionRow = { provider: string; label: string; mode?: string; available: boolean; connection?: Omit<Connection, "secretNames"> & { secretNames: string[] }; pendingApprovals: number };
export type FactoryIntegrations = {
  integrations: ({ type: string } & Record<string, unknown>)[];
  forges: string[];
  cloudProviders: Record<string, Record<string, string>> | null;
  github: { factoryConfigChecks: "main" | "all" };
  connections: Record<string, string>;
  editable: boolean;
};
export type TestFilterResult = { wouldTrigger: boolean; delivery: string; triggers: { index: number; provider: string; event: string; wouldTrigger: boolean; checks: CheckOutcome[] }[] };

export type PullRequestFileView = { path: string; previousPath?: string; status: "added" | "modified" | "removed" | "renamed"; additions: number; deletions: number; patch?: string };
export type TaskReview = {
  taskId: string;
  title: string;
  state: string;
  pr?: { repo: string; number: number; url: string };
  needsHuman: boolean;
  findings: string[];
  verdict?: string;
  gateId?: string;
  account: { linked: false } | { linked: true; login: string };
  files: PullRequestFileView[];
};
export type ReviewSubmission = { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string; comments?: { path: string; line: number; side?: "LEFT" | "RIGHT"; body: string }[] };
export type ReadyToMerge = { taskId: string; factory: string; title: string; pr: { repo: string; number: number; url: string; additions?: number; deletions?: number; changedFiles?: number }; previewUrl?: string; updatedAt: string };
