import { BUILTIN_DECISIONS, runDecision, top } from "@kiln/decide";
import type { ResolvedFactory } from "@kiln/definitions";
import { collectPlaywrightEvidence, criteriaCovered, previewCard } from "@kiln/evidence";
import { evalBool, type PipelineStage } from "@kiln/schema";
import { BUILTIN_GATES } from "./gates";
import type { Kiln } from "./kiln";
import { isActive, transition } from "./state";
import { C, newId, type Gate, type Run, type Source, type WorkItem, type WorkItemState } from "./types";

export type StageKind = "triage" | "spec" | "build" | "verify" | "review" | "preview" | "handoff" | "custom";
export type PlanStage = PipelineStage & { kind: StageKind };
type Plan = { mode: "pipeline" | "foreman" | "direct"; stages: PlanStage[]; cursor: number };
type Item = WorkItem & { plan?: Plan };

const TYPE_TO_KIND: Record<string, StageKind> = {
  TRIAGE: "triage",
  SPEC: "spec",
  IMPLEMENT: "build",
  VERIFY: "verify",
  REVIEW: "review",
};

type StepResult = "continue" | "wait" | "done";

/**
 * Drives each work item through its stages. The foreman picks the shortest path from triage
 * and typed decisions; a pipeline definition, when present, fixes the graph instead. Each step
 * persists the item, so the loop resumes after a restart from the last saved stage.
 */
