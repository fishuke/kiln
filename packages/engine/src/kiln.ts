import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FakeProvider, type DecisionOutcome, type DecisionProvider } from "@kiln/decide";
import { InMemoryEventBus } from "@kiln/events";
import { adapterFor, type HarnessAdapter } from "@kiln/harness";
import type { Chat, ConnectionProvider, ConnectionProviderId, Forge, Mailer, PreviewProvider, RepoRef, Tracker } from "@kiln/integrations";
import { ConnectionService, IdentityService } from "./connections";
import { IntegrationHub, type IntegrationAdapters } from "./integration-hub";
import { WebhookSourceService } from "./webhook-sources";
import { LocalSandboxProvider, type SandboxProvider } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import { MemoryObjectStore, MemoryStore, type ObjectStore, type Store } from "@kiln/store";
import { AutomationService } from "./automations";
import { BenchmarkService } from "./benchmarks";
import { DefinitionService } from "./definitions";
import { GateService } from "./gates";
import { ImprovementService, RuleImprover, type Improver } from "./improvement";
import { MemoryService } from "./memories";
import { MetricsService } from "./metrics";
import { AccountService, EnvironmentService, McpRegistry, NotificationService, type EcrTokenProvider, SecretVault, StorageRouter, TeamService, UsageService, UserService } from "./platform";
import { PlanningService, type Planner } from "./planning";
import { RunService } from "./runs";
import { DecisionJudge, ScoringService, type Judge } from "./scoring";
import { SecretsBroker } from "./secrets";
import { SkillService } from "./skills";
import { C, newId, systemClock, type AuditEntry, type Clock, type DecisionLog, type WorkItem } from "./types";
import { Workflow } from "./workflow";

export type KilnOptions = {
  forge: Forge;
  store?: Store;
  objects?: ObjectStore;
  clock?: Clock;
  tracker?: Tracker;
  chat?: Chat;
  preview?: PreviewProvider;
  sandboxes?: Partial<Record<"local" | "docker" | "kubernetes", SandboxProvider>>;
  harness?: (type: HarnessType, agentType: string) => HarnessAdapter;
  decide?: { primary: DecisionProvider; fallback?: DecisionProvider };
  judge?: Judge;
  improver?: Improver;
  planner?: Planner;
  /** Where agents reach the API (guard hook, MCP). */
  publicUrl?: string;
  /** Where people open links (inbox, runs). */
  webUrl?: string;
  roles?: Record<string, string[]>;
  /** Maps provider identities to people, e.g. { "slack:U024BE7LH": "po@acme.test", "github:alice": "alice@acme.test" }. */
  identities?: Record<string, string>;
  askHumanTimeoutMs?: number;
  defaultBackend?: "local" | "docker" | "kubernetes";
  scoreAllRuns?: boolean;
  autoScore?: boolean;
  replayLimit?: number;
  canaryPercent?: number;
  canaryDays?: number;
  secretKey?: string;
  /** Server admins (KILN_ADMIN_EMAILS): users who see every team's audit log, tokens and server secrets. */
  serverAdmins?: string[];
  /** Email for notifications (KILN_SMTP_URL). */
  mailer?: Mailer;
  /** Chat adapters for direct-message notifications, by provider key; the main `chat` is used when it is real. */
  chats?: Partial<Record<"slack" | "discord", Chat>>;
  /** ECR pull passwords for aws_ecr registry credentials (default: the AWS CLI). */
  ecr?: EcrTokenProvider;
  /** Root folder for teams' local storage folders (default .data/storage). */
  storageRoot?: string;
  /** Token used when Kiln itself commits to config repos (GitHub App installation token). */
  forgeToken?: string;
  /** Workspace connections Kiln can make (GitHub, GitLab, Slack, Teams, Discord, Linear, Jira…). */
  connectionProviders?: Partial<Record<ConnectionProviderId, ConnectionProvider>>;
  /** Adapters for providers beyond the primary forge, tracker and chat. */
  adapters?: IntegrationAdapters;
};

/** The composition root: every service, wired to one store, bus and clock. */
export class Kiln {
  readonly store: Store;
  readonly objects: ObjectStore;
  readonly clock: Clock;
  readonly bus: InMemoryEventBus;
  readonly forge: Forge;
  readonly tracker?: Tracker;
  readonly chat?: Chat;
  readonly preview?: PreviewProvider;
  readonly sandboxes: Partial<Record<"local" | "docker" | "kubernetes", SandboxProvider>>;
  readonly decide: { primary: DecisionProvider; fallback?: DecisionProvider };
  readonly judge: Judge;
  readonly improver: Improver;
  readonly planner?: Planner;
  readonly secrets: SecretsBroker;
  readonly stopping = new Map<string, "pause" | "cancel">();

