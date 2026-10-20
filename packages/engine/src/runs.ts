import { randomBytes } from "node:crypto";
import { BUILTIN_DECISIONS, guardCommand, runDecision } from "@kiln/decide";
import type { DefinitionTree, ResolvedAgent, ResolvedFactory } from "@kiln/definitions";
import type { HarnessSession } from "@kiln/harness";
import { repoKey, type RepoRef } from "@kiln/integrations";
import { hashDir, type Sandbox, type SandboxProvider, type SnapshotRef } from "@kiln/sandbox";
import type { HarnessType, Runner } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { cloudProviderEnv } from "./cloud";
import { registryAuthFor } from "./platform/registry";
import { C, newId, type Artifact, type Attachment, type ExecutionOverrides, type Run, type RunEvent, type RunKind, type WorkItem } from "./types";

const MEDIA: Record<string, [Artifact["kind"], string]> = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  svg: ["image", "image/svg+xml"],
  webm: ["video", "video/webm"],
  mp4: ["video", "video/mp4"],
  mov: ["video", "video/quicktime"],
  pdf: ["file", "application/pdf"],
  json: ["report", "application/json"],
  html: ["report", "text/html"],
  md: ["report", "text/markdown"],
  txt: ["file", "text/plain"],
};

export function mediaOf(name: string): { kind: Artifact["kind"]; contentType: string } {
  const [kind, contentType] = MEDIA[name.split(".").pop()?.toLowerCase() ?? ""] ?? ["file", "application/octet-stream"];
  return { kind, contentType };
}

/** Where people open a stored object: the web app proxies /files/<key> to the API. */
export const fileUrl = (key: string) => `/files/${key.split("/").map(encodeURIComponent).join("/")}`;

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
  overrides?: { model?: string; harness?: HarnessType | string } & Omit<ExecutionOverrides, "model" | "harness">;
  replayOf?: string;
  push?: boolean;
  collect?: (sandbox: Sandbox, cwd: string, run: Run) => Promise<void>;
  extraInstructions?: string;
  files?: Record<string, string>;
  /** Uploaded files placed in the workspace under .kiln/attachments/. */
  attachments?: Attachment[];
  /** Set when this run is a subagent of another run. */
  parentRunId?: string;
  backend?: "local" | "docker" | "kubernetes";
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
  SPEC: '{"specPath": "docs/specs/<id>.md", "criteria": ["AC1: ..."], "stories": ["..."], "openQuestions": ["..."]}',
  IMPLEMENT: '{"summary": "...", "testsPassed": true, "memories": [{"title": "...", "body": "..."}]}',
  VERIFY: '{"testsPassed": true, "playwrightReport": "playwright-report/results.json"}',
  REVIEW: '{"verdict": "accepted|changes_requested|needs_human", "findings": ["file:line — issue — fix"]}',
  PLAN: '{"epics": [{"title": "...", "milestone": "...", "dependsOn": [], "issues": [{"title": "...", "body": "...", "criteria": ["..."], "factory": "alias"}]}]}',
  CUSTOM: '{"summary": "..."}',
};

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

export class RunService {
  private readonly sessions = new Map<string, HarnessSession>();
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly specs = new Map<string, Runner>();
  /** The in-memory record of each live run, so steering and cost updates land on the copy that is saved last. */
  private readonly live = new Map<string, Run>();
  /** Secret values each live run was given; redacted from its events and summary. */
  private readonly redactions = new Map<string, string[]>();

  constructor(private readonly k: Kiln) {}

  get(id: string) {
    return this.k.store.get<Run>(C.runs, id);
  }