export class Workflow {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly k: Kiln) {}

  get(id: string): Item | undefined {
    return this.k.store.get<Item>(C.workItems, id);
  }

  list(filter: { factory?: string; state?: WorkItemState; projectId?: string } = {}): Item[] {
    return this.k.store
      .list<Item>(C.workItems, (w) => (!filter.factory || w.factory === filter.factory) && (!filter.state || w.state === filter.state) && (!filter.projectId || w.projectId === filter.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private save(wi: Item): Item {
    wi.updatedAt = this.k.clock.now().toISOString();
    this.k.store.put(C.workItems, wi);
    return wi;
  }

  private move(wi: Item, to: WorkItemState, reason: string): Item {
    const from = wi.state;
    const next = transition(wi, to, this.k.clock.now().toISOString()) as Item;
    this.save(next);
    if (from !== to) this.k.bus.publish("work_item.stage_changed", { workItemId: wi.id, factory: wi.factory, from, to, reason });
    return next;
  }

  private say(wi: Item, from: string, role: "foreman" | "agent" | "system", text: string) {
    wi.conversation.push({ at: this.k.clock.now().toISOString(), from, role, text });
  }

  async create(input: {
    factory: string;
    title: string;
    body: string;
    source: Source;
    requester: string;
    projectId?: string;
    pipeline?: string;
    budgetUsd?: number;
    trackerKey?: string;
    directAgent?: string;
    prompt?: string;
  }): Promise<WorkItem> {
    const id = newId("wi");
    const sha = this.k.defs.shaFor(input.factory, id);
    const resolved = this.k.defs.resolved(sha);
    const now = this.k.clock.now().toISOString();
    const wi: Item = {
      id,
      factory: input.factory,
      title: input.title.slice(0, 200),
      body: input.body,
      source: input.source,
      requester: input.requester,
      state: "received",
      definitionSha: sha,
      loops: {},
      conversation: [{ at: now, from: input.requester, role: "human" as const, text: `${input.title}\n\n${input.body}`.trim() }],
      humanTouches: 1,
      costUsd: 0,
      budgetUsd: input.budgetUsd ?? resolved.factory.budgets?.perWorkItemUsd,
      projectId: input.projectId,
      trackerKey: input.trackerKey,
      pipeline: input.pipeline ?? resolved.factory.defaultPipeline,
      createdAt: now,
      updatedAt: now,
    };
    if (input.directAgent) {
      const agent = resolved.agents[input.directAgent];
      const kind = (agent && TYPE_TO_KIND[agent.agentType]) ?? "custom";
      wi.plan = { mode: "direct", cursor: 0, stages: [{ id: input.directAgent, agent: input.directAgent, kind }] };
      if (input.prompt) this.say(wi, "automation", "system", input.prompt);
    }
    this.save(wi);
    this.k.bus.publish("work_item.created", { workItemId: id, factory: input.factory, source: input.source.provider });
    this.k.audit(input.requester, "work_item.created", id, { factory: input.factory, source: input.source });
    return wi;
  }

  /** Record a human interaction: a message, a decision, a steering note. */
  touch(id: string, by: string, text: string) {
    const wi = this.get(id);
    if (!wi) return;
    wi.humanTouches += 1;
    this.say(wi, by, "system", text);
    this.save(wi);
  }

  addMessage(id: string, from: string, text: string) {
    const wi = this.get(id);
    if (!wi) return;
    wi.conversation.push({ at: this.k.clock.now().toISOString(), from, role: "human", text });
    wi.humanTouches += 1;
    this.save(wi);
  }

  park(id: string, reason: string) {
    const wi = this.get(id);
    if (!wi || !isActive(wi.state) || wi.state === "blocked") return;
    wi.blockedReason = reason;
    this.move(wi, "blocked", reason);
  }

  async cancel(id: string, by: string) {
    const wi = this.get(id);
    if (!wi || !isActive(wi.state)) return wi;
    for (const g of this.k.gates.list({ workItemId: id, state: "open" })) this.k.store.put(C.gates, { ...g, state: "expired", decidedBy: by });
    this.k.audit(by, "work_item.cancelled", id);
    return this.move(wi, "cancelled", `cancelled by ${by}`);
  }

  /** Serialize advances per item; safe to call from events, timers and the API at once. */
  advance(id: string): Promise<void> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(() => this.run(id)).catch((err) => {
      const wi = this.get(id);
      if (wi && isActive(wi.state)) {
        wi.blockedReason = err instanceof Error ? err.message : String(err);
        this.say(wi, "kiln", "system", `Stopped: ${wi.blockedReason}`);
        this.save(wi);
        try {
          this.move(this.get(id)!, "blocked", wi.blockedReason);
        } catch {
          /* already terminal */
        }
      }
    });
    this.locks.set(id, next);
    return next.finally(() => {
      if (this.locks.get(id) === next) this.locks.delete(id);
    });
  }

  private async run(id: string) {
    for (let guard = 0; guard < 50; guard++) {
      const wi = this.get(id);
      if (!wi || !isActive(wi.state) || wi.state === "blocked") return;
      const r = await this.step(wi);
      if (r !== "continue") return;
    }
  }

  private resolved(wi: WorkItem): ResolvedFactory {
    return this.k.defs.resolved(wi.definitionSha);
  }

  private agentFor(wi: WorkItem, type: string): string | undefined {
    return Object.values(this.resolved(wi).agents).find((a) => a.agentType === type)?.name;
  }

  private gateDef(wi: WorkItem, name: string) {
    return this.resolved(wi).parsed.gates[name] ?? BUILTIN_GATES[name];
  }

  /** Builds the stage list: from a pipeline file, or the foreman's default path. */
  private initialPlan(wi: Item): Plan {
    const r = this.resolved(wi);
    const pipeline = wi.pipeline ? r.parsed.pipelines[wi.pipeline] : undefined;
    if (pipeline) {
      return {
        mode: "pipeline",
        cursor: 0,
        stages: pipeline.stages.map((s) => ({
          ...s,
          kind: s.action === "preview.deploy" ? "preview" : s.action === "handoff" ? "handoff" : (TYPE_TO_KIND[r.agents[s.agent!]?.agentType ?? ""] ?? "custom"),
        })),
      };
    }
    return { mode: "foreman", cursor: 0, stages: [{ id: "triage", kind: "triage", agent: this.agentFor(wi, "TRIAGE") }] };
  }

  /** After triage, the foreman picks the rest of the path. */
  private async foremanRoute(wi: Item): Promise<PlanStage[]> {
    const needsSpec = await this.needsSpec(wi);
    const stages: PlanStage[] = [];
    const spec = this.agentFor(wi, "SPEC");
    if (needsSpec && spec) stages.push({ id: "spec", kind: "spec", agent: spec, gate: "spec-approval" });
    stages.push({ id: "build", kind: "build", agent: this.agentFor(wi, "IMPLEMENT") ?? this.agentFor(wi, "CUSTOM") ?? this.agentFor(wi, "FOREMAN")! });
    stages.push({ id: "verify", kind: "verify", agent: this.agentFor(wi, "VERIFY"), requires: ["ci_green"], on_fail: "build", max_loops: 3 });
    if (this.k.preview) stages.push({ id: "preview", kind: "preview", action: "preview.deploy", gate: "preview-acceptance" });
    const review = this.agentFor(wi, "REVIEW");
    if (review) stages.push({ id: "review", kind: "review", agent: review, advisory: true, on_fail: "build", max_loops: 2 });
    stages.push({ id: "handoff", kind: "handoff", action: "handoff" });
    return stages;
  }

  /** Skip the spec only with confidence above 0.85 either way; otherwise ask the foreman agent. */
  private async needsSpec(wi: Item): Promise<boolean> {
    const r = this.resolved(wi);
    const outcome = await runDecision(
      "foreman-routing",
      r.parsed.decisions["foreman-routing"] ?? BUILTIN_DECISIONS["foreman-routing"]!,
      { stage: "triage", kind: wi.triage?.kind, size: wi.triage?.size, has_spec: false, title: wi.title, body: wi.body },
      this.k.decide,
    );
    this.k.logDecision(outcome, { stage: "triage" }, { workItemId: wi.id });
    const p = typeof outcome.answers.needs_spec === "number" ? outcome.answers.needs_spec : undefined;
    if (p !== undefined && p >= 0.85) return true;
    if (p !== undefined && p <= 0.15) return false;
    const foreman = this.agentFor(wi, "FOREMAN");
    if (foreman) {
      const run = await this.agentRun(wi, foreman, "route", [
        `Decide the next stage for this work item after triage.`,
        `Triage: ${JSON.stringify(wi.triage)}`,
        `Answer with dispatch.stage "spec" if requirements are ambiguous or the change is large, otherwise "build".`,
      ].join("\n"), { push: false });
      const stage = (run.result?.dispatch as { stage?: string } | undefined)?.stage;
      if (stage) return stage === "spec";
    }
    return ["m", "l", "xl"].includes(wi.triage?.size ?? "m");
  }

  private context(wi: Item) {
    return { triage: wi.triage ?? {}, spec: wi.spec ?? {}, work_item: { title: wi.title, kind: wi.triage?.kind, size: wi.triage?.size, source: wi.source.provider }, loops: wi.loops };
  }

  private branch(wi: WorkItem) {
    return wi.branch ?? `kiln/${wi.id.replace(/^wi_/, "")}-${wi.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}`;
  }

  private briefing(wi: Item, extra: string[] = []): string {
    const lines = [`# ${wi.title}`, "", wi.body];
    if (wi.triage) lines.push("", `Triage: ${wi.triage.kind}, size ${wi.triage.size}. ${wi.triage.summary ?? ""}`);
    if (wi.spec) lines.push("", "Acceptance criteria:", ...wi.spec.criteria.map((c) => `- ${c}`));
    if (wi.review?.findings.length) lines.push("", "Review findings to address:", ...wi.review.findings.map((f) => `- ${f}`));
    const humans = wi.conversation.filter((c) => c.role === "human").slice(1);
    if (humans.length) lines.push("", "Messages from people:", ...humans.map((c) => `- ${c.from}: ${c.text}`));
    return [...lines, ...extra].join("\n");
  }

  private async agentRun(wi: Item, agent: string, stage: string, prompt: string, opts: { push?: boolean; collect?: Parameters<Kiln["runs"]["execute"]>[0]["collect"] } = {}): Promise<Run> {
    if (wi.budgetUsd !== undefined && wi.costUsd >= wi.budgetUsd) {
      throw new Error(`budget of $${wi.budgetUsd} reached ($${wi.costUsd.toFixed(2)} spent)`);
    }
    const run = await this.k.runs.execute({
      factory: wi.factory,
      sha: wi.definitionSha,
      agent,
      stage,
      prompt,
      workItem: wi,
      branch: this.branch(wi),
      push: opts.push ?? true,
      collect: opts.collect,
    });
    const fresh = this.get(wi.id)!;
    fresh.costUsd += run.costUsd;
    fresh.branch = this.branch(wi);
    this.say(fresh, agent, "agent", run.summary || `${agent} ${run.status}`);
    this.save(fresh);
    Object.assign(wi, fresh);
    const memories = (run.result?.memories as { title: string; body: string; tags?: string[] }[] | undefined) ?? [];
    for (const m of memories) this.k.memories.propose(wi.factory, { ...m, author: agent, sourceRunId: run.id });
    return run;
  }

  private async step(wi: Item): Promise<StepResult> {
    // Waiting at a gate: nothing to do until it is decided.
    const waitingOn = wi.state === "awaiting_spec" ? "spec" : wi.state === "awaiting_preview" ? "preview" : undefined;
    if (waitingOn && this.k.gates.list({ workItemId: wi.id, state: "open" }).some((g) => g.kind === waitingOn)) return "wait";
    if (!wi.plan) {
      wi.plan = this.initialPlan(wi);
      this.save(wi);
    }
    const plan = wi.plan;
    const stage = plan.stages[plan.cursor];
    if (!stage) return "done";
    if (stage.skip_if && evalBool(stage.skip_if, this.context(wi))) {
      this.say(wi, "foreman", "foreman", `Skipping ${stage.id}: ${stage.skip_if}`);
      plan.cursor += 1;
      this.save(wi);
      return "continue";
    }
    wi.stage = stage.id;
    switch (stage.kind) {
      case "triage":
        return this.triage(wi, stage);
      case "spec":
        return this.spec(wi, stage);
      case "build":
      case "custom":
        return this.build(wi, stage);
      case "verify":
        return this.verify(wi, stage);
      case "preview":
        return this.previewStage(wi, stage);
      case "review":
        return this.review(wi, stage);
      case "handoff":
        return this.handoff(wi);
    }
  }

  private nextStage(wi: Item): StepResult {
    wi.plan!.cursor += 1;
    this.save(wi);
    return "continue";
  }

  /** Loop back to an earlier stage (on_fail), bounded by max_loops. */
  private loopBack(wi: Item, stage: PlanStage, reason: string): StepResult {
    const target = stage.on_fail;
    const count = (wi.loops[stage.id] ?? 0) + 1;
    wi.loops[stage.id] = count;
    const max = stage.max_loops ?? 3;
    const idx = target ? wi.plan!.stages.findIndex((s) => s.id === target) : -1;
    if (idx < 0 || count > max) {
      this.say(wi, "foreman", "foreman", `${stage.id} failed ${count} time(s): ${reason}`);
      this.save(wi);
      void this.k.gates.open({ workItem: wi, kind: "question", name: `${stage.id}-stuck`, title: `${stage.id} keeps failing on "${wi.title}"`, question: `${reason}\nReply with guidance, or reject to stop.` });
      this.park(wi.id, `${stage.id} failed after ${count} attempt(s): ${reason}`);
      return "wait";
    }
    this.say(wi, "foreman", "foreman", `${stage.id} did not pass (${reason}); back to ${target} (${count}/${max}).`);
    wi.plan!.cursor = idx;
    this.save(wi);
    if (wi.state !== "building") this.move(wi, "building", reason);
    return "continue";
  }

  private async triage(wi: Item, stage: PlanStage): Promise<StepResult> {
    wi = this.move(wi, "triaging", "triage started");
    const r = this.resolved(wi);
    const recent = this.k.tracker ? (await this.k.tracker.listRecent(20).catch(() => [])).map((i) => `${i.key}: ${i.title}`) : [];
    const outcome = await runDecision("triage", r.parsed.decisions.triage ?? BUILTIN_DECISIONS.triage!, { title: wi.title, body: wi.body, recent_titles: recent }, this.k.decide);
    this.k.logDecision(outcome, { title: wi.title }, { workItemId: wi.id });
    const kind = top(outcome.answers.kind);
    const size = top(outcome.answers.size);
    if (kind && size && kind.p >= 0.6 && size.p >= 0.6) {
      wi.triage = { kind: kind.option, size: size.option, confidence: Math.min(kind.p, size.p) };
    } else if (stage.agent) {
      const run = await this.agentRun(wi, stage.agent, "triage", this.briefing(wi, ["", "Triage this request: classify kind and size, look for duplicates, and summarize the cause or scope."]), { push: false });
      const res = (run.result ?? {}) as { kind?: string; size?: string; summary?: string; duplicateOf?: string };
      wi.triage = { kind: res.kind ?? kind?.option ?? "feature", size: res.size ?? size?.option ?? "m", summary: res.summary, duplicateOf: res.duplicateOf, confidence: 0.9 };
    } else {
      wi.triage = { kind: kind?.option ?? "feature", size: size?.option ?? "m", confidence: Math.min(kind?.p ?? 0, size?.p ?? 0) };
    }
    if (outcome.action === "duplicate" || wi.triage.duplicateOf) {
      this.say(wi, "foreman", "foreman", `This may duplicate ${wi.triage.duplicateOf ?? "a recent issue"}; continuing unless told otherwise.`);
    }
    if (wi.plan!.mode === "foreman") wi.plan!.stages.push(...(await this.foremanRoute(wi)));
    this.say(wi, "foreman", "foreman", `Triaged as ${wi.triage.kind}, size ${wi.triage.size}. Path: ${wi.plan!.stages.slice(1).map((s) => s.id).join(" → ")}.`);
    return this.nextStage(wi);
  }

  private async spec(wi: Item, stage: PlanStage): Promise<StepResult> {
    const approved = this.k.gates.list({ workItemId: wi.id }).find((g) => g.name === (stage.gate ?? "spec-approval") && g.state === "approved");
    if (approved && wi.spec) return this.nextStage(wi);
    wi = this.move(wi, "planning", "writing the spec");
    const feedback = this.k.gates
      .list({ workItemId: wi.id })
      .filter((g) => g.kind === "spec" && g.state === "rejected" && g.answer)
      .map((g) => `Requested changes: ${g.answer}`);
    let run = await this.agentRun(wi, stage.agent!, "spec", this.briefing(wi, ["", "Write the spec with numbered, testable acceptance criteria (AC1, AC2, …) and user stories.", ...feedback]));
    let res = (run.result ?? {}) as { specPath?: string; criteria?: string[]; stories?: string[]; openQuestions?: string[] };
    const failing = await this.checkCriteria(wi, res.criteria ?? []);
    if (failing.length && (wi.loops.spec ?? 0) < 1) {
      wi.loops.spec = (wi.loops.spec ?? 0) + 1;
      run = await this.agentRun(wi, stage.agent!, "spec", this.briefing(wi, ["", "These acceptance criteria are not testable or are ambiguous; rewrite them:", ...failing.map((c) => `- ${c}`)]));
      res = (run.result ?? res) as typeof res;
    }
    wi.spec = { path: res.specPath ?? `docs/specs/${wi.id}.md`, criteria: res.criteria ?? [], stories: res.stories ?? [], openQuestions: res.openQuestions ?? [] };
    const stillFailing = await this.checkCriteria(wi, wi.spec.criteria);
    const pr = await this.ensurePullRequest(wi, true);
    this.save(wi);
    if (!stage.gate) return this.nextStage(wi);
    this.move(wi, "awaiting_spec", "spec ready for approval");
    await this.k.gates.open({
      workItem: wi,
      kind: "spec",
      name: stage.gate,
      def: this.gateDef(wi, stage.gate),
      title: `Approve the spec for "${wi.title}"`,
      question: [
        ...wi.spec.criteria.map((c) => `- ${c}`),
        ...(wi.spec.openQuestions.length ? ["Open questions:", ...wi.spec.openQuestions.map((q) => `- ${q}`)] : []),
        ...(stillFailing.length ? ["Not yet testable:", ...stillFailing.map((c) => `- ${c}`)] : []),
      ].join("\n"),
      evidence: pr ? [{ label: "Spec PR", url: pr.url }] : [],
    });
    return "wait";
  }

  private async checkCriteria(wi: Item, criteria: string[]): Promise<string[]> {
    const def = this.resolved(wi).parsed.decisions["spec-check"] ?? BUILTIN_DECISIONS["spec-check"]!;
    const failing: string[] = [];
    for (const criterion of criteria) {
      const o = await runDecision("spec-check", def, { criterion }, this.k.decide);
      this.k.logDecision(o, { criterion }, { workItemId: wi.id });
      if (o.action === "reject") failing.push(criterion);
    }
    return failing;
  }

  private async ensurePullRequest(wi: Item, draft: boolean) {
    const repo = this.resolved(wi).factory.repositories[0]!;
    const alias = this.resolved(wi).factory.alias ?? wi.factory;
    const body = [
      `Work item: ${this.k.link(`/runs/${wi.id}`)}`,
      wi.source.url ? `Source: ${wi.source.url}` : "",
      wi.trackerKey ? `Tracker: ${wi.trackerKey}` : "",
      "",
      wi.body,
      ...(wi.spec?.criteria.length ? ["", "## Acceptance criteria", ...wi.spec.criteria.map((c) => `- [ ] ${c}`)] : []),
      "",
      `Opened by the Kiln factory \`${alias}\`. A person reviews and merges.`,
    ]
      .filter((l) => l !== undefined)
      .join("\n");
    const branch = this.branch(wi);
    if (!(await this.k.forge.listPullRequests(repo, { state: "all", head: branch })).length && !this.k.forgeHasBranch(repo, branch)) return undefined;
    if (wi.pr) {
      const pr = await this.k.forge.updatePullRequest(repo, wi.pr.number, { body, draft });
      return pr;
    }
    try {
      const pr = await this.k.forge.openPullRequest({ repo, head: branch, title: wi.title, body, labels: [`factory:${alias}`], draft });
      wi.pr = { repo: pr.repo, number: pr.number, url: pr.url };
      this.save(wi);
      this.k.bus.publish("pull_request.opened", { workItemId: wi.id, repo: pr.repo, number: pr.number, url: pr.url, branch });
      return pr;
    } catch (err) {
      this.say(wi, "kiln", "system", `Could not open a pull request: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private async build(wi: Item, stage: PlanStage): Promise<StepResult> {
    if (wi.state !== "building") wi = this.move(wi, "building", `${stage.id} started`);
    const units = stage.fan_out === "per_user_story" && wi.spec?.stories.length ? wi.spec.stories : [undefined];
    let failed: Run | undefined;
    for (const story of units) {
      const run = await this.agentRun(wi, stage.agent!, stage.id, this.briefing(wi, story ? ["", `Implement this user story now: ${story}`] : ["", "Implement the change and its tests."]));
      if (run.status !== "succeeded") failed = run;
    }
    if (failed) {
      wi.loops[`${stage.id}-errors`] = (wi.loops[`${stage.id}-errors`] ?? 0) + 1;
      this.save(wi);
      if (wi.loops[`${stage.id}-errors`]! >= 2) {
        this.park(wi.id, `${stage.agent} failed twice: ${failed.summary}`);
        await this.k.gates.open({ workItem: wi, kind: "question", name: "build-failed", title: `${stage.agent} could not finish "${wi.title}"`, question: failed.summary });
        return "wait";
      }
      return "continue";
    }
    await this.ensurePullRequest(wi, false);
    wi.review = undefined;
    return this.nextStage(wi);
  }

  private async verify(wi: Item, stage: PlanStage): Promise<StepResult> {
    const repo = this.resolved(wi).factory.repositories[0]!;
    const requires = stage.requires ?? ["ci_green"];
    const problems: string[] = [];
    if (stage.agent) {
      const run = await this.agentRun(wi, stage.agent, stage.id, this.briefing(wi, ["", "Verify the change against every acceptance criterion. Record a Playwright video per criterion (title tests AC1, AC2, …)."]), {
        push: false,
        collect: async (sandbox, cwd) => {
          wi.evidence = await collectPlaywrightEvidence({ sandbox, store: this.k.objects, workItemId: wi.id, cwd, run: false });
        },
      });
      const fresh = this.get(wi.id)!;
      fresh.evidence = wi.evidence;
      Object.assign(wi, fresh);
      if (requires.includes("tests_pass") && run.result?.testsPassed !== true) problems.push("tests did not pass");
    }
    if (requires.includes("criteria_videos") && wi.spec?.criteria.length) {
      const ids = wi.spec.criteria.map((c) => /^(AC\d+)/.exec(c)?.[1] ?? c);
      const covered = wi.evidence ? criteriaCovered(wi.evidence, ids) : { ok: false, missing: ids };
      if (!covered.ok) problems.push(`no passing video for ${covered.missing.join(", ")}`);
    }
    if (requires.includes("ci_green") && wi.branch) {
      const checks = await this.k.forge.checks(repo, wi.branch);
      if (checks.status === "pending") {
        wi.blockedReason = "waiting for CI";
        this.save(wi);
        return "wait";
      }
      if (checks.status === "failure") problems.push(`CI failed: ${checks.runs.filter((r) => r.conclusion !== "success").map((r) => r.name).join(", ")}`);
    }
    wi.blockedReason = undefined;
    if (problems.length) return this.loopBack(wi, stage, problems.join("; "));
    this.save(wi);
    return this.nextStage(wi);
  }

  private async previewStage(wi: Item, stage: PlanStage): Promise<StepResult> {
    const accepted = this.k.gates.list({ workItemId: wi.id }).find((g) => g.kind === "preview" && g.state === "approved" && g.name === (stage.gate ?? "preview-acceptance") && g.openedAt >= (wi.previewDeployedAt ?? ""));
    if (accepted) return this.nextStage(wi);
    if (!this.k.preview || !wi.pr) return this.nextStage(wi);
    const deployed = await this.k.preview.deploy({ repo: wi.pr.repo, branch: wi.branch!, pr: wi.pr.number });
    wi.previewUrl = deployed.url;
    wi.previewDeployedAt = this.k.clock.now().toISOString();
    const card = previewCard({ ...(wi.evidence ?? { workItemId: wi.id, criteria: {}, artifacts: [] }), previewUrl: deployed.url, prUrl: wi.pr.url }, wi.title);
    const [owner, name] = wi.pr.repo.split("/");
    await this.k.forge.comment({ owner: owner!, name: name! }, wi.pr.number, card);
    this.save(wi);
    if (!stage.gate) return this.nextStage(wi);
    this.move(wi, "awaiting_preview", "preview deployed");
    await this.k.gates.open({
      workItem: wi,
      kind: "preview",
      name: stage.gate,
      def: this.gateDef(wi, stage.gate),
      title: `Accept the preview of "${wi.title}"`,
      question: card,
      evidence: [{ label: "Preview", url: deployed.url }, ...(wi.evidence?.artifacts.filter((a) => a.kind === "video").map((a) => ({ label: a.key.split("/").pop()!, url: a.url })) ?? [])],
    });
    return "wait";
  }

  private async review(wi: Item, stage: PlanStage): Promise<StepResult> {
    wi = this.move(wi, "reviewing", "review started");
    const r = this.resolved(wi);
    const risk = await runDecision("review-risk", r.parsed.decisions["review-risk"] ?? BUILTIN_DECISIONS["review-risk"]!, { title: wi.title, files: [], additions: 0, deletions: 0 }, this.k.decide);
    this.k.logDecision(risk, { title: wi.title }, { workItemId: wi.id });
    const reviewers = risk.action === "code_owners" ? (this.k.options.roles?.["code-owners"] ?? []) : [wi.requester];
    const run = await this.agentRun(wi, stage.agent!, stage.id, this.briefing(wi, ["", `Review the pull request ${wi.pr?.url ?? ""} adversarially. Report findings; do not post them yourself.`]), { push: false });
    const res = (run.result ?? {}) as { verdict?: string; findings?: string[] };
    const verdict = res.verdict ?? "accepted";
    wi.review = { verdict, findings: res.findings ?? [], reviewers };
    this.save(wi);
    if (verdict === "changes_requested" && (res.findings?.length ?? 0) > 0) return this.loopBack(wi, stage, `${res.findings!.length} review finding(s)`);
    if (verdict === "needs_human" && wi.pr) {
      const [owner, name] = wi.pr.repo.split("/");
      await this.k.forge.comment({ owner: owner!, name: name! }, wi.pr.number, ["Findings that need a person's judgment:", ...(res.findings ?? []).map((f) => `- ${f}`)].join("\n"));
    }
    return this.nextStage(wi);
  }

  private async handoff(wi: Item): Promise<StepResult> {
    if (wi.state === "handed_off") return "wait";
    if (!wi.pr) {
      this.park(wi.id, "nothing to hand off: no pull request was opened");
      return "wait";
    }
    const repo = this.resolved(wi).factory.repositories[0]!;
    await this.k.forge.addLabels(repo, wi.pr.number, [`factory:${this.resolved(wi).factory.alias ?? wi.factory}`]);
    this.move(wi, "handed_off", "pull request ready for a human merge");
    const msg = [`Ready to merge: ${wi.pr.url}`, wi.previewUrl ? `Preview: ${wi.previewUrl}` : "", wi.review?.verdict === "needs_human" ? "Some review findings need your judgment; they are on the PR." : ""].filter(Boolean).join("\n");
    await this.k.notify(wi, msg);
    await this.k.gates.open({ workItem: wi, kind: "merge", name: "merge", title: `Merge "${wi.title}"`, question: `Review and merge ${wi.pr.url}. Approve here only to confirm completion without a merge.`, evidence: [{ label: "Pull request", url: wi.pr.url }], assignees: wi.review?.reviewers });
    if (wi.trackerKey && this.k.tracker) await this.k.tracker.setState(wi.trackerKey, "in_progress").catch(() => {});
    return "done";
  }

  /** A gate was decided: continue, revise or stop. */
  async onGateDecided(gate: Gate) {
    const wi = this.get(gate.workItemId);
    if (!wi || !isActive(wi.state)) return;
    if (gate.kind === "merge") {
      if (gate.state === "approved") await this.complete(wi.id, { by: "human", ref: `gate:${gate.id}:${gate.decidedBy}` });
      return;
    }
    if (gate.kind === "question" && wi.state === "blocked") {
      if (gate.state === "rejected") {
        await this.cancel(wi.id, gate.decidedBy ?? "human");
        return;
      }
      if (gate.answer) this.addMessage(wi.id, gate.decidedBy ?? "human", gate.answer);
      const fresh = this.get(wi.id)!;
      fresh.blockedReason = undefined;
      fresh.loops = {};
      this.save(fresh);
      this.move(fresh, "building", "resumed after a human answer");
      await this.advance(wi.id);
      return;
    }
    if (gate.state === "rejected" && (gate.kind === "spec" || gate.kind === "preview")) {
      const fresh = this.get(wi.id)!;
      if (gate.answer) fresh.conversation.push({ at: this.k.clock.now().toISOString(), from: gate.decidedBy ?? "human", role: "human", text: gate.answer });
      const target = gate.kind === "spec" ? "spec" : "build";
      const idx = fresh.plan?.stages.findIndex((s) => s.kind === target) ?? -1;
      if (idx >= 0) fresh.plan!.cursor = idx;
      this.save(fresh);
      this.move(fresh, gate.kind === "spec" ? "planning" : "building", `${gate.title} rejected`);
    }
    await this.advance(wi.id);
  }

  /** Completion needs a merge event or a person's confirmation; nothing else completes work. */
  async complete(id: string, completion: { by: "merge" | "human"; ref: string }) {
    const wi = this.get(id);
    if (!wi || wi.state === "complete") return wi;
    wi.completion = completion;
    let next = wi;
    if (wi.state !== "handed_off") next = this.move({ ...wi }, "handed_off", "completed before hand-off");
    next = this.move({ ...next, completion }, "complete", completion.by === "merge" ? `merged (${completion.ref})` : `confirmed by ${completion.ref}`);
    for (const g of this.k.gates.list({ workItemId: id, state: "open" })) {
      this.k.store.put(C.gates, { ...g, state: "approved", decidedBy: completion.by === "merge" ? "forge:merge" : g.decidedBy, decidedAt: this.k.clock.now().toISOString() });
    }
    if (next.trackerKey && this.k.tracker) await this.k.tracker.setState(next.trackerKey, "done").catch(() => {});
    await this.k.notify(next, `Done: ${next.pr?.url ?? next.title} is ${completion.by === "merge" ? "merged" : "confirmed complete"}.`);
    return next;
  }

  async onPullRequestMerged(repo: string, number: number, by?: string) {
    const wi = this.list().find((w) => w.pr?.repo === repo && w.pr.number === number);
    if (!wi) return undefined;
    return this.complete(wi.id, { by: "merge", ref: `${repo}#${number}${by ? ` by ${by}` : ""}` });
  }

  /** New review comments on a handed-off PR send the work back to implementation. */
  async onReviewSubmitted(repo: string, number: number, text: string, by: string) {
    const wi = this.list().find((w) => w.pr?.repo === repo && w.pr.number === number);
    if (!wi || !isActive(wi.state)) return;
    this.addMessage(wi.id, by, text);
    const fresh = this.get(wi.id)!;
    const idx = fresh.plan?.stages.findIndex((s) => s.kind === "build") ?? -1;
    if (idx < 0) return;
    for (const g of this.k.gates.list({ workItemId: wi.id, state: "open" })) if (g.kind === "merge") this.k.store.put(C.gates, { ...g, state: "expired", decidedBy: "kiln:revision" });
    fresh.plan!.cursor = idx;
    fresh.review = { verdict: "changes_requested", findings: [text], reviewers: [by] };
    this.save(fresh);
    this.move(fresh, "building", `review from ${by}`);
    await this.advance(wi.id);
  }
}
