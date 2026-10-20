import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FakeProvider, type DecisionOutcome, type DecisionProvider } from "@kiln/decide";
import { InMemoryEventBus } from "@kiln/events";
import { adapterFor, type HarnessAdapter } from "@kiln/harness";
import type { Chat, Forge, PreviewProvider, RepoRef, Tracker } from "@kiln/integrations";
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
  askHumanTimeoutMs?: number;
  defaultBackend?: "local" | "docker" | "kubernetes";
  scoreAllRuns?: boolean;
  autoScore?: boolean;
  replayLimit?: number;
  canaryPercent?: number;
  canaryDays?: number;
  secretKey?: string;
  /** Token used when Kiln itself commits to config repos (GitHub App installation token). */
  forgeToken?: string;
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

  constructor(readonly options: KilnOptions) {
    this.store = options.store ?? new MemoryStore();
    this.objects = options.objects ?? new MemoryObjectStore();
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
    this.store.put(C.audit, entry);
  }

  auditLog(limit = 200): AuditEntry[] {
    return this.store
      .list<AuditEntry>(C.audit)
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
    const s = wi.source ?? { provider: "kiln" };
    try {
      if (s.provider === "slack" && s.channel && this.chat) {
        await this.chat.post({ channel: s.channel, thread: s.thread, text });
        this.bus.publish("message.posted", { channel: s.channel, thread: s.thread, text });
      } else if (s.provider === "github" && s.repo && s.number) {
        const [owner, name] = s.repo.split("/");
        await this.forge.comment({ owner: owner!, name: name! }, s.number, text);
      } else if ((s.provider === "linear" || s.provider === "jira") && (s.issueId ?? wi.trackerKey) && this.tracker) {
        await this.tracker.comment((s.issueId ?? wi.trackerKey)!, text);
      }
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
    for (const wi of this.workflow.list()) {
      if (wi.blockedReason === "waiting for CI" && wi.state === "building") await this.workflow.advance(wi.id);
    }
    this.improvement.evaluateCanaries();
    if (opts.selfImprovement) for (const f of this.defs.list()) if (f.appliedSha) await this.improvement.check(f.id);
  }
}