  readonly defs: DefinitionService;
  readonly runs: RunService;
  readonly gates: GateService;
  readonly workflow: Workflow;
  readonly automations: AutomationService;
  readonly scoring: ScoringService;
  readonly improvement: ImprovementService;
  readonly benchmarks: BenchmarkService;
  readonly metrics: MetricsService;
  readonly planning: PlanningService;
  readonly memories: MemoryService;
  readonly skills: SkillService;
  readonly connections: ConnectionService;
  readonly identities: IdentityService;
  readonly webhookSources: WebhookSourceService;
  readonly integrations: IntegrationHub;

  // platform: identity, teams, settings, credentials
  readonly users: UserService;
  readonly teams: TeamService;
  readonly accounts: AccountService;
  readonly vault: SecretVault;
  readonly mcp: McpRegistry;
  readonly environments: EnvironmentService;
  readonly usage: UsageService;
  /** Routes artifacts, transcripts and attachments to each team's storage; `objects` is this router. */
  readonly storage: StorageRouter;
  readonly notifications: NotificationService;

  constructor(readonly options: KilnOptions) {
    this.store = options.store ?? new MemoryStore();
    this.storage = new StorageRouter(this, options.objects ?? new MemoryObjectStore());
    this.objects = this.storage;
    this.clock = options.clock ?? systemClock;
    this.bus = new InMemoryEventBus(() => this.clock.now());
    this.forge = options.forge;
    this.tracker = options.tracker;
    this.chat = options.chat;
    this.preview = options.preview;
    this.sandboxes = { local: new LocalSandboxProvider(), ...options.sandboxes };
    this.decide = options.decide ?? { primary: new FakeProvider(), fallback: new FakeProvider() };
    this.judge = options.judge ?? new DecisionJudge(this.decide.primary);
    this.improver = options.improver ?? new RuleImprover();
    this.planner = options.planner;
    this.secrets = new SecretsBroker(this.store, this.clock, options.secretKey);

    this.defs = new DefinitionService(this);
    this.runs = new RunService(this);
    this.gates = new GateService(this);
    this.workflow = new Workflow(this);
    this.automations = new AutomationService(this);
    this.scoring = new ScoringService(this);
    this.improvement = new ImprovementService(this);
    this.benchmarks = new BenchmarkService(this);
    this.metrics = new MetricsService(this);
    this.planning = new PlanningService(this);
    this.memories = new MemoryService(this);
    this.skills = new SkillService(this);
    this.users = new UserService(this);
    this.teams = new TeamService(this);
    this.accounts = new AccountService(this);
    this.vault = new SecretVault(this);
    this.mcp = new McpRegistry(this);
    this.environments = new EnvironmentService(this);
    this.usage = new UsageService(this);
    this.connections = new ConnectionService(this, options.connectionProviders);
    this.identities = new IdentityService(this);
    this.webhookSources = new WebhookSourceService(this);
    this.integrations = new IntegrationHub(this, options.adapters);

    // Routing labels on the factory's repositories, PR attribution and Linear session progress.
    this.bus.subscribe("definition.applied", async (e) => {
      if (!e.payload.canaryPercent) await this.integrations.ensureFactoryLabels(e.payload.factory);
    });
    this.bus.subscribe("pull_request.opened", async (e) => this.integrations.onPullRequestOpened(e.payload));
    this.bus.subscribe("work_item.stage_changed", async (e) => {
      const wi = this.workflow.get(e.payload.workItemId);
      if (wi) await this.integrations.onStageChanged(wi, e.payload.to);
    });
    this.notifications = new NotificationService(this);
    this.notifications.subscribe();

    // `provider: factory, event: work_item_stage_changed` automations react to stage changes in their own factory.
    this.bus.subscribe("work_item.stage_changed", async (e) => {
      const { factory, workItemId, from, to } = e.payload;
      const wi = this.workflow.get(workItemId);
      if (!wi || wi.source.automation?.startsWith("stage:")) return;
      await this.automations.handleFactoryEvent(factory, { provider: "factory", event: "work_item_stage_changed", data: { from, to, workItemId, title: `${wi.title} → ${to}`, body: wi.body } });
    });

    if (options.autoScore !== false) {
      this.bus.subscribe("run.finished", async (e) => {
        const run = this.runs.get(e.payload.runId);
        if (run?.kind === "work") await this.scoring.scoreRun(run.id);
      });
    }
  }

  harnessFor(type: HarnessType, agentType: string): HarnessAdapter {
    return this.options.harness ? this.options.harness(type, agentType) : adapterFor(type);
  }

