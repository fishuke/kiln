import { randomBytes } from "node:crypto";
import { z } from "zod";
import { BUILTIN_DECISIONS, guardCommand, runDecision } from "@kiln/decide";
import type { DefinitionTree, ResolvedAgent, ResolvedFactory } from "@kiln/definitions";
import type { HarnessSession } from "@kiln/harness";
import { repoKey, type RepoRef } from "@kiln/integrations";
import { hashDir, withGuard, type RegistryAuth, type Sandbox, type SandboxProvider, type SandboxRunner, type SnapshotRef } from "@kiln/sandbox";
import type { HarnessType, Runner } from "@kiln/schema";
import { classifyError, KilnError, retriesAutomatically, runStatusFor } from "./errors";
import type { Kiln } from "./kiln";
import { appRunDefinition, factoryRunDefinition, type AppRunDefinition, type RunDefinition } from "./run-definition";
import { fileUrl, mediaOf } from "./media";
import { codexHome, parseChatgptAuth, redactChatgptTokens } from "./platform/chatgpt";
import type { PoolCredential } from "./platform/credential-pool";
import { registryAuthFor } from "./platform/registry";
import { checkMetadata, isTerminal, sourceFor } from "./run-state";
import {
  C,
  DEFAULT_RUNNER_IMAGE,
  newId,
  type Artifact,
  type Attachment,
  type ExecutionOverrides,
  type Run,
  type RunEvent,
  type RunKind,
  type RunMode,
  type RunSource,
  type WorkItem,
} from "./types";
import type { RemoteSession, WorkerJob } from "./workers";

export { fileUrl, mediaOf } from "./media";

/** A run name: lowercase letters, digits and dashes, starting with a letter or digit. */
const RUN_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Why a reporting child ended, for its parent. */
function reportReason(run: Run): "finished" | "failed" | "stopped" | "out_of_budget" {
  if (run.status === "succeeded") return "finished";
  if (run.error?.code === "budget_exceeded") return "out_of_budget";
  if (run.status === "failed" || run.status === "error") return "failed";
  return "stopped";
}

export type ExecuteInput = {
  factory: string;
  sha: string;
  /** Run under a candidate tree instead of a stored definition (replays of proposals). */
  tree?: DefinitionTree;
  agent: string;
  prompt: string;
  kind?: RunKind;
  stage?: string;
  workItem?: WorkItem;
  branch?: string;
  /** Check out exact commits, for replays and benchmarks. */
  pinned?: Record<string, string>;
  repos?: RepoRef[];
  /** Run-level overrides: replay/benchmark model or harness, or an automation's execution overrides. */
  overrides?: { model?: string; harness?: HarnessType | string; workerHost?: string | null } & Omit<ExecutionOverrides, "model" | "harness" | "workerHost">;
  replayOf?: string;
  push?: boolean;
  collect?: (sandbox: Sandbox, cwd: string, run: Run) => Promise<void>;
  extraInstructions?: string;
  files?: Record<string, string>;
  /** Uploaded files placed in the workspace under .kiln/attachments/. */
  attachments?: Attachment[];
  /** Set when this run is a subagent of another run. */
  parentRunId?: string;
  /** A Studio App's run: its agents come from KilnOptions.apps; pass `factory: "app:<id>"`. */
  app?: string;
  /** See Run.name and Run.reportToParent. */
  name?: string;
  reportToParent?: boolean;
  backend?: "local" | "docker" | "kubernetes";
  source?: RunSource;
  title?: string;
  creator?: string;
  metadata?: Record<string, string>;
  mode?: RunMode;
  idleTimeoutMinutes?: number;
  continuationOf?: string;
  /** Called once, as soon as the run record exists (before the agent starts). */
  onCreated?: (run: Run) => void;
  /** Attempts for retryable platform errors (default 3). */
  maxAttempts?: number;
  /** The user who triggered the run (defaults to the work item's requester when they have an account). */
  triggeredBy?: string;
};

/** Replace known secret values in run output. */
export function redact(text: string, values: string[]): string {
  let out = text;
  for (const v of values) if (v && out.includes(v)) out = out.split(v).join("[redacted]");
  return out;
}

const RESULT_PROTOCOL: Record<string, string> = {
  TRIAGE: '{"kind": "feature|bug|chore|incident|question", "size": "xs|s|m|l|xl", "summary": "...", "duplicateOf": "optional issue key"}',
  FOREMAN: '{"dispatch": {"stage": "triage|spec|build|review|handoff", "agent": "name", "context": "..."}} or {"ask": "question for the requester"}',
  SPEC: '{"specPath": "docs/specs/<id>.md", "why": "...", "goal": "...", "approach": "...", "criteria": ["AC1: ..."], "stories": ["..."], "outOfScope": ["..."], "risks": ["..."], "openQuestions": ["..."]}',
  IMPLEMENT:
    '{"summary": "...", "testsPassed": true, "pr": {"title": "feat(scope): outcome in lowercase", "body": "## Why\\n...\\n\\n## What\\n- ...\\n\\n## Verification\\n- ..."}, "memories": [{"title": "...", "body": "..."}]}',
  VERIFY: '{"testsPassed": true, "playwrightReport": "playwright-report/results.json"}',
  REVIEW: '{"verdict": "accepted|changes_requested|needs_human", "findings": ["file:line — issue — fix"]}',
  PLAN: '{"epics": [{"title": "...", "milestone": "...", "dependsOn": [], "issues": [{"title": "...", "body": "...", "criteria": ["..."], "factory": "alias"}]}]}',
  CUSTOM: '{"summary": "..."}',
};

const ReportedPullRequest = z.object({ title: z.string().trim().min(1).max(256), body: z.string().trim().min(1) });

/** The pull request title and description an implement agent reported in `.kiln/result.json`, when it gave a valid one. */
export function reportedPullRequest(result: Record<string, unknown> | undefined): { title: string; body: string } | undefined {
  const parsed = ReportedPullRequest.safeParse(result?.pr);
  return parsed.success ? parsed.data : undefined;
}

export function resultProtocol(agentType: string): string {
  const shape = RESULT_PROTOCOL[agentType] ?? RESULT_PROTOCOL.CUSTOM!;
  return [
    "## Reporting back to Kiln",
    "When you finish, write `.kiln/result.json` in the repository root (it is git-ignored) with this shape:",
    "```json",
    shape,
    "```",
    "Commit your changes on the current branch. Do not push, open pull requests or merge: Kiln pushes your branch with a scoped token and a human merges.",
    "Save screenshots (PNG) and screen recordings (WebM or MP4) that show your work in `.kiln/artifacts/`; reviewers see them next to the pull request.",
    "Files people attached to the request are in `.kiln/attachments/`.",
  ].join("\n");
}

/** Extra instructions for the plan and orchestrate modes. */
/** Where the browser saves screenshots and videos; collected with the run's other artifacts. */
const BROWSER_OUT = ".kiln/artifacts/browser";

export const BROWSER_INSTRUCTIONS = [
  "## Browser",
  "You have a browser (the `browser` MCP server). Use it to check UI changes the way a person would.",
  `- For each acceptance criterion you can show in the UI, record a video: browser_start_video, then browser_video_show_actions so clicks and typing are annotated, browser_video_chapter with the criterion's id (AC1, AC2 …) before each part, and browser_stop_video when done.`,
  "- Take a screenshot (browser_take_screenshot) of the final state of each change.",
  `- Files land in \`${BROWSER_OUT}/\`. Kiln attaches them to the run and the pull request.`,
].join("\n");

/** The browser for computer use: Claude Code agents unless the agent sets `computerUse: false`. */
export function browserServer(k: Pick<Kiln, "options">, harness: HarnessType, agent: Pick<ResolvedAgent, "computerUse">) {
  const mcp = k.options.browserMcp ?? { command: "npx", args: ["-y", "@playwright/mcp@0.0.83"] };
  if (mcp === false || harness !== "claude-code" || agent.computerUse === false) return undefined;
  return {
    name: "browser",
    command: mcp.command,
    args: [
      ...(mcp.args ?? []),
      "--headless",
      "--isolated",
      "--no-sandbox",
      "--caps=devtools,vision",
      "--output-dir",
      BROWSER_OUT,
      "--viewport-size",
      "1280,720",
    ],
  };
}

export function modeInstructions(mode: RunMode | undefined): string {
  if (mode === "plan")
    return [
      "## Plan mode",
      "Do not change any files yet. Research the request and write a step-by-step plan: what you will change, where, how you will verify it, and the open questions.",
      'Put the plan in `.kiln/result.json` as `{"plan": "<markdown>", "summary": "<one line>"}`. A person approves the plan before anyone executes it.',
    ].join("\n");
  if (mode === "orchestrate")
    return [
      "## Orchestrate mode",
      "Split the work into parts that can run on their own and hand each to a subagent with the Kiln MCP tool `spawn_agent` (or `run_agents` for several at once).",
      "Give every subagent a complete brief. Follow them with `get_run`, combine their results, and report one answer.",
    ].join("\n");
  return "";
}

