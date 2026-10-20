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
    private readonly options: { baseUrl: string; token?: string; fetch?: typeof fetch; headers?: Record<string, string> },
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
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
  me = () => this.request<{ subject: string; grants: { scope: string; factory: string }[] }>("GET", "/api/v1/me");

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
  approveProposal = (id: string) => this.request<Proposal>("POST", `/api/v1/proposals/${id}/approve`, {});
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
}
