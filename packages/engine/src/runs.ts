import { randomBytes } from "node:crypto";
import { BUILTIN_DECISIONS, guardCommand, runDecision } from "@kiln/decide";
import type { DefinitionTree, ResolvedAgent, ResolvedFactory } from "@kiln/definitions";
import type { HarnessSession } from "@kiln/harness";
import { repoKey, type RepoRef } from "@kiln/integrations";
import { hashDir, type Sandbox, type SandboxProvider, type SnapshotRef } from "@kiln/sandbox";
import type { HarnessType, Runner } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { C, newId, type Run, type RunEvent, type RunKind, type WorkItem } from "./types";

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
  overrides?: { model?: string; harness?: HarnessType };
  replayOf?: string;
  push?: boolean;
  collect?: (sandbox: Sandbox, cwd: string, run: Run) => Promise<void>;
  extraInstructions?: string;
  files?: Record<string, string>;
  backend?: "local" | "docker" | "kubernetes";
};

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
  ].join("\n");
}

export class RunService {
  private readonly sessions = new Map<string, HarnessSession>();
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly specs = new Map<string, Runner>();

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
    const runner: Runner = (agent.runner && resolved.parsed.runners[agent.runner]) || { image: "node:22-bookworm", backend: this.k.options.defaultBackend ?? "local", setupCommands: [], egress: [] };
    const repos = input.repos ?? resolved.factory.repositories.filter((r) => !r.deferred);
    const now = this.k.clock.now().toISOString();
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
      traceId: randomBytes(16).toString("hex"),
      status: "running",
      costUsd: 0,
      eventCount: 0,
      steering: [],
      startedAt: now,
    };
    this.save(run);
    const token = this.k.secrets.issueRunToken(run.id, repos.map(repoKey));
    const decisions = resolved.parsed.decisions["command-guard"] ?? BUILTIN_DECISIONS["command-guard"]!;
    const sandbox = await this.provider(input.backend ?? runner.backend).create({
      runner,
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
      const credentials = this.credentials(harnessType, agent);
      const session = await adapter.start({
        sandbox,
        cwd,
        instructions,
        prompt: input.prompt,
        model,
        skills,
        mcpServers: this.k.options.publicUrl ? [{ name: "kiln", url: `${this.k.options.publicUrl}/mcp`, headers: { authorization: `Bearer ${token}` } }] : [],
        guardUrl: this.k.options.publicUrl ? `${this.k.options.publicUrl}/api/v1/guard` : undefined,
        env: {
          ...credentials,
          KILN_RUN_ID: run.id,
          KILN_RUN_TOKEN: token,
          KILN_FACTORY: input.factory,
          WARP_FACTORY_ID: input.factory,
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
      run.summary = result.summary;
      const raw = cwd ? await sandbox.readFile(`${cwd}/.kiln/result.json`) : await sandbox.readFile(".kiln/result.json");
      if (raw) {
        try {
          run.result = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          this.record(run, "error", "could not parse .kiln/result.json");
        }
      }
      if (input.collect && cwd) await input.collect(sandbox, cwd, run);
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
      run.summary = err instanceof Error ? err.message : String(err);
      this.record(run, "error", run.summary);
    } finally {
      this.sessions.delete(run.id);
      run.finishedAt = this.k.clock.now().toISOString();
      if (run.status !== "paused") {
        this.sandboxes.delete(run.id);
        await sandbox.destroy().catch(() => {});
      }
      this.k.stopping.delete(run.id);
      this.save(run);
      this.record(run, "finished", run.status, { costUsd: run.costUsd });
      this.k.bus.publish("run.finished", { runId: run.id, outcome: run.status === "succeeded" ? "succeeded" : run.status === "failed" ? "failed" : "cancelled", costUsd: run.costUsd });
    }
    return run;
  }

  /**
   * Bring-your-own-keys: the harness credential and the agent's declared secrets, read from Kiln's
   * secrets and passed only to this run's sandbox. Claude Code prefers a subscription token from
   * `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) and falls back to ANTHROPIC_API_KEY.
   */
  credentials(type: HarnessType, agent: ResolvedAgent): Record<string, string> {
    const env: Record<string, string> = {};
    const get = (name: string) => this.k.secrets.getSecret(name);
    for (const name of agent.secrets) {
      const v = get(name);
      if (v) env[name] = v;
    }
    const auth = agent.harness.auth;
    if (auth?.source === "worker") return env;
    if (auth?.source === "secret") {
      const v = get(auth.secretName);
      if (!v) throw new Error(`secret ${auth.secretName} for the ${type} harness is not set`);
      const target = auth.env ?? (type === "claude-code" ? (v.startsWith("sk-ant-oat") ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY") : type === "codex" ? "OPENAI_API_KEY" : auth.secretName);
      env[target] = v;
      return env;
    }
    const defaults: Record<HarnessType, string[]> = {
      "claude-code": ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
      codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      opencode: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    };
    for (const name of defaults[type]) {
      const v = get(name);
      if (v) {
        env[name] = v;
        if (type !== "opencode") break;
      }
    }
    return env;
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
    const run = this.get(runId);
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