const DEFAULT_RUNNER = (backend: Runner["backend"]): SandboxRunner => ({ image: "node:22-bookworm", backend, setupCommands: [], egress: [] });

type Prepared = {
  run: Run;
  input: ExecuteInput;
  resolved: RunDefinition;
  /** Set for a Studio App's run. */
  app?: AppRunDefinition;
  agent: ResolvedAgent;
  harnessType: HarnessType;
  model?: string;
  runner: SandboxRunner;
  deniedHosts: string[];
  repos: RepoRef[];
  token: string;
  instructions: string;
  attachments: Attachment[];
  workerHost?: string;
  team?: string;
  userId?: string;
  /** Secrets of the run's environment, given to the agent with its own. */
  environmentSecrets: string[];
  envRef?: string;
  /** Pull credential for a private runner image. */
  registryAuth?: RegistryAuth;
};

export class RunService {
  private readonly sessions = new Map<string, HarnessSession>();
  /** Runs working in a workspace the WorkspaceProvider lent them: released, never destroyed. */
  private readonly borrowed = new Set<string>();
  private readonly remotes = new Map<string, RemoteSession>();
  private readonly sandboxes = new Map<string, Sandbox>();
  /** Forge credentials given to a run's sandbox, redacted from its output. */
  private readonly forgeTokens = new Map<string, string[]>();
  private readonly specs = new Map<string, SandboxRunner>();
  /** The in-memory record of each live run, so steering and cost updates land on the copy that is saved last. */
  private readonly live = new Map<string, Run>();
  /** Secret values each live run was given; redacted from its events and summary. */
  private readonly redactions = new Map<string, string[]>();
  /** Runs holding a ChatGPT login: saved back (Codex may have refreshed it) and released when the run ends. */
  private readonly chatgptLogins = new Map<string, { credential: PoolCredential; sandbox: Sandbox; home: string }>();
  /** The pooled credential each live run was given; its usage and outcome are recorded on exactly that one. */
  private readonly pooled = new Map<string, PoolCredential>();

  constructor(private readonly k: Kiln) {}

  get(id: string) {
    return this.live.get(id) ? structuredClone(this.live.get(id)!) : this.k.store.get<Run>(C.runs, id);
  }