  link(path: string): string {
    return `${(this.options.webUrl ?? this.options.publicUrl ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
  }

  audit(actor: string, action: string, target: string, details?: unknown) {
    const entry: AuditEntry = { id: newId("audit"), at: this.clock.now().toISOString(), actor, action, target, details };
    const team = this.auditTeam(target, details);
    if (team) entry.team = team;
    this.store.put(C.audit, entry);
  }

  /** The team an audit entry belongs to, from its target or details, so team admins see only their team's log. */
  private auditTeam(target: string, details: unknown): string | undefined {
    const d = (details ?? {}) as Record<string, unknown>;
    if (typeof d.team === "string" && d.team.startsWith("team_")) return d.team;
    if (target.startsWith("team_")) return target;
    if (target.startsWith("usr_")) return this.teams.teamsOf(target)[0]?.id;
    const scoped = /^(?:team):(team_[^:]+):/.exec(target);
    if (scoped) return scoped[1];
    const personal = /^personal:([^:]+):/.exec(target);
    if (personal) return this.teams.teamsOf(personal[1]!)[0]?.id;
    try {
      if (this.defs.get(target)) return this.teams.factoryTeam(target);
      const wi = target.startsWith("wi_") ? this.store.get<WorkItem>(C.workItems, target) : undefined;
      if (wi) return this.teams.factoryTeam(wi.factory);
      const run = target.startsWith("run_") ? this.store.get<{ id: string; factory: string; team?: string }>(C.runs, target) : undefined;
      if (run) return run.team ?? this.teams.factoryTeam(run.factory);
      const owned = this.store.get<{ id: string; factory?: string; teamId?: string }>(C.gates, target) ?? this.store.get(C.proposals, target) ?? this.store.get(C.memories, target) ?? this.store.get("mcp_servers", target) ?? this.store.get("environments", target);
      if (owned?.teamId) return owned.teamId;
      if (owned?.factory) return this.teams.factoryTeam(owned.factory);
      const token = target.startsWith("tok_") ? this.store.get<{ id: string; teamId?: string; userId?: string }>("api_tokens", target) : undefined;
      if (token?.teamId) return token.teamId;
      if (token?.userId) return this.teams.teamsOf(token.userId)[0]?.id;
      if (typeof d.factory === "string" && this.defs.get(d.factory)) return this.teams.factoryTeam(d.factory);
    } catch {
      /* attribution is best effort */
    }
    return undefined;
  }

  auditLog(limit = 200, team?: string): AuditEntry[] {
    return this.store
      .list<AuditEntry>(C.audit, (a) => !team || a.team === team)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  logDecision(outcome: DecisionOutcome, state: unknown, refs: { workItemId?: string; runId?: string } = {}) {
    const log: DecisionLog = {
      id: newId("dec"),
      decision: outcome.decision,
      action: outcome.action,
      provider: outcome.provider,
      fellBack: outcome.fellBack,
      answers: outcome.answers,
      state,
      latencyMs: outcome.latencyMs,
      at: this.clock.now().toISOString(),
      ...refs,
    };
    this.store.put(C.decisions, log);
    this.bus.publish("decision.made", { decision: outcome.decision, action: outcome.action, provider: outcome.provider, workItemId: refs.workItemId });
  }

  /** Post back where the work started: the Slack thread, the issue or the PR. */
  async notify(wi: WorkItem, text: string) {
    try {
      await this.integrations.notify(wi, text);
    } catch (err) {
      this.audit("kiln", "notify.failed", wi.id, { error: err instanceof Error ? err.message : String(err) });
    }
    const fresh = this.workflow.get(wi.id);
    if (fresh) {
      fresh.conversation.push({ at: this.clock.now().toISOString(), from: "foreman", role: "foreman", text });
      this.store.put(C.workItems, fresh);
    }
  }

  forgeHasBranch(repo: RepoRef, branch: string): boolean {
    const f = this.forge as Forge & { branchSha?: (r: RepoRef, b: string) => string | undefined };
    return f.branchSha ? Boolean(f.branchSha(repo, branch)) : true;
  }

  /** Kiln's own commits (self-improvement, skills, memories, routers) to a config repo branch. */
  async commitFiles(repo: RepoRef & { ref?: string }, branch: string, files: Record<string, string>, message: string) {
    const work = mkdtempSync(join(tmpdir(), "kiln-commit-"));
    const env = { ...process.env, KILN_PUSH_AS: "agent:kiln" };
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, env, stdio: "pipe" }).toString();
    try {
      git("clone", "-q", this.forge.cloneUrl(repo, this.options.forgeToken), ".");
      git("checkout", "-q", "-B", branch, `origin/${repo.ref ?? "main"}`);
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(work, path)), { recursive: true });
        writeFileSync(join(work, path), content);
      }
      git("add", "-A");
      git("-c", "user.name=kiln[bot]", "-c", "user.email=kiln@kiln.local", "commit", "-q", "-m", message);
      git("push", "-q", "-f", "origin", `HEAD:refs/heads/${branch}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** One pass of timers: gate nudges and expiry, schedules, CI waits, canaries, self-improvement. */
  async tick(opts: { selfImprovement?: boolean } = {}) {
    await this.gates.tick();
    await this.automations.tick();
    await this.notifications.tick();
    for (const wi of this.workflow.list()) {
      if (wi.blockedReason === "waiting for CI" && wi.state === "building") await this.workflow.advance(wi.id);
    }
    this.improvement.evaluateCanaries();
    if (opts.selfImprovement) for (const f of this.defs.list()) if (f.appliedSha) await this.improvement.check(f.id);
  }
}