  list(filter: { factory?: string; workItemId?: string; agent?: string; kind?: RunKind } = {}) {
    return this.k.store
      .list<Run>(C.runs, (r) => (!filter.factory || r.factory === filter.factory) && (!filter.workItemId || r.workItemId === filter.workItemId) && (!filter.agent || r.agent === filter.agent) && (!filter.kind || r.kind === filter.kind))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  events(runId: string, afterSeq = 0): RunEvent[] {
    return this.k.store.list<RunEvent>(C.runEvents, (e) => e.runId === runId && e.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }

  isActive(runId: string) {
    return this.sessions.has(runId);
  }

  private record(run: Run, type: string, text?: string, data?: unknown) {
    const secrets = this.redactions.get(run.id);
    if (secrets?.length) {
      if (text) text = redact(text, secrets);
      if (data !== undefined) data = JSON.parse(redact(JSON.stringify(data), secrets.map((s) => JSON.stringify(s).slice(1, -1))));
    }
    run.eventCount += 1;
    const ev: RunEvent = { id: `${run.id}:${run.eventCount}`, runId: run.id, seq: run.eventCount, at: this.k.clock.now().toISOString(), type, text, data };
    this.k.store.put(C.runEvents, ev);
    this.k.bus.publish("run.event", { runId: run.id, seq: ev.seq, type, text, data });
  }

  private save(run: Run) {
    this.k.store.put(C.runs, run);
  }

  resolveModel(resolved: ResolvedFactory, model: string | undefined, prompt: string): Promise<string | undefined> | string | undefined {
    if (!model?.startsWith("router:")) return model;
    const router = resolved.parsed.routers[model.slice(7)];
    if (!router) return undefined;
    if (router.type === "prompt") {
      const words = new Set(prompt.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const best = router.routing
        .map((r) => ({ r, hits: (r.description.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length }))
        .sort((a, b) => b.hits - a.hits)[0];
      return best && best.hits > 0 ? best.r.model : router.default;
    }
    return runDecision("model-router", resolved.parsed.decisions["model-router"] ?? BUILTIN_DECISIONS["model-router"]!, { title: prompt.slice(0, 200), body: prompt }, this.k.decide).then(
      (o) => (o.action === "easy" ? router.routing.easy : o.action === "hard" ? router.routing.hard : router.routing.medium) ?? router.default,
    );
  }

  private provider(backend: Runner["backend"] | undefined): SandboxProvider {
    const p = this.k.sandboxes[backend ?? this.k.options.defaultBackend ?? "local"] ?? this.k.sandboxes.local;
    if (!p) throw new Error(`no sandbox provider for ${backend}`);
    return p;
  }

  /** Run an agent to completion and return the finished run. */
  async execute(input: ExecuteInput): Promise<Run> {
    const resolved = input.tree ? this.k.defs.resolveTree(input.tree) : this.k.defs.resolved(input.sha);
    const agent: ResolvedAgent | undefined = resolved.agents[input.agent];
    if (!agent) throw new Error(`factory ${input.factory} has no agent ${input.agent}`);
    const harnessType = (input.overrides?.harness ?? agent.harness.type) as HarnessType;
    const model = await this.resolveModel(resolved, input.overrides?.model ?? agent.harness.model, input.prompt);
    const team = this.k.teams.factoryTeam(input.factory);
    this.k.usage.assertWithinBudget(team);
    const user = input.triggeredBy ? this.k.users.get(input.triggeredBy) : this.k.users.forRequester(input.workItem?.requester);
    const automationEnv = input.workItem?.source.automation ? resolved.automations[input.workItem.source.automation]?.environmentId : undefined;
    // An automation's environmentId override selects the team environment for this run.
    const envRef = input.overrides?.environmentId ?? automationEnv ?? agent.environmentId;
    const environment = envRef ? this.k.environments.get(team, envRef) : undefined;
    if (envRef && !environment) throw new Error(`environment ${envRef} is not defined for this team`);
    const runnerName = input.overrides?.runner ?? agent.runner;
    const declared: Runner | undefined = runnerName ? resolved.parsed.runners[runnerName] : undefined;
    const teamSettings = team ? this.k.teams.settings(team) : undefined;
    const host = teamSettings?.defaultSandboxHost;
    const teamBackend = host === "local" || host === "docker" || host === "kubernetes" ? host : undefined;
    const base: Runner = declared ?? { image: environment?.image ?? "node:22-bookworm", backend: teamBackend ?? this.k.options.defaultBackend ?? "local", setupCommands: [], egress: [] };
    // Environment setup commands run after the runner's own; the team's egress allowlist adds to the runner's.
    const runner: Runner = {
      ...base,
      setupCommands: [...(base.setupCommands ?? []), ...(environment?.setupCommands ?? [])],
      egress: [...new Set([...(base.egress ?? []), ...(teamSettings?.egressAllowlist ?? [])])],
    };
    // required_repos makes deferred repositories eager for this run.
    const required = new Set(input.overrides?.requiredRepos ?? []);
    const factoryRepos = input.repos ?? resolved.factory.repositories.filter((r) => !r.deferred || required.has(repoKey(r)));
    const repos = [...factoryRepos, ...(input.repos ? [] : (environment?.repos ?? []).filter((e) => !factoryRepos.some((r) => r.owner === e.owner && r.name === e.name)))];
    const now = this.k.clock.now().toISOString();
    // A private image: the runner's (or else the environment's) registry credential, checked against the image's registry.
    const registrySecret = declared?.platform?.linux?.registryCredentialSecretName ?? (declared ? undefined : environment?.registryCredentialSecretName);
    const registryAuth = registrySecret ? await registryAuthFor(this.k, team, registrySecret, runner.image) : undefined;
    const run: Run = {
      id: newId("run"),
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
      artifacts: [],
      traceId: randomBytes(16).toString("hex"),
      status: "running",
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
    const token = this.k.secrets.issueRunToken(run.id, repos.map(repoKey));
    const decisions = resolved.parsed.decisions["command-guard"] ?? BUILTIN_DECISIONS["command-guard"]!;
    const provider = this.provider(input.backend ?? runner.backend);
    // Setup commands target the runner's image; when Kiln falls back to the host they are skipped.
    const effective: Runner = provider.name === runner.backend ? runner : { ...runner, setupCommands: [] };
    const sandbox = await provider.create({
      registryAuth,
      runner: effective,
      repos: repos.map((r) => ({ name: r.name, url: this.k.forge.cloneUrl(r, token) })),
      env: { KILN_RUN_ID: run.id },
      labels: { "kiln.dev/run": run.id, "kiln.dev/factory": input.factory },
      guard: async (command) => {
        const { verdict, outcome } = await guardCommand(command, { cwd: sandbox?.workdir, branch: input.branch }, this.k.decide, decisions);
        this.k.logDecision(outcome, { command }, { workItemId: input.workItem?.id, runId: run.id });
        if (verdict !== "allow") this.record(run, "guard", `${verdict}: ${command}`);
        return verdict;
      },
      askHuman: (command) => this.k.gates.askCommand({ run, workItem: input.workItem, command }),
    });
    this.sandboxes.set(run.id, sandbox);
    this.specs.set(run.id, runner);
    const cwd = repos[0]?.name;
    try {
      for (const r of repos) {
        const dir = r.name;
        const sh = (cmd: string) => sandbox.exec(cmd, { cwd: dir, trusted: true });
        await sh(`git config user.name "kiln-agent[bot]" && git config user.email "agent@kiln.local" && mkdir -p .git/info && echo ".kiln/" >> .git/info/exclude`);
        const pin = input.pinned?.[r.name];
        if (pin) await sh(`git checkout -q -B ${input.branch ?? "kiln/replay"} ${pin}`);
        else if (input.branch) {
          await sh(`git fetch -q origin ${input.branch} 2>/dev/null && git checkout -q -B ${input.branch} FETCH_HEAD || git checkout -q -B ${input.branch}`);
        }
        const head = (await sh("git rev-parse HEAD")).stdout.trim();
        run.startState.repos.push({ name: r.name, url: repoKey(r), branch: input.branch, sha: head });
      }
      for (const [path, content] of Object.entries(input.files ?? {})) await sandbox.writeFile(path, content);
      const attachments = [...(input.workItem?.attachments ?? []), ...(input.attachments ?? [])].filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
      for (const a of attachments) {
        const bytes = await this.k.objects.get(a.key);
        if (bytes) await sandbox.writeBytes(`${cwd ? `${cwd}/` : ""}.kiln/attachments/${a.name}`, bytes);
      }
      if (attachments.length) {
        input = { ...input, prompt: `${input.prompt}\n\nAttached files:\n${attachments.map((a) => `- .kiln/attachments/${a.name} (${a.contentType}, ${Math.ceil(a.size / 1024)} KB)`).join("\n")}` };
        run.startState.prompt = input.prompt;
      }
      if (sandbox.provider === "local") run.startState.workspaceSha = hashDir(sandbox.workdir);

      const memories = input.workItem || input.kind === "work" ? this.k.memories.promptBlock(input.factory, `${input.prompt}`) : "";
      const instructions = [agent.instructions, memories, input.extraInstructions ?? "", resultProtocol(agent.agentType)].filter(Boolean).join("\n\n");
      run.startState.instructions = instructions;
      this.save(run);
      this.k.skills.recordUsage(input.factory, agent.skills);

      const skills = agent.skills.map((name) => {
        const s = resolved.parsed.skills[name] ?? resolved.parsed.agents[input.agent]?.skills[name];
        return { name, body: s?.body ?? "", description: s?.frontmatter.description };
      });
      this.k.bus.publish("run.started", { runId: run.id, workItemId: run.workItemId, agent: run.agent, harness: harnessType });
      this.record(run, "started", `${agent.name} (${harnessType}${model ? `, ${model}` : ""})`);
      const adapter = this.k.harnessFor(harnessType, agent.agentType);
      const scope = { teamId: team, userId: user?.id };
      const resolver = this.k.vault.resolver(scope);
      // Automation overrides add secrets (resolved through the vault like the agent's) and replace the MCP servers.
      const credentials = this.credentials(harnessType, { ...agent, secrets: [...new Set([...agent.secrets, ...(environment?.secrets ?? []), ...(input.overrides?.secrets ?? [])])] }, scope);
      const mcp = this.k.mcp.resolve(team, input.overrides?.mcpServers ?? agent.mcpServers, resolver);
      for (const s of mcp.skipped) this.record(run, "mcp_skipped", s);
      this.redactions.set(run.id, [...new Set([...Object.values(credentials), ...Object.values(mcp.env), ...this.k.vault.values(scope)].filter((v) => v.length >= 6))]);
      const kilnMcp = this.k.options.publicUrl ? [{ name: "kiln", url: `${this.k.options.publicUrl}/mcp`, headers: { authorization: `Bearer ${token}` } }] : [];
      const overrideEnv: Record<string, string> = {
        ...cloudProviderEnv(resolved.factory),
        ...(envRef ? { KILN_ENVIRONMENT_ID: envRef } : {}),
        ...(input.overrides?.workerHost ? { KILN_WORKER_HOST: input.overrides.workerHost } : {}),
        ...(input.overrides?.idleTimeoutMinutes ? { KILN_IDLE_TIMEOUT_MINUTES: String(input.overrides.idleTimeoutMinutes) } : {}),
      };
      const session = await adapter.start({
        sandbox,
        cwd,
        instructions,
        prompt: input.prompt,
        model,
        skills,
        mcpServers: [...kilnMcp, ...mcp.servers],
        guardUrl: this.k.options.publicUrl ? `${this.k.options.publicUrl}/api/v1/guard` : undefined,
        env: {
          ...mcp.env,
          ...credentials,
          ...overrideEnv,
          KILN_RUN_ID: run.id,
          KILN_RUN_TOKEN: token,
          KILN_FACTORY: input.factory,
          KILN_AGENT_TYPE: agent.agentType,
          KILN_WORK_ITEM: input.workItem?.id ?? "",
          KILN_STAGE: input.stage ?? "",
        },
      });
      this.sessions.set(run.id, session);
      for await (const e of session.events) {
        if (e.type === "message") this.record(run, "message", e.text);
        else if (e.type === "tool_call") this.record(run, "tool_call", e.name, e.input);
        else if (e.type === "tool_result") this.record(run, "tool_result", e.output?.slice(0, 4000), { isError: e.isError });
        else if (e.type === "steer") this.record(run, "steer", e.text);
        else if (e.type === "error") this.record(run, "error", e.text);
      }
      const result = await session.result;
      run.costUsd = result.costUsd;
      run.summary = redact(result.summary, this.redactions.get(run.id) ?? []);
      const raw = cwd ? await sandbox.readFile(`${cwd}/.kiln/result.json`) : await sandbox.readFile(".kiln/result.json");
      if (raw) {
        try {
          run.result = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          this.record(run, "error", "could not parse .kiln/result.json");
        }
      }
      if (input.collect && cwd) await input.collect(sandbox, cwd, run);
      await this.collectArtifacts(run, sandbox, cwd);
      if (this.k.stopping.has(run.id)) {
        run.status = this.k.stopping.get(run.id) === "pause" ? "paused" : "cancelled";
      } else {
        run.status = result.outcome === "succeeded" ? "succeeded" : result.outcome;
      }
      if (run.status === "succeeded" && (input.push ?? run.kind === "work") && input.branch) {
        run.result = { ...run.result, pushed: await this.pushBranches(run, sandbox, repos, input.branch, token) };
      }
    } catch (err) {
      run.status = "failed";
      run.summary = redact(err instanceof Error ? err.message : String(err), this.redactions.get(run.id) ?? []);
      this.record(run, "error", run.summary);
    } finally {
      this.sessions.delete(run.id);
      this.live.delete(run.id);
      run.finishedAt = this.k.clock.now().toISOString();
      if (run.status !== "paused") {
        this.sandboxes.delete(run.id);
        await sandbox.destroy().catch(() => {});
      }
      this.k.stopping.delete(run.id);
      this.save(run);
      this.record(run, "finished", run.status, { costUsd: run.costUsd });
      this.redactions.delete(run.id);
      await this.saveTranscript(run);
      this.k.bus.publish("run.finished", { runId: run.id, outcome: run.status === "succeeded" ? "succeeded" : run.status === "failed" ? "failed" : "cancelled", costUsd: run.costUsd });
    }
    return run;
  }

  /**
   * Bring-your-own-keys: the harness credential and the agent's declared secrets, read from Kiln's
   * secrets and passed only to this run's sandbox. Claude Code prefers a subscription token from
   * `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) and falls back to ANTHROPIC_API_KEY.
   */
  credentials(type: HarnessType, agent: Pick<ResolvedAgent, "secrets" | "harness">, scope: { teamId?: string; userId?: string } = {}): Record<string, string> {
    const env: Record<string, string> = {};
    const secrets = this.k.vault.resolver(scope);
    const get = (name: string) => secrets.get(name);
    for (const name of agent.secrets) Object.assign(env, secrets.envFor(name) ?? {});
    const auth = agent.harness.auth;
    if (auth?.source === "worker") return env;
    if (auth?.source === "secret") {
      const typed = secrets.envFor(auth.secretName);
      const v = get(auth.secretName);
      if (!v || !typed) throw new Error(`secret ${auth.secretName} for the ${type} harness is not set`);
      if (!auth.env && !(auth.secretName in typed)) {
        Object.assign(env, typed);
        return env;
      }
      const target = auth.env ?? (type === "claude-code" ? (v.startsWith("sk-ant-oat") ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY") : type === "codex" ? "OPENAI_API_KEY" : auth.secretName);
      env[target] = v;
      return env;
    }
    const defaults: Record<HarnessType, string[]> = {
      "claude-code": ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID"],
      codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    };
    for (const name of defaults[type]) {
      const provided = secrets.provide(name);
      if (provided) {
        Object.assign(env, provided);
        if (type !== "opencode") break;
      }
    }
    return env;
  }

  /** The run's events as JSON lines, in the team's transcript storage. */
  private async saveTranscript(run: Run) {
    const key = `transcripts/${run.id}.jsonl`;
    try {
      await this.k.objects.put(key, this.events(run.id).map((e) => JSON.stringify(e)).join("\n") + "\n", "application/x-ndjson");
      run.transcriptKey = key;
      this.save(run);
    } catch (err) {
      this.k.audit("kiln", "transcript.failed", run.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Upload what the agent saved in .kiln/artifacts/ (and lists in result.artifacts) for reviewers. */
  private async collectArtifacts(run: Run, sandbox: Sandbox, cwd: string | undefined) {
    const base = cwd ? `${cwd}/` : "";
    const listed = (await sandbox.exec(`[ -d ${base}.kiln/artifacts ] && cd ${base}.kiln/artifacts && find . -type f -size -50M | sed 's|^./||' || true`, { trusted: true })).stdout.split("\n").filter(Boolean);
    const extra = ((run.result?.artifacts as string[] | undefined) ?? []).filter((p) => typeof p === "string" && !p.includes(".."));
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
    const run = this.live.get(runId) ?? this.get(runId);
    if (!run) return;
    run.artifacts = [...(run.artifacts ?? []), artifact];
    this.save(run);
  }

  /**
   * Subagents: a running agent starts another agent of its factory for part of the work. The child
   * shares the work item and branch; `spawnableBy` on the child decides which agents may start it.
   */
  async spawn(parentRunId: string, input: { agent: string; prompt: string; attachments?: Attachment[] }): Promise<Run> {
    const parent = this.live.get(parentRunId) ?? this.get(parentRunId);
    if (!parent) throw new Error(`unknown run ${parentRunId}`);
    const resolved = this.k.defs.resolved(parent.definitionSha);
    const child = resolved.agents[input.agent];
    if (!child) throw new Error(`factory ${parent.factory} has no agent ${input.agent}`);
    const parentAgent = resolved.agents[parent.agent];
    const allowed = child.spawnableBy.includes(parent.agent) || (parentAgent?.agentType === "FOREMAN" && child.spawnableBy.includes("foreman"));
    if (!allowed) throw new Error(`${parent.agent} may not spawn ${input.agent} (spawnableBy: ${child.spawnableBy.join(", ") || "none"})`);
    const depth = (id: string | undefined, n = 0): number => (id ? depth(this.get(id)?.parentRunId, n + 1) : n);
    if (depth(parentRunId) > 4) throw new Error("subagents can nest at most 5 levels deep");
    this.record(parent, "spawn", `${input.agent}: ${input.prompt.split("\n")[0]!.slice(0, 120)}`);
    return this.execute({
      factory: parent.factory,
      sha: parent.definitionSha,
      agent: input.agent,
      prompt: input.prompt,
      kind: parent.kind,
      stage: parent.stage,
      workItem: parent.workItemId ? this.k.workflow.get(parent.workItemId) : undefined,
      branch: parent.startState.repos[0]?.branch,
      parentRunId,
      attachments: input.attachments,
      push: parent.kind === "work" && Boolean(parent.startState.repos[0]?.branch),
    });
  }

  /** Commit leftovers and push `branch` with the run's scoped token. Never touches main. */
  private async pushBranches(run: Run, sandbox: Sandbox, repos: RepoRef[], branch: string, token: string) {
    const pushed: { repo: string; branch: string; sha: string }[] = [];
    for (const r of repos) {
      const sh = (cmd: string, env?: Record<string, string>) => sandbox.exec(cmd, { cwd: r.name, trusted: true, env });
      const dirty = (await sh("git status --porcelain")).stdout.trim();
      if (dirty) await sh(`git add -A && git commit -q -m ${JSON.stringify(`kiln: ${run.stage ?? run.agent} (${run.id})`)}`);
      const head = (await sh("git rev-parse HEAD")).stdout.trim();
      const start = run.startState.repos.find((x) => x.name === r.name)?.sha;
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
    return pushed;
  }

  /** Live steering from the run page, a Slack thread or MCP. */
  async steer(runId: string, text: string, by: string) {
    const session = this.sessions.get(runId);
    const run = this.live.get(runId) ?? this.get(runId);
    if (!session || !run) throw new Error(`run ${runId} is not running`);
    await session.steer(text);
    run.steering.push(text);
    this.save(run);
    if (run.workItemId) this.k.workflow.touch(run.workItemId, by, `steered ${run.agent}: ${text}`);
    this.k.audit(by, "run.steered", runId, { text });
  }

  async cancel(runId: string, by: string) {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.k.stopping.set(runId, "cancel");
    await session.stop();
    this.k.audit(by, "run.cancelled", runId);
  }

  /** Pause a running agent: snapshot its sandbox to object storage and stop it. */
  async pause(runId: string, by: string): Promise<SnapshotRef> {
    const sandbox = this.sandboxes.get(runId);
    const run = this.get(runId);
    if (!sandbox || !run) throw new Error(`run ${runId} has no live sandbox`);
    const ref = await sandbox.snapshot(this.k.objects);
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
    if (!run || !ref) throw new Error(`run ${runId} has no snapshot`);
    const old = this.sandboxes.get(runId);
    if (old) {
      await old.destroy().catch(() => {});
      this.sandboxes.delete(runId);
    }
    const runner = this.specs.get(runId) ?? { image: "node:22-bookworm", backend: "local" as const, setupCommands: [], egress: [] };
    const sandbox = await (provider ?? this.provider(runner.backend)).resume(ref, { runner, repos: [] }, this.k.objects);
    const resolved = this.k.defs.resolved(run.definitionSha);
    const agent = resolved.agents[run.agent]!;
    const cwd = run.startState.repos[0]?.name;
    run.status = "running";
    this.save(run);
    this.record(run, "resumed", `on ${sandbox.provider} ${sandbox.id}`, { workspaceSha: sandbox.provider === "local" ? hashDir(sandbox.workdir) : undefined });
    const session = await this.k.harnessFor(run.harness as HarnessType, agent.agentType).start({
      sandbox,
      cwd,
      instructions: run.startState.instructions,
      prompt: `Continue the paused task. Original request:\n${run.startState.prompt}\n${run.steering.length ? `\nSteering so far:\n${run.steering.join("\n")}` : ""}`,
      model: run.model,
      env: { KILN_RUN_ID: run.id, KILN_AGENT_TYPE: agent.agentType, KILN_RESUMED: "1" },
    });
    this.sessions.set(runId, session);
    for await (const e of session.events) if (e.type === "message") this.record(run, "message", e.text);
    const result = await session.result;
    this.sessions.delete(runId);
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
    if (!run) throw new Error(`unknown run ${runId}`);
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
    });
  }
}
