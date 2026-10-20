import type {
  ApplyResult,
  BenchmarkResult,
  ConfigSummary,
  DefinitionRecord,
  FactoryBinding,
  FactoryMetrics,
  Gate,
  Memory,
  Project,
  Proposal,
  Roadmap,
  Run,
  RunEvent,
  Score,
  SkillListing,
  WorkItem,
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
  NotificationPrefs,
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
  BenchmarkResult,
  ConfigSummary,
  DefinitionRecord,
  FactoryBinding,
  FactoryMetrics,
  Gate,
  Memory,
  Project,
  Proposal,
  Roadmap,
  Run,
  RunEvent,
  Score,
  SkillListing,
  WorkItem,
};

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
export type InboxItem = Gate & { workItem?: Pick<WorkItem, "id" | "title" | "state" | "factory" | "pr" | "previewUrl" | "spec"> };
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
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        ...(this.options.team ? { "x-kiln-team": this.options.team } : {}),
        ...this.options.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    } as RequestInit);
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new KilnApiError(res.status, (data as { error?: string })?.error ?? `${method} ${path} returned ${res.status}`, data);
    return data as T;
  }

  private q(params: Record<string, string | number | undefined>) {
    const s = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return s ? `?${s}` : "";
  }

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
  send = (input: { factory: string; title: string; body?: string; projectId?: string; pipeline?: string; budgetUsd?: number; via?: "api" | "kiln" | "mcp" }) => this.request<WorkItem>("POST", "/api/v1/work-items", input);
  message = (id: string, text: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/messages`, { text });
  cancel = (id: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/cancel`);
  complete = (id: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/complete`);
  pull = (id: string) => this.request<{ workItem: WorkItem; branch: string; cloneUrl: string; repo: string; brief: string }>("POST", `/api/v1/work-items/${id}/pull`);
  handback = (id: string, text: string) => this.request<WorkItem>("POST", `/api/v1/work-items/${id}/handback`, { text });

  runs = (filter: { factory?: string; workItem?: string; agent?: string; kind?: string; limit?: number } = {}) => this.request<Run[]>("GET", `/api/v1/runs${this.q(filter)}`);
  run = (id: string) => this.request<Run & { live: boolean; scores: Score[] }>("GET", `/api/v1/runs/${id}`);
  runEvents = (id: string, after = 0) => this.request<RunEvent[]>("GET", `/api/v1/runs/${id}/events?after=${after}`);
  steer = (id: string, text: string) => this.request<{ ok: true }>("POST", `/api/v1/runs/${id}/steer`, { text });
  replay = (id: string, sha?: string) => this.request<Run>("POST", `/api/v1/runs/${id}/replay`, { sha });
  pauseRun = (id: string) => this.request<{ key: string }>("POST", `/api/v1/runs/${id}/pause`);
  resumeRun = (id: string) => this.request<Run>("POST", `/api/v1/runs/${id}/resume`);
  cancelRun = (id: string) => this.request<{ ok: true }>("POST", `/api/v1/runs/${id}/cancel`);
  saveBenchmark = (id: string, input: { suite: string; slug: string; title?: string; successCriteria?: string[]; tags?: string[] }) => this.request<{ files: Record<string, string> }>("POST", `/api/v1/runs/${id}/save-benchmark`, input);

  inbox = (opts: { assignee?: string; all?: boolean } = {}) => this.request<InboxItem[]>("GET", `/api/v1/inbox${this.q({ assignee: opts.assignee, all: opts.all ? 1 : undefined })}`);
  gate = (id: string) => this.request<Gate & { workItem?: WorkItem }>("GET", `/api/v1/gates/${id}`);
  decide = (id: string, decision: "approve" | "reject" | "answer", answer?: string, via?: string) => this.request<Gate>("POST", `/api/v1/gates/${id}/decide`, { decision, answer, via });

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

  audit = (limit = 200) => this.request<{ id: string; at: string; actor: string; action: string; target: string; details?: unknown }[]>("GET", `/api/v1/audit?limit=${limit}`);
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
  updateMe = (patch: { name?: string; email?: string; avatar?: string | null; appearance?: Appearance; notifications?: Partial<NotificationPrefs> }) => this.request<PublicUser>("PATCH", "/api/v1/me", patch);
  changePassword = (next: string, current?: string) => this.request<{ ok: true }>("PUT", "/api/v1/me/password", { next, current });
  uploadAvatar = (bytes: Uint8Array | ArrayBuffer | Blob, contentType: string) => this.upload<PublicUser>("PUT", "/api/v1/me/avatar", bytes, contentType);
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
  modelKeys = (team: string) => this.request<Record<ModelKeyProvider, { set: boolean; updatedAt?: string; updatedBy?: string }>>("GET", `/api/v1/teams/${encodeURIComponent(team)}/model-keys`);
  setModelKey = (team: string, provider: ModelKeyProvider, value: string | Record<string, string>) => this.request<SecretMeta>("PUT", `/api/v1/teams/${encodeURIComponent(team)}/model-keys/${provider}`, { value });
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
}