  list(filter: { factory?: string; workItemId?: string; agent?: string; kind?: RunKind } = {}) {
    return this.k.store
      .list<Run>(
        C.runs,
        (r) =>
          (!filter.factory || r.factory === filter.factory) &&
          (!filter.workItemId || r.workItemId === filter.workItemId) &&
          (!filter.agent || r.agent === filter.agent) &&
          (!filter.kind || r.kind === filter.kind),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** A run's definition: its factory's resolved tree (by sha, or a candidate tree), or its Studio App's. */
  private definitionOf(input: { app?: string; sha: string; tree?: DefinitionTree }): { def: RunDefinition; app?: AppRunDefinition } {
    if (input.app) {
      if (!this.k.options.apps) throw new KilnError("integration_not_configured", `run for app ${input.app}, but this server has no Studio`);
      const app = this.k.options.apps.definition(input.app);
      return { def: appRunDefinition(app), app };
    }
    return { def: factoryRunDefinition(input.tree ? this.k.defs.resolveTree(input.tree) : this.k.defs.resolved(input.sha)) };
  }

  /** The decisions a run's definition sets, such as its command guard (the guard endpoint reads these). */
  decisionsFor(run: Pick<Run, "app" | "definitionSha">): RunDefinition["decisions"] {
    return this.definitionOf({ ...(run.app ? { app: run.app } : {}), sha: run.definitionSha }).def.decisions;
  }

  /** What `factory` (a factory id, or `app:<id>`) spent on runs since the first of this month. */
  monthSpend(factory: string): number {
    const start = new Date(this.k.clock.now());
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return this.list({ factory }).filter((x) => x.startedAt >= start.toISOString()).reduce((s, x) => s + x.costUsd, 0);
  }

  /** Throws budget_exceeded when `factory` has spent its monthly budget. */
  assertMonthlyBudget(factory: string, monthlyUsd: number) {
    const spent = this.monthSpend(factory);
    if (spent >= monthlyUsd) throw new KilnError("budget_exceeded", `monthly budget of $${monthlyUsd} for ${factory} reached ($${spent.toFixed(2)} spent)`);
  }

  /** The latest run named `name` in the tree `runId` belongs to (a continuation keeps its run's name). */
  byName(runId: string, name: string): Run | undefined {
    const run = this.get(runId);
    if (!run) return undefined;
    const root = run.rootRunId ?? run.id;
    return this.k.store
      .list<Run>(C.runs, (r) => r.name === name && (r.rootRunId ?? r.id) === root)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((r) => this.get(r.id)!)[0];
  }

  /** A run's conversation so far, for a forked child: the request, the agent's messages and people's steering. */
  private forkContext(runId: string): string {
    const lines = this.k.runQuery
      .conversation(runId)
      .messages.filter((m) => m.type === "prompt" || m.type === "message" || m.type === "steer")
      .map((m) => `### ${m.role === "user" ? "User" : "Agent"}\n${m.text}`);
    return `## Conversation so far (forked from run ${runId})\n\n${lines.join("\n\n")}`;
  }

  /** A child that reports to its parent asked a question (ask_user): tell the parent. */
  async reportQuestion(runId: string, question: string) {
    const run = this.get(runId);
    if (!run) throw new KilnError("resource_not_found", `unknown run ${runId}`);
    if (run.reportToParent && run.parentRunId) await this.reportToParent(run, "needs_input", question);
  }

  /** Deliver a child's report to its parent as a follow-up: steers it when live, continues it when it finished. */
  private async reportToParent(run: Run, reason: "finished" | "failed" | "stopped" | "out_of_budget" | "needs_input", question?: string) {
    const branch = run.startState.repos[0]?.branch;
    const report = [
      `## Report from ${run.name ?? run.agent} (run ${run.id})`,
      `Reason: ${reason}`,
      ...(run.title ? [`Title: ${run.title}`] : []),
      ...(run.summary ? [`Summary: ${run.summary}`] : []),
      ...(branch ? [`Branch: ${branch}`] : []),
      ...(question ? [`Question: ${question}`] : []),
    ].join("\n");
    try {
      await this.followup(run.parentRunId!, { message: report, by: `agent:${run.agent}` });
    } catch (err) {
      // The child's own outcome stands; its record shows the report didn't arrive.
      this.record(run, "error", `could not report to run ${run.parentRunId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  events(runId: string, afterSeq = 0): RunEvent[] {
    return this.k.store.list<RunEvent>(C.runEvents, (e) => e.runId === runId && e.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }

  isActive(runId: string) {
    return this.sessions.has(runId) || this.remotes.has(runId);
  }

  /**
   * Runs live in this process, so after a restart none is still going: each one saved as going
   * stops as blocked (a follow-up continues it) and its open command question closes.
   */
  recoverInterrupted(): Run[] {
    const now = this.k.clock.now().toISOString();
    const stale = this.k.store.list<Run>(C.runs, (r) => ["queued", "claimed", "running"].includes(r.status) && !this.isActive(r.id) && !this.live.has(r.id));
    const message = "Kiln restarted while this run was going. Send a follow-up or retry to continue.";
    for (const run of stale) {
      run.status = "blocked";
      run.error = { code: "interrupted_by_restart", message, retryable: false };
      run.summary = message;
      run.finishedAt = now;
      this.record(run, "error", `interrupted_by_restart: ${message}`, { code: "interrupted_by_restart", retryable: false });
      this.record(run, "finished", run.status, { costUsd: run.costUsd });
      this.save(run);
    }
    const ids = new Set(stale.map((r) => r.id));
    for (const g of this.k.gates.list({ state: "open" }))
      if (g.command && g.runId && ids.has(g.runId)) this.k.store.put(C.gates, { ...g, state: "expired", decidedBy: "kiln:restart", decidedAt: now });
    return stale;
  }

  /** Runs started by this run, recursively. */
  descendants(runId: string): Run[] {
    const all = this.k.store.list<Run>(C.runs);
    const out: Run[] = [];
    const walk = (id: string) => {
      for (const r of all.filter((x) => x.parentRunId === id)) {
        out.push(r);
        walk(r.id);
      }
    };
    walk(runId);
    return out;
  }

  /** Text and data a live run reports, without the secret values it was given. */
  private redacted<T>(run: Run, text: string | undefined, data?: T): { text: string | undefined; data: T | undefined } {
    const secrets = this.redactions.get(run.id);
    if (secrets?.length) {
      if (text) text = redact(text, secrets);
      if (data !== undefined)
        data = JSON.parse(
          redact(
            JSON.stringify(data),
            secrets.map((s) => JSON.stringify(s).slice(1, -1)),
          ),
        );
    }
    // Codex may refresh a ChatGPT login mid-run; the new tokens are not in the list above, so match their shape.
    if (this.chatgptLogins.has(run.id)) {
      if (text) text = redactChatgptTokens(text);
      if (data !== undefined) data = JSON.parse(redactChatgptTokens(JSON.stringify(data)));
    }
    return { text, data };
  }

  private record(run: Run, type: string, text?: string, data?: unknown) {
    ({ text, data } = this.redacted(run, text, data));
    run.eventCount += 1;
    const ev: RunEvent = { id: `${run.id}:${run.eventCount}`, runId: run.id, seq: run.eventCount, at: this.k.clock.now().toISOString(), type, text, data };
    this.k.store.put(C.runEvents, ev);
    this.k.bus.publish("run.event", { runId: run.id, seq: ev.seq, type, text, data });
  }

  private save(run: Run) {
    this.k.store.put(C.runs, run);
  }

  resolveModel(resolved: RunDefinition, model: string | undefined, prompt: string): Promise<string | undefined> | string | undefined {
    if (!model?.startsWith("router:")) return model;
    const router = resolved.routers[model.slice(7)];
    if (!router) return undefined;
    if (router.type === "prompt") {
      const words = new Set(prompt.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const best = router.routing
        .map((r) => ({ r, hits: (r.description.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length }))
        .sort((a, b) => b.hits - a.hits)[0];
      return best && best.hits > 0 ? best.r.model : router.default;
    }
    return runDecision(
      "model-router",
      resolved.decisions["model-router"] ?? BUILTIN_DECISIONS["model-router"]!,
      { title: prompt.slice(0, 200), body: prompt },
      this.k.decide,
    ).then((o) => (o.action === "easy" ? router.routing.easy : o.action === "hard" ? router.routing.hard : router.routing.medium) ?? router.default);
  }

  private provider(backend: Runner["backend"] | undefined): SandboxProvider {
    const p = this.k.sandboxes[backend ?? this.k.options.defaultBackend ?? "local"] ?? this.k.sandboxes.local;
    if (!p) throw new Error(`no sandbox provider for ${backend}`);
    return p;
  }

  /** Start a run and resolve as soon as its record exists; the run continues in the background. */
  startInBackground(input: ExecuteInput): Promise<Run> {
    return new Promise<Run>((resolve, reject) => {
      let created = false;
      this.execute({
        ...input,
        onCreated: (run) => {
          created = true;
          input.onCreated?.(run);
          resolve(structuredClone(run));
        },
      }).then(
        (run) => {
          if (!created) resolve(run);
        },
        (err) => {
          if (!created) reject(err);
        },
      );
    });
  }

  /**
   * Run an agent to completion and return the finished run. Retryable platform errors
   * (internal_error, resource_unavailable) are retried on the same run record.
   */
  async execute(input: ExecuteInput): Promise<Run> {
    const max = Math.max(1, input.maxAttempts ?? this.k.options.maxRunAttempts ?? 3);
    let run = await this.executeOnce(input);
    while (run.status === "error" && retriesAutomatically(run.error) && (run.attempt ?? 1) < max) {
      // Wait before trying again: a restart or a network blip needs a moment to pass.
      const delays = this.k.options.retryDelaysMs ?? [5_000, 20_000, 60_000];
      const wait = delays[Math.min((run.attempt ?? 1) - 1, delays.length - 1)] ?? 0;
      this.record(run, "retry", `attempt ${(run.attempt ?? 1) + 1} in ${Math.round(wait / 1000)}s after ${run.error!.code}: ${run.error!.message}`);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      run = await this.executeOnce(input, run);
    }
    return run;
  }

  private async prepare(input: ExecuteInput, prior?: Run): Promise<Prepared> {
    const { def: resolved, app } = this.definitionOf(input);
    const agent: ResolvedAgent | undefined = resolved.agents[input.agent];
    if (!agent) throw new KilnError("resource_not_found", `factory ${input.factory} has no agent ${input.agent}`);
    const metaError = checkMetadata(input.metadata);
    if (metaError) throw new KilnError("invalid_request", metaError);
    const harnessType = (input.overrides?.harness ?? agent.harness.type) as HarnessType;
    const model = await this.resolveModel(resolved, input.overrides?.model ?? agent.harness.model, input.prompt);
    const team = app ? app.team : this.k.teams.factoryTeam(input.factory);
    this.k.usage.assertWithinBudget(team);
    if (app?.monthlyUsd !== undefined) this.assertMonthlyBudget(input.factory, app.monthlyUsd);
    const user = input.triggeredBy ? this.k.users.get(input.triggeredBy) : this.k.users.forRequester(input.workItem?.requester);
    const automationEnv = input.workItem?.source.automation ? resolved.automations[input.workItem.source.automation]?.environmentId : undefined;
    // An automation's environmentId override selects the team environment for this run.
    const envRef = input.overrides?.environmentId ?? automationEnv ?? agent.environmentId;
    const environment = envRef ? this.k.environments.get(team, envRef) : undefined;
    if (envRef && !environment) throw new KilnError("resource_not_found", `environment ${envRef} is not defined for this team`);
    const runnerName = input.overrides?.runner ?? agent.runner;
    const declared: Runner | undefined = runnerName ? resolved.runners[runnerName] : undefined;
    const teamSettings = team ? this.k.teams.settings(team) : undefined;
    const host = teamSettings?.defaultSandboxHost;
    const teamBackend = host === "local" || host === "docker" || host === "kubernetes" ? host : undefined;
    // The image: the runner's own, else the team environment's, else the server's runner image (KILN_RUNNER_IMAGE).
    const image = declared?.image ?? environment?.image ?? this.k.options.defaultImage ?? DEFAULT_RUNNER_IMAGE;
    const base: SandboxRunner = declared ? { ...declared, image } : { ...DEFAULT_RUNNER(teamBackend ?? this.k.options.defaultBackend ?? "local"), image };
    const policy = agent.networkPolicy;
    // Environment setup commands run after the runner's own, in the workspace root (the runner's run in each repository); the team's egress allowlist and the agent's allowed hosts add to the runner's.
    // Kiln's own host is always allowed: the command guard and the Kiln MCP server live there.
    const kilnHost = this.k.options.publicUrl ? new URL(this.k.options.publicUrl).hostname : undefined;
    // So are the MCP servers the run gets, such as a team server for a self-hosted observability stack.
    const mcpHosts = this.k.mcp.hosts(
      team,
      this.k.mcp.refsFor(team, input.overrides?.mcpServers ?? agent.mcpServers),
      this.k.vault.resolver({ teamId: team, userId: user?.id }),
    );
    const runner: SandboxRunner = {
      ...base,
      setupCommands: base.setupCommands ?? [],
      workspaceSetupCommands: environment?.setupCommands ?? [],
      egress: [
        ...new Set([
          ...(base.egress ?? []),
          ...(teamSettings?.egressAllowlist ?? []),
          ...(policy?.allowedHosts ?? []),
          ...(kilnHost ? [kilnHost] : []),
          ...mcpHosts,
        ]),
      ],
    };
    // required_repos (the agent's and an automation's) makes deferred repositories eager for this run.
    const required = [...agent.requiredRepos.map((r) => `${r.owner}/${r.name}`), ...(input.overrides?.requiredRepos ?? [])].map((r) => r.toLowerCase());
    // A work item that triage gave a repository works in that one (plus any required ones); it comes first, so it is the working directory.
    const picked = input.workItem?.repo?.toLowerCase();
    const factoryRepos =
      input.repos ??
      resolved.repositories
        .filter((r) => required.includes(repoKey(r).toLowerCase()) || (picked ? repoKey(r).toLowerCase() === picked : !r.deferred))
        .sort((a, b) => Number(repoKey(b).toLowerCase() === picked) - Number(repoKey(a).toLowerCase() === picked));
    const repos = [
      ...factoryRepos,
      ...(input.repos ? [] : (environment?.repos ?? []).filter((e) => !factoryRepos.some((r) => r.owner === e.owner && r.name === e.name))),
    ];
    const workerHost = input.overrides?.workerHost === null ? undefined : (input.overrides?.workerHost ?? agent.workerHost);
    const now = this.k.clock.now().toISOString();
    const parent = input.parentRunId ? this.get(input.parentRunId) : undefined;
    const firstOfItem = input.workItem && !parent ? this.list({ workItemId: input.workItem.id }).at(-1) : undefined;
    const explicitIdle = resolved.explicitIdleMinutes(input.agent);
    const creator = input.creator ?? (parent ? `agent:${parent.agent}` : input.workItem?.requester) ?? "kiln";
    const id = prior?.id ?? newId("run");
    const run: Run = prior
      ? {
          ...prior,
          status: workerHost ? "queued" : "running",
          error: undefined,
          attempt: (prior.attempt ?? 1) + 1,
          finishedAt: undefined,
          summary: undefined,
          result: undefined,
          artifacts: [],
        }
      : {
          id,
          kind: input.kind ?? "work",
          factory: input.factory,
          workItemId: input.workItem?.id,
          agent: input.agent,
          agentType: agent.agentType,
          stage: input.stage,
          harness: harnessType,
          model,
          definitionSha: resolved.sha,
          startState: { prompt: input.prompt, instructions: "", skills: agent.skills, repos: [] },
          replayOf: input.replayOf,
          parentRunId: input.parentRunId,
          ...(input.app ? { app: input.app } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.reportToParent ? { reportToParent: true } : {}),
          rootRunId: parent ? (parent.rootRunId ?? parent.id) : (firstOfItem?.rootRunId ?? firstOfItem?.id ?? id),
          artifacts: [],
          traceId: randomBytes(16).toString("hex"),
          status: workerHost ? "queued" : "running",
          source: sourceFor({ source: input.source, kind: input.kind, parentRunId: input.parentRunId, workItem: input.workItem }),
          title: (
            input.title ??
            input.workItem?.title ??
            input.prompt
              .split("\n")
              .find((l) => l.trim())
              ?.replace(/^#+\s*/, "") ??
            input.agent
          ).slice(0, 200),
          creator,
          executor: agent.credentialStrategy === "CREATOR" && !creator.startsWith("agent:") ? creator : `agent:${input.agent}`,
          ...(input.metadata && Object.keys(input.metadata).length ? { metadata: { ...input.metadata } } : {}),
          ...(input.mode && input.mode !== "normal" ? { mode: input.mode } : {}),
          attempt: 1,
          continuationOf: input.continuationOf,
          idleTimeoutMinutes:
            input.idleTimeoutMinutes ?? input.overrides?.idleTimeoutMinutes ?? explicitIdle ?? (input.parentRunId ? 60 : agent.idleTimeoutMinutes),
          ...(workerHost ? { workerHost, queuedAt: now } : {}),
          costUsd: 0,
          eventCount: 0,
          steering: [],
          team,
          userId: user?.id,
          environmentId: environment?.id,
          startedAt: now,
        };
    this.save(run);
    this.live.set(run.id, run);
    if (!prior) input.onCreated?.(run);
    const token = this.k.secrets.issueRunToken(run.id, repos.map(repoKey));
    const attachments = [...(input.workItem?.attachments ?? []), ...(input.attachments ?? [])].filter(
      (a, i, all) => all.findIndex((b) => b.key === a.key) === i,
    );
    let prompt = input.prompt;
    if (attachments.length)
      prompt = `${prompt}\n\nAttached files:\n${attachments.map((a) => `- .kiln/attachments/${a.name} (${a.contentType}, ${Math.ceil(a.size / 1024)} KB)`).join("\n")}`;
    run.startState.prompt = prompt;
    const memories = input.workItem || input.kind === "work" ? this.k.memories.promptBlock(input.factory, input.prompt) : "";
    const browser = browserServer(this.k, harnessType, agent) ? BROWSER_INSTRUCTIONS : "";
    const instructions = [agent.instructions, memories, input.extraInstructions ?? "", modeInstructions(input.mode), browser, resultProtocol(agent.agentType)]
      .filter(Boolean)
      .join("\n\n");
    run.startState.instructions = instructions;
    this.save(run);
    // A private image: the runner's (or else the environment's) registry credential, checked against the image's registry.
    const registrySecret = declared?.platform?.linux?.registryCredentialSecretName ?? (declared ? undefined : environment?.registryCredentialSecretName);
    const registryAuth = registrySecret && !workerHost ? await registryAuthFor(this.k, team, registrySecret, runner.image) : undefined;
    return {
      run,
      input: { ...input, prompt },
      resolved,
      ...(app ? { app } : {}),
      agent,
      harnessType,
      model,
      runner,
      deniedHosts: policy?.deniedHosts ?? [],
      repos,
      token,
      instructions,
      attachments,
      workerHost,
      team,
      userId: user?.id,
      environmentSecrets: environment?.secrets ?? [],
      envRef,
      registryAuth,
    };
  }

  private async executeOnce(input: ExecuteInput, prior?: Run): Promise<Run> {
    let prepared: Prepared;
    try {
      prepared = await this.prepare(input, prior);
    } catch (err) {
      if (prior) {
        const error = classifyError(err);
        prior.status = runStatusFor(error);
        prior.error = error;
        this.save(prior);
        return prior;
      }
      throw err;
    }
    const { run } = prepared;
    let sandbox: Sandbox | undefined;
    try {
      if (prepared.workerHost) await this.runRemote(prepared);
      else sandbox = await this.runLocal(prepared);
    } catch (err) {
      const error = classifyError(err);
      run.error = error;
      run.status = this.k.stopping.has(run.id) ? (this.k.stopping.get(run.id) === "interrupt" ? "blocked" : "cancelled") : runStatusFor(error);
      error.message = this.redacted(run, error.message).text!;
      run.summary = error.message;
      this.record(run, "error", `${error.code}: ${error.message}`, { code: error.code, retryable: error.retryable });
    } finally {
      await this.releaseChatgptLogin(run.id);
      const pooled = this.pooled.get(run.id);
      this.pooled.delete(run.id);
      this.redactions.delete(run.id);
      this.forgeTokens.delete(run.id);
      this.sessions.delete(run.id);
      this.remotes.delete(run.id);
      this.live.delete(run.id);
      run.finishedAt = this.k.clock.now().toISOString();
      if (this.borrowed.delete(run.id)) {
        // The lender keeps the sandbox; the run only gives its workspace back.
        this.sandboxes.delete(run.id);
        try {
          await this.k.options.workspaces!.release(run);
        } catch (err) {
          this.record(run, "error", `giving the workspace back failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (run.status !== "paused") {
        this.sandboxes.delete(run.id);
        await sandbox?.destroy().catch(() => {});
      }
      this.k.stopping.delete(run.id);
      this.save(run);
      const retrying =
        run.status === "error" && retriesAutomatically(run.error) && (run.attempt ?? 1) < Math.max(1, input.maxAttempts ?? this.k.options.maxRunAttempts ?? 3);
      if (pooled)
        this.k.credentialPool.recordOutcome(pooled, {
          ok: run.status === "succeeded",
          message: run.error?.message ?? run.summary,
        });
      if (!retrying) {
        this.record(run, "finished", run.status, { costUsd: run.costUsd });
        await this.saveTranscript(run);
        this.k.bus.publish("run.finished", {
          runId: run.id,
          outcome: run.status === "succeeded" ? "succeeded" : run.status === "failed" || run.status === "error" ? "failed" : "cancelled",
          costUsd: run.costUsd,
        });
        if (run.reportToParent && run.parentRunId) await this.reportToParent(run, reportReason(run));
      }
    }
    return run;
  }

  private finalStatus(run: Run, outcome: "succeeded" | "failed" | "cancelled"): Run["status"] {
    const stop = this.k.stopping.get(run.id);
    if (stop === "pause") return "paused";
    if (stop === "interrupt") return "blocked";
    if (stop === "cancel") return "cancelled";
    return outcome;
  }

  private async runLocal(p: Prepared): Promise<Sandbox> {
    const { run, input, resolved, agent, harnessType, model, runner, repos, token, instructions, attachments } = p;
    const decisions = resolved.decisions["command-guard"] ?? BUILTIN_DECISIONS["command-guard"]!;
    const provider = this.provider(input.backend ?? runner.backend);
    // Setup commands target the runner's image; when Kiln falls back to the host they are skipped.
    const effective: SandboxRunner = provider.name === runner.backend ? runner : { ...runner, setupCommands: [], workspaceSetupCommands: [] };
    // A cowboy App's owner accepted that its agent works unchecked (ADR-012): no guard, no approvals.
    const unguarded = p.app?.unguarded === true;
    let sandbox: Sandbox | undefined;
    const guard = async (command: string) => {
      const { verdict, outcome } = await guardCommand(command, { cwd: sandbox?.workdir, branch: input.branch }, this.k.decide, decisions);
      this.k.logDecision(outcome, { command }, { workItemId: input.workItem?.id, runId: run.id });
      if (verdict !== "allow") this.record(run, "guard", `${verdict}: ${command}`);
      return verdict;
    };
    const askHuman = (command: string) => this.k.gates.askCommand({ run, workItem: input.workItem, command });
    const provided = await this.k.options.workspaces?.acquire(run, run.parentRunId ? this.get(run.parentRunId) : undefined);
    if (provided) {
      // Someone else's sandbox: this run's guard still decides its agent's commands.
      sandbox = unguarded ? provided.sandbox : withGuard(provided.sandbox, guard, askHuman);
      this.borrowed.add(run.id);
    } else {
      sandbox = await provider.create({
        registryAuth: p.registryAuth,
        runner: effective,
        repos: await Promise.all(repos.map(async (r) => ({ name: r.name, url: this.k.forge.cloneUrl(r, await this.cloneToken(run.id, r, token)) }))),
        env: { KILN_RUN_ID: run.id },
        labels: { "kiln.dev/run": run.id, "kiln.dev/factory": input.factory },
        deniedHosts: p.deniedHosts,
        ...(unguarded ? {} : { guard, askHuman }),
      });
    }
    this.sandboxes.set(run.id, sandbox);
    this.specs.set(run.id, runner);
    const cwd = provided ? provided.cwd : repos[0]?.name;
    run.startState.repos = [];
    if (provided) {
      const head = await sandbox.exec("git rev-parse HEAD", { cwd: provided.cwd, trusted: true });
      if (head.code === 0) run.startState.repos.push({ name: provided.cwd, url: "", sha: head.stdout.trim() });
    }
    for (const r of provided ? [] : repos) {
      const dir = r.name;
      const sh = (cmd: string) => sandbox!.exec(cmd, { cwd: dir, trusted: true });
      await sh(
        `git config user.name "kiln-agent[bot]" && git config user.email "agent@kiln.local" && mkdir -p .git/info && echo ".kiln/" >> .git/info/exclude`,
      );
      const pin = input.pinned?.[r.name];
      if (pin) await sh(`git checkout -q -B ${input.branch ?? "kiln/replay"} ${pin}`);
      else if (input.branch) {
        await sh(`git fetch -q origin ${input.branch} 2>/dev/null && git checkout -q -B ${input.branch} FETCH_HEAD || git checkout -q -B ${input.branch}`);
      }
      const head = (await sh("git rev-parse HEAD")).stdout.trim();
      run.startState.repos.push({ name: r.name, url: repoKey(r), branch: input.branch, sha: head });
    }
    for (const [path, content] of Object.entries(input.files ?? {})) await sandbox.writeFile(path, content);
    for (const a of attachments) {
      const bytes = await this.k.objects.get(a.key);
      if (bytes) await sandbox.writeBytes(`${cwd ? `${cwd}/` : ""}.kiln/attachments/${a.name}`, bytes);
    }
    if (sandbox.provider === "local" && !provided) run.startState.workspaceSha = hashDir(sandbox.workdir);
    this.save(run);
    this.k.skills.recordUsage(input.factory, agent.skills);

    const skills = this.skillsFor(resolved, input.agent, agent);
    this.k.bus.publish("run.started", { runId: run.id, workItemId: run.workItemId, agent: run.agent, harness: harnessType });
    this.record(run, "started", `${agent.name} (${harnessType}${model ? `, ${model}` : ""})`);
    const adapter = this.k.harnessFor(harnessType, agent.agentType);
    const agentEnv = this.agentEnv(p);
    const pooled = this.pooled.get(run.id);
    if (agentEnv.chatgptLogin && pooled) agentEnv.env.CODEX_HOME = await this.holdChatgptLogin(run.id, pooled, sandbox, agentEnv.chatgptLogin);
    const session = await adapter.start({
      sandbox,
      cwd,
      instructions,
      prompt: input.prompt,
      model,
      skills,
      mcpServers: agentEnv.mcpServers,
      guardUrl: this.k.options.publicUrl && !unguarded ? `${this.k.options.publicUrl}/api/v1/guard` : undefined,
      env: { ...agentEnv.env, ...this.runEnv(run, input, agent.agentType, token) },
    });
    this.sessions.set(run.id, session);
    for (const text of run.steering.splice(0)) await session.steer(text);
    // Cancelled or interrupted while the sandbox was being prepared.
    if (this.k.stopping.has(run.id)) await session.stop();
    for await (const e of session.events) {
      if (e.type === "message") this.record(run, "message", e.text);
      else if (e.type === "reasoning") this.record(run, "reasoning", e.text, e.durationMs !== undefined ? { durationMs: e.durationMs } : undefined);
      else if (e.type === "tool_call") this.record(run, "tool_call", e.name, e.input);
      else if (e.type === "tool_result") this.record(run, "tool_result", e.output?.slice(0, 4000), { isError: e.isError });
      else if (e.type === "steer") this.record(run, "steer", e.text);
      else if (e.type === "error") this.record(run, "error", e.text);
      else if (e.type === "rate_limit" && pooled) this.k.credentialPool.recordUsage(pooled, e);
    }
    const result = await session.result;
    run.costUsd += result.costUsd;
    run.summary = this.redacted(run, result.summary).text!;
    const raw = cwd ? await sandbox.readFile(`${cwd}/.kiln/result.json`) : await sandbox.readFile(".kiln/result.json");
    if (raw) {
      try {
        run.result = this.redacted(run, undefined, JSON.parse(raw) as Record<string, unknown>).data;
      } catch {
        this.record(run, "error", "could not parse .kiln/result.json");
      }
    }
    if (input.collect && cwd) await input.collect(sandbox, cwd, run);
    await this.collectArtifacts(run, sandbox, cwd);
    run.status = this.finalStatus(run, result.outcome);
    if (run.status === "failed") run.error = { ...classifyError(new Error(run.summary || "the agent reported a failure")), retryable: false };
    if (run.status === "succeeded" && (input.push ?? run.kind === "work") && input.branch) {
      const pushed = await this.pushBranches(run, sandbox, repos, input.branch, token);
      run.result = { ...run.result, pushed: pushed.pushed, ...(pushed.diffStat ? { diffStat: pushed.diffStat } : {}) };
    }
    return sandbox;
  }

  /** A self-hosted worker runs it: build the job, queue it for the worker id and relay its events. */
  private async runRemote(p: Prepared): Promise<void> {
    const { run, input, resolved, agent, harnessType, model, runner, repos, token, instructions, attachments, workerHost } = p;
    const skills = this.skillsFor(resolved, input.agent, agent);
    const agentEnv = this.agentEnv(p);
    const files: WorkerJob["attachments"] = [];
    for (const a of attachments) {
      const bytes = await this.k.objects.get(a.key);
      if (bytes) files.push({ name: a.name, contentType: a.contentType, base64: Buffer.from(bytes).toString("base64") });
    }
    const job: WorkerJob = {
      runId: run.id,
      factory: input.factory,
      agent: input.agent,
      agentType: agent.agentType,
      workerHost: workerHost!,
      harness: harnessType,
      model,
      instructions,
      prompt: input.prompt,
      skills,
      runner,
      repos: repos.map((r) => ({ name: r.name, key: repoKey(r), url: this.k.forge.cloneUrl(r, token) })),
      branch: input.branch,
      pinned: input.pinned,
      files: input.files ?? {},
      attachments: files,
      env: { ...agentEnv.env, ...this.runEnv(run, input, agent.agentType, token) },
      deniedHosts: p.deniedHosts,
      push: Boolean((input.push ?? run.kind === "work") && input.branch),
      token,
      mcpServers: agentEnv.mcpServers,
      guardUrl: this.k.options.publicUrl ? `${this.k.options.publicUrl}/api/v1/guard` : undefined,
      idleTimeoutMinutes: run.idleTimeoutMinutes ?? 10,
    };
    this.record(run, "queued", `waiting for worker ${workerHost}`);
    const remote = this.k.workers.dispatch(job, (w) => {
      run.status = "claimed";
      run.workerId = w.id;
      run.claimedAt = this.k.clock.now().toISOString();
      this.save(run);
      this.record(run, "claimed", `worker ${w.workerId} (${w.id}, ${w.backend})`);
    });
    this.remotes.set(run.id, remote);
    for (const text of run.steering.splice(0)) await remote.steer(text);
    if (this.k.stopping.has(run.id)) await remote.stop();
    let started = false;
    for await (const e of remote.events) {
      if (!started && e.type === "started") {
        started = true;
        run.status = "running";
        this.save(run);
        this.k.bus.publish("run.started", { runId: run.id, workItemId: run.workItemId, agent: run.agent, harness: harnessType });
        this.record(run, "started", `${agent.name} (${harnessType}${model ? `, ${model}` : ""}) on ${e.text ?? workerHost}`);
        continue;
      }
      this.record(run, e.type, e.text, e.data);
    }
    const res = await remote.result;
    run.costUsd += res.costUsd;
    run.summary = redact(res.summary, this.redactions.get(run.id) ?? []);
    run.result = res.result;
    run.startState.repos = res.startRepos.map((r) => ({ name: r.name, url: r.key, branch: r.branch, sha: r.sha }));
    if (res.workspaceSha) run.startState.workspaceSha = res.workspaceSha;
    for (const a of res.artifacts) {
      const bytes = Buffer.from(a.base64, "base64");
      const key = `runs/${run.id}/${a.name}`;
      await this.k.objects.put(key, bytes, a.contentType);
      run.artifacts.push({ kind: mediaOf(a.name).kind, name: a.name, key, url: fileUrl(key), contentType: a.contentType, size: bytes.length });
    }
    if (res.pushed.length || res.diffStat) run.result = { ...run.result, pushed: res.pushed, ...(res.diffStat ? { diffStat: res.diffStat } : {}) };
    run.status = this.finalStatus(run, res.outcome);
    if (run.status === "failed") run.error = { ...classifyError(new Error(res.error ?? (res.summary || "the agent reported a failure"))), retryable: false };
  }

  /** Writes a pooled ChatGPT login into the run's sandbox for Codex; returns its CODEX_HOME. */
  private async holdChatgptLogin(runId: string, credential: PoolCredential, sandbox: Sandbox, value: string) {
    // Registered first, so the login is released even if writing it fails.
    const login = { credential, sandbox, home: codexHome(runId) };
    this.chatgptLogins.set(runId, login);
    await this.k.credentialPool.writeChatgptLogin(sandbox, login.home, value);
    return login.home;
  }

  /** Saves the ChatGPT login a run held (Codex may have refreshed it) and gives it back to the pool. */
  private async releaseChatgptLogin(runId: string) {
    const login = this.chatgptLogins.get(runId);
    if (!login) return;
    this.chatgptLogins.delete(runId);
    await this.k.credentialPool
      .saveChatgptLogin(login.credential, login.sandbox, login.home, `run:${runId}`)
      .catch((err) => console.error(`saving the refreshed ChatGPT login ${login.credential.name} failed`, err));
    this.k.credentialPool.release(login.credential);
  }

  private skillsFor(resolved: RunDefinition, agentName: string, agent: ResolvedAgent) {
    return agent.skills.map((name) => {
      const s = resolved.skill(agentName, name);
      return { name, body: s?.body ?? "", description: s?.description };
    });
  }

  /** Credentials, the agent's secrets and MCP servers for a run; their values are redacted from its output. */
  private agentEnv(p: Prepared) {
    const scope = { teamId: p.team, userId: p.userId };
    const resolver = this.k.vault.resolver(scope);
    // Automation overrides add secrets (resolved through the vault like the agent's) and replace the MCP servers; team servers given to all agents always come along.
    // A ChatGPT login is a file in the sandbox, so only local runs (not self-hosted workers) get one from the pool.
    const chosen: { credential?: PoolCredential; chatgptLogin?: string; files?: boolean } = { files: !p.workerHost };
    const credentials = this.credentials(
      p.harnessType,
      { ...p.agent, secrets: [...new Set([...p.agent.secrets, ...p.environmentSecrets, ...(p.input.overrides?.secrets ?? [])])] },
      scope,
      chosen,
    );
    if (chosen.credential) {
      this.pooled.set(p.run.id, chosen.credential);
      p.run.credential = chosen.credential.name;
      this.save(p.run);
    }
    const mcp = this.k.mcp.resolve(p.team, this.k.mcp.refsFor(p.team, p.input.overrides?.mcpServers ?? p.agent.mcpServers), resolver);
    for (const s of mcp.skipped) this.record(p.run, "mcp_skipped", s);
    const loginTokens = chosen.chatgptLogin ? (parseChatgptAuth(chosen.chatgptLogin)?.tokens ?? []) : [];
    // The project's variables (team → project → factory, only for a factory in a project), or the App's (team → project → App).
    const variables = p.app ? { env: p.app.env, secretValues: p.app.secretValues } : this.k.variables.forFactory(p.input.factory);
    this.redactions.set(p.run.id, [
      ...new Set(
        [
          ...Object.values(credentials),
          ...Object.values(mcp.env),
          ...this.k.vault.values(scope),
          ...(variables?.secretValues ?? []),
          ...loginTokens,
          ...(this.forgeTokens.get(p.run.id) ?? []),
        ].filter((v) => v.length >= 6),
      ),
    ]);
    const overrideEnv: Record<string, string> = {
      ...p.resolved.cloudEnv,
      ...(p.envRef ? { KILN_ENVIRONMENT_ID: p.envRef } : {}),
      ...(p.workerHost ? { KILN_WORKER_HOST: p.workerHost } : {}),
      ...(p.run.idleTimeoutMinutes ? { KILN_IDLE_TIMEOUT_MINUTES: String(p.run.idleTimeoutMinutes) } : {}),
    };
    const browser = browserServer(this.k, p.harnessType, p.agent);
    return {
      env: { ...variables?.env, ...mcp.env, ...credentials, ...overrideEnv },
      mcpServers: [...this.mcpServers(p.token), ...(browser ? [browser] : []), ...mcp.servers],
      chatgptLogin: chosen.chatgptLogin,
    };
  }

  /** The forge's sandbox credential for a repository (GitHub: repo-scoped, an hour), else the run token. */
  private async cloneToken(runId: string, repo: RepoRef, runToken: string) {
    const t = await this.k.forge.sandboxToken?.(repo);
    if (!t) return runToken;
    this.forgeTokens.set(runId, [...(this.forgeTokens.get(runId) ?? []), t]);
    return t;
  }

  private mcpServers(token: string) {
    return this.k.options.publicUrl ? [{ name: "kiln", url: `${this.k.options.publicUrl}/mcp`, headers: { authorization: `Bearer ${token}` } }] : [];
  }

  private runEnv(run: Run, input: ExecuteInput, agentType: string, token: string): Record<string, string> {
    return {
      KILN_RUN_ID: run.id,
      KILN_RUN_TOKEN: token,
      KILN_FACTORY: input.factory,
      KILN_AGENT_TYPE: agentType,
      KILN_WORK_ITEM: input.workItem?.id ?? "",
      KILN_STAGE: input.stage ?? "",
      ...(this.k.options.publicUrl ? { KILN_URL: this.k.options.publicUrl } : {}),
      ...(run.mode ? { KILN_MODE: run.mode } : {}),
    };
  }

  /**
   * Bring-your-own-keys: the harness credential and the agent's declared secrets, read from Kiln's
   * secrets and passed only to this run's sandbox. Claude Code prefers a subscription token from
   * `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) and falls back to ANTHROPIC_API_KEY.
   */
  credentials(
    type: HarnessType,
    agent: Pick<ResolvedAgent, "secrets" | "harness">,
    scope: { teamId?: string; userId?: string } = {},
    chosen: { credential?: PoolCredential; chatgptLogin?: string; files?: boolean } = {},
  ): Record<string, string> {
    const env: Record<string, string> = {};
    const secrets = this.k.vault.resolver(scope);
    const get = (name: string) => secrets.get(name);
    for (const name of agent.secrets) Object.assign(env, secrets.envFor(name) ?? {});
    const auth = agent.harness.auth;
    if (auth?.source === "worker" || auth?.source === "workerEnvironment") return env;
    if (auth?.source === "secret" || auth?.source === "managedSecret") {
      const typed = secrets.envFor(auth.secretName);
      const v = get(auth.secretName);
      if (!v || !typed)
        throw new KilnError("integration_not_configured", `secret ${auth.secretName} for the ${type} harness is not set`, {
          integrationName: type,
          secretName: auth.secretName,
        });
      // Typed secrets (Bedrock keys and the like) bring their own variable names.
      if (!auth.env && !(auth.secretName in typed)) {
        Object.assign(env, typed);
        return env;
      }
      const target =
        auth.env ??
        (type === "claude-code"
          ? v.startsWith("sk-ant-oat")
            ? "CLAUDE_CODE_OAUTH_TOKEN"
            : "ANTHROPIC_API_KEY"
          : type === "codex"
            ? "OPENAI_API_KEY"
            : type === "gemini"
              ? "GEMINI_API_KEY"
              : auth.secretName);
      env[target] = v;
      return env;
    }
    // Several subscription tokens: the one with the most usage left (see CredentialPool).
    const pooled =
      type === "claude-code"
        ? this.k.credentialPool.choose(scope)
        : type === "codex" && chosen.files
          ? this.k.credentialPool.choose(scope, "chatgpt")
          : undefined;
    if (pooled) {
      chosen.credential = pooled.credential;
      if (pooled.value) chosen.chatgptLogin = pooled.value;
      return { ...env, ...pooled.env };
    }
    const defaults: Record<HarnessType, string[]> = {
      "claude-code": ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID"],
      codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
      gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      pi: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"],
    };
    for (const name of defaults[type]) {
      const provided = secrets.provide(name);
      if (provided) {
        Object.assign(env, provided);
        if (type !== "opencode" && type !== "pi") break;
      }
    }
    return env;
  }

  /** The run's events as JSON lines, in the team's transcript storage. */
  private async saveTranscript(run: Run) {
    const key = `transcripts/${run.id}.jsonl`;
    try {
      await this.k.objects.put(
        key,
        this.events(run.id)
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n",
        "application/x-ndjson",
      );
      run.transcriptKey = key;
      this.save(run);
    } catch (err) {
      this.k.audit("kiln", "transcript.failed", run.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Upload what the agent saved in .kiln/artifacts/ (and lists in result.artifacts) for reviewers. */
  private async collectArtifacts(run: Run, sandbox: Sandbox, cwd: string | undefined) {
    const base = cwd ? `${cwd}/` : "";
    const listed = (
      await sandbox.exec(`[ -d ${base}.kiln/artifacts ] && cd ${base}.kiln/artifacts && find . -type f -size -50M | sed 's|^./||' || true`, { trusted: true })
    ).stdout
      .split("\n")
      .filter(Boolean);
    // Workspace paths only: never an absolute path such as the Codex login under /tmp.
    const extra = ((run.result?.artifacts as string[] | undefined) ?? []).filter((p) => typeof p === "string" && !p.includes("..") && !p.startsWith("/"));
    const paths = [...listed.map((p) => `.kiln/artifacts/${p}`), ...extra];
    for (const rel of [...new Set(paths)].slice(0, 50)) {
      const bytes = await sandbox.readBytes(`${base}${rel}`);
      if (!bytes) continue;
      const name = rel.split("/").pop()!;
      const { kind, contentType } = mediaOf(name);
      const key = `runs/${run.id}/${name}`;
      await this.k.objects.put(key, bytes, contentType);
      run.artifacts.push({ kind, name, key, url: fileUrl(key), contentType, size: bytes.length });
      this.record(run, "artifact", `${kind}: ${name}`);
    }
  }

  addArtifact(runId: string, artifact: Artifact) {
    const live = this.live.get(runId);
    if (live) {
      live.artifacts = [...(live.artifacts ?? []), artifact];
      this.save(live);
      return;
    }
    const run = this.get(runId);
    if (!run) return;
    run.artifacts = [...(run.artifacts ?? []), artifact];
    this.save(run);
  }

  /**
   * Subagents: a running agent starts another agent of its factory for part of the work. The child
   * shares the work item and branch; `spawnableBy` on the child decides which agents may start it.
   * With `wait: false` it returns as soon as the child exists.
   */
  async spawn(
    parentRunId: string,
    input: {
      agent: string;
      prompt: string;
      attachments?: Attachment[];
      mode?: RunMode;
      title?: string;
      metadata?: Record<string, string>;
      wait?: boolean;
      creator?: string;
      /** Unique among the runs of the parent's tree; followups accept it in place of the run id. */
      name?: string;
      /** Start the child's prompt with the parent's conversation so far; by default it gets only `prompt`. */
      fork?: boolean;
      /** Send the parent a report when the child finishes or asks a question. */
      report?: boolean;
    },
  ): Promise<Run> {
    const parent = this.get(parentRunId);
    if (!parent) throw new KilnError("resource_not_found", `unknown run ${parentRunId}`);
    if (input.name !== undefined) {
      if (!RUN_NAME.test(input.name))
        throw new KilnError("invalid_request", `run name ${JSON.stringify(input.name)} must be lowercase letters, digits and dashes (at most 40)`);
      if (this.byName(parentRunId, input.name)) throw new KilnError("invalid_request", `this run tree already has a run named ${input.name}`);
    }
    if (isTerminal(parent)) throw new KilnError("operation_not_supported", `run ${parentRunId} has finished; only a running agent can spawn subagents`);
    const resolved = this.definitionOf({ ...(parent.app ? { app: parent.app } : {}), sha: parent.definitionSha }).def;
    const child = resolved.agents[input.agent];
    if (!child) throw new KilnError("resource_not_found", `factory ${parent.factory} has no agent ${input.agent}`);
    const parentAgent = resolved.agents[parent.agent];
    const allowed = child.spawnableBy.includes(parent.agent) || (parentAgent?.agentType === "FOREMAN" && child.spawnableBy.includes("foreman"));
    if (!allowed)
      throw new KilnError("not_authorized", `${parent.agent} may not spawn ${input.agent} (spawnableBy: ${child.spawnableBy.join(", ") || "none"})`);
    const depth = (id: string | undefined, n = 0): number => (id ? depth(this.get(id)?.parentRunId, n + 1) : n);
    if (depth(parentRunId) > 4) throw new KilnError("operation_not_supported", "subagents can nest at most 5 levels deep");
    const live = this.live.get(parentRunId) ?? parent;
    this.record(live, "spawn", `${input.agent}: ${input.prompt.split("\n")[0]!.slice(0, 120)}`);
    const exec: ExecuteInput = {
      factory: parent.factory,
      sha: parent.definitionSha,
      agent: input.agent,
      prompt: input.fork ? `${this.forkContext(parentRunId)}\n\n## Your task\n${input.prompt}` : input.prompt,
      ...(parent.app ? { app: parent.app } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.report ? { reportToParent: true } : {}),
      kind: parent.kind,
      stage: parent.stage,
      workItem: parent.workItemId ? this.k.workflow.get(parent.workItemId) : undefined,
      branch: parent.startState.repos[0]?.branch,
      parentRunId,
      attachments: input.attachments,
      push: parent.kind === "work" && Boolean(parent.startState.repos[0]?.branch),
      mode: input.mode,
      title: input.title,
      metadata: input.metadata,
      creator: input.creator ?? `agent:${parent.agent}`,
      source: "ORCHESTRATION",
    };
    return input.wait === false ? this.startInBackground(exec) : this.execute(exec);
  }

  /** Commit leftovers and push `branch` with the run's scoped token. Never touches main. */
  private async pushBranches(run: Run, sandbox: Sandbox, repos: RepoRef[], branch: string, token: string) {
    const pushed: { repo: string; branch: string; sha: string }[] = [];
    const diffStat = { additions: 0, deletions: 0, files: 0 };
    for (const r of repos) {
      const sh = (cmd: string, env?: Record<string, string>) => sandbox.exec(cmd, { cwd: r.name, trusted: true, env });
      const dirty = (await sh("git status --porcelain")).stdout.trim();
      if (dirty) await sh(`git add -A && git commit -q -m ${JSON.stringify(`kiln: ${run.stage ?? run.agent} (${run.id})`)}`);
      const head = (await sh("git rev-parse HEAD")).stdout.trim();
      const start = run.startState.repos.find((x) => x.name === r.name)?.sha;
      if (start && start !== head) {
        for (const line of (await sh(`git diff --numstat ${start} ${head}`)).stdout.split("\n").filter(Boolean)) {
          const [a, d] = line.split("\t");
          diffStat.additions += Number(a) || 0;
          diffStat.deletions += Number(d) || 0;
          diffStat.files += 1;
        }
      }
      const remote = (await sh(`git ls-remote origin refs/heads/${branch}`)).stdout.split(/\s/)[0];
      if (head === start && !remote) continue;
      if (remote === head) continue;
      const auth = this.k.secrets.authorize(token, "push", repoKey(r), branch);
      if (!auth.ok) throw new Error(`push refused: ${auth.reason}`);
      const res = await sh(`git push -q origin HEAD:refs/heads/${branch}`, { KILN_PUSH_AS: `agent:${run.id}` });
      if (res.code !== 0) throw new Error(`git push failed: ${res.stderr}`);
      pushed.push({ repo: repoKey(r), branch, sha: head });
      this.record(run, "pushed", `${repoKey(r)} ${branch} @ ${head.slice(0, 7)}`);
    }
    return { pushed, diffStat: diffStat.files ? diffStat : undefined };
  }

  /** Live steering from the run page, a Slack thread or MCP. */
  async steer(runId: string, text: string, by: string) {
    const session = this.sessions.get(runId);
    const remote = this.remotes.get(runId);
    // A live run without a session is queued, claimed or still preparing its sandbox: its agent gets the message when it starts.
    const run = this.live.get(runId);
    if (!run) throw new KilnError("operation_not_supported", `run ${runId} is not running`);
    if (session) await session.steer(text);
    else if (remote) await remote.steer(text);
    run.steering.push(text);
    if (remote) this.record(run, "steer", text);
    this.save(run);
    if (run.workItemId) this.k.workflow.touch(run.workItemId, by, `steered ${run.agent}: ${text}`);
    this.k.audit(by, "run.steered", runId, { text });
  }

  /**
   * A follow-up message: steers the run while it is live, otherwise continues it in a new run
   * with the same agent, branch and work item (the original prompt plus the follow-up).
   */
  async followup(
    runId: string,
    input: { message: string; attachments?: Attachment[]; by: string; mode?: RunMode },
  ): Promise<{ delivered: "steered" | "continued"; run: Run }> {
    const run = this.get(runId);
    if (!run) throw new KilnError("resource_not_found", `unknown run ${runId}`);
    if (this.isActive(runId) || this.live.has(runId)) {
      const sandbox = this.sandboxes.get(runId);
      const cwd = run.startState.repos[0]?.name;
      for (const a of input.attachments ?? []) {
        const bytes = await this.k.objects.get(a.key);
        if (bytes && sandbox) await sandbox.writeBytes(`${cwd ? `${cwd}/` : ""}.kiln/attachments/${a.name}`, bytes);
      }
      const note = input.attachments?.length ? `\n\nAttached files:\n${input.attachments.map((a) => `- .kiln/attachments/${a.name}`).join("\n")}` : "";
      await this.steer(runId, `${input.message}${note}`, input.by);
      return { delivered: "steered", run: this.get(runId)! };
    }
    if (run.workItemId) this.k.workflow.addMessage(run.workItemId, input.by, input.message, input.attachments ?? []);
    const branch = run.startState.repos[0]?.branch;
    const next = await this.startInBackground({
      factory: run.factory,
      sha: run.definitionSha,
      agent: run.agent,
      prompt: `${run.startState.prompt.replace(/\n\nAttached files:[\s\S]*$/, "")}\n\n## Follow-up from ${input.by}\n${input.message}`,
      kind: run.kind === "work" ? "work" : run.kind,
      stage: run.stage,
      workItem: run.workItemId ? this.k.workflow.get(run.workItemId) : undefined,
      branch,
      parentRunId: run.parentRunId,
      continuationOf: run.id,
      ...(run.app ? { app: run.app } : {}),
      ...(run.name ? { name: run.name } : {}),
      ...(run.reportToParent ? { reportToParent: true } : {}),
      attachments: input.attachments,
      push: run.kind === "work" && Boolean(branch),
      source: run.source,
      title: run.title,
      metadata: run.metadata,
      creator: input.by,
      mode: input.mode ?? run.mode,
    });
    this.k.audit(input.by, "run.followup", runId, { continuedIn: next.id });
    return { delivered: "continued", run: next };
  }

  /** Stop what the agent is doing; the run waits (BLOCKED) for a follow-up. */
  async interrupt(runId: string, by: string) {
    const session = this.sessions.get(runId);
    const remote = this.remotes.get(runId);
    if (!session && !remote) throw new KilnError("operation_not_supported", `run ${runId} is not running`);
    this.k.stopping.set(runId, "interrupt");
    await (session ?? remote)!.stop();
    this.k.audit(by, "run.interrupted", runId);
  }

  async cancel(runId: string, by: string) {
    if (this.k.workers.cancelQueued(runId)) {
      this.k.stopping.set(runId, "cancel");
      this.k.audit(by, "run.cancelled", runId);
      return;
    }
    const session = this.sessions.get(runId) ?? this.remotes.get(runId);
    if (!session && !this.live.has(runId)) return;
    // A run still preparing its sandbox stops as soon as its agent starts.
    this.k.stopping.set(runId, "cancel");
    await session?.stop();
    this.k.audit(by, "run.cancelled", runId);
  }

  /** Cancel a run and every run it started that is still going. */
  async cancelTree(runId: string, by: string): Promise<string[]> {
    const ids = [runId, ...this.descendants(runId).map((r) => r.id)].filter((id) => this.isActive(id) || this.live.has(id));
    for (const id of ids.reverse()) await this.cancel(id, by);
    return ids;
  }

  /** Link access to a run for other signed-in people. */
  share(runId: string, publicAccess: "VIEWER" | "EDITOR" | null, by: string): Run {
    const run = this.get(runId);
    if (!run) throw new KilnError("resource_not_found", `unknown run ${runId}`);
    const live = this.live.get(runId);
    if (live) live.sharing = { publicAccess };
    const next = { ...run, sharing: { publicAccess } };
    this.save(live ?? next);
    this.k.audit(by, "run.shared", runId, { publicAccess });
    return next;
  }

  /** Pause a running agent: snapshot its sandbox to object storage and stop it. */
  async pause(runId: string, by: string): Promise<SnapshotRef> {
    const sandbox = this.sandboxes.get(runId);
    const run = this.get(runId);
    if (!sandbox || !run) throw new KilnError("operation_not_supported", `run ${runId} has no live sandbox`);
    const ref = await sandbox.snapshot(this.k.objects);
    const live = this.live.get(runId);
    if (live) live.snapshotKey = ref.key;
    this.k.store.put(C.runs, { ...run, snapshotKey: ref.key });
    this.k.store.put("snapshots", { id: runId, ...ref });
    this.k.stopping.set(runId, "pause");
    await this.sessions.get(runId)?.stop();
    this.k.audit(by, "run.paused", runId, { snapshot: ref.key });
    return ref;
  }

  /** Resume a paused run on any node: restore the workspace and continue the agent there. */
  async resume(runId: string, by: string, provider?: SandboxProvider): Promise<Run> {
    const run = this.get(runId);
    const ref = this.k.store.get<SnapshotRef & { id: string }>("snapshots", runId);
    if (!run || !ref) throw new KilnError("resource_not_found", `run ${runId} has no snapshot`);
    const old = this.sandboxes.get(runId);
    if (old) {
      await old.destroy().catch(() => {});
      this.sandboxes.delete(runId);
    }
    const runner = this.specs.get(runId) ?? DEFAULT_RUNNER("local");
    const sandbox = await (provider ?? this.provider(runner.backend)).resume(ref, { runner, repos: [] }, this.k.objects);
    const agent = this.definitionOf({ ...(run.app ? { app: run.app } : {}), sha: run.definitionSha }).def.agents[run.agent]!;
    const cwd = run.startState.repos[0]?.name;
    run.status = "running";
    this.save(run);
    this.record(run, "resumed", `on ${sandbox.provider} ${sandbox.id}`, { workspaceSha: sandbox.provider === "local" ? hashDir(sandbox.workdir) : undefined });
    const env: Record<string, string> = { KILN_RUN_ID: run.id, KILN_AGENT_TYPE: agent.agentType, KILN_RESUMED: "1" };
    let result: Awaited<HarnessSession["result"]>;
    try {
      // Pausing gave its ChatGPT login back (and removed it from the sandbox): take one again like a fresh start.
      const login = run.harness === "codex" && run.credential ? this.k.credentialPool.choose({ teamId: run.team, userId: run.userId }, "chatgpt") : undefined;
      if (login) {
        this.redactions.set(run.id, (parseChatgptAuth(login.value ?? "")?.tokens ?? []).filter((t) => t.length >= 6));
        run.credential = login.name;
        env.CODEX_HOME = await this.holdChatgptLogin(run.id, login.credential, sandbox, login.value ?? "");
      }
      const session = await this.k.harnessFor(run.harness as HarnessType, agent.agentType).start({
        sandbox,
        cwd,
        instructions: run.startState.instructions,
        prompt: `Continue the paused task. Original request:\n${run.startState.prompt}\n${run.steering.length ? `\nSteering so far:\n${run.steering.join("\n")}` : ""}`,
        model: run.model,
        env,
      });
      this.sessions.set(runId, session);
      for await (const e of session.events) if (e.type === "message") this.record(run, "message", e.text);
      result = await session.result;
    } finally {
      this.sessions.delete(runId);
      await this.releaseChatgptLogin(runId);
      this.redactions.delete(runId);
    }
    run.status = result.outcome === "succeeded" ? "succeeded" : result.outcome;
    run.costUsd += result.costUsd;
    run.finishedAt = this.k.clock.now().toISOString();
    this.save(run);
    await sandbox.destroy();
    this.k.audit(by, "run.resumed", runId);
    return run;
  }

  /** Re-run from the saved start state, optionally under another definition. */
  async replay(runId: string, opts: { sha?: string; tree?: DefinitionTree; by?: string } = {}): Promise<Run> {
    const run = this.get(runId);
    if (!run) throw new KilnError("resource_not_found", `unknown run ${runId}`);
    const repos = run.startState.repos.map((r) => {
      const [owner, name] = r.url.split("/");
      return { owner: owner!, name: name! };
    });
    return this.execute({
      factory: run.factory,
      sha: opts.sha ?? run.definitionSha,
      tree: opts.tree,
      agent: run.agent,
      prompt: run.startState.prompt,
      kind: "replay",
      stage: run.stage,
      replayOf: run.id,
      repos,
      pinned: Object.fromEntries(run.startState.repos.map((r) => [r.name, r.sha])),
      branch: run.startState.repos[0]?.branch,
      push: false,
      workItem: run.workItemId ? this.k.workflow.get(run.workItemId) : undefined,
      source: "API",
      creator: opts.by,
    });
  }
}
