import { BUILTIN_DECISIONS, runDecision, top } from "@kiln/decide";
import { splitFrontmatter, treeSha, validateTree, type DefinitionTree } from "@kiln/definitions";
import type { Kiln } from "./kiln";
import { C, newId, type Proposal, type Run, type Score } from "./types";

export type ImproverInput = {
  factory: string;
  agent: string;
  category: string;
  tree: DefinitionTree;
  failures: { score: Score; run: Run }[];
  negatives: Proposal[];
};
export type ImproverOutput = { target: "definition" | "app"; changes: Record<string, string>; rationale: string };

export interface Improver {
  readonly name: string;
  propose(input: ImproverInput): Promise<ImproverOutput>;
}

export function agentFile(tree: DefinitionTree, agent: string): string | undefined {
  return Object.keys(tree).find((p) => p === `agents/${agent}/agent.md`);
}

/**
 * Deterministic improver: turns reviewed failures into an explicit "lessons" section in the
 * agent's instructions. It never repeats a lesson a reviewer already rejected.
 */
export class RuleImprover implements Improver {
  readonly name = "rule";

  async propose(input: ImproverInput): Promise<ImproverOutput> {
    const path = agentFile(input.tree, input.agent);
    if (!path) return { target: "definition", changes: {}, rationale: `no agents/${input.agent}/agent.md to change` };
    const rejected = new Set(input.negatives.flatMap((n) => Object.values(n.changes).flatMap((c) => c.split("\n").filter((l) => l.startsWith("- ")))));
    const lessons = [...new Set(input.failures.map(({ score }) => `- Avoid "${score.label}" on ${score.scorer}: ${score.rationale ?? "see the linked runs"}`))].filter((l) => !rejected.has(l));
    const src = input.tree[path]!;
    const { yaml, body, hasFrontmatter } = splitFrontmatter(src);
    const marker = "## Lessons from reviewed failures";
    const base = body.includes(marker) ? body.slice(0, body.indexOf(marker)).trimEnd() : body;
    const existing = body.includes(marker) ? body.slice(body.indexOf(marker) + marker.length).split("\n").filter((l) => l.startsWith("- ")) : [];
    const all = [...new Set([...existing, ...lessons])];
    const nextBody = `${base}\n\n${marker}\n\n${all.join("\n")}\n`;
    const content = hasFrontmatter ? `---\n${yaml}\n---\n${nextBody}` : nextBody;
    return {
      target: "definition",
      changes: content === src ? {} : { [path]: content },
      rationale: `${input.failures.length} ${input.category} failure(s) of ${input.agent}; added ${lessons.length} lesson(s) to its instructions.`,
    };
  }
}

/** Runs the factory's improver agent over a checkout of the definition tree and reads back its edits. */
export class AgentImprover implements Improver {
  readonly name = "agent";

  constructor(
    private readonly k: Kiln,
    private readonly agent = "improver",
  ) {}

  async propose(input: ImproverInput): Promise<ImproverOutput> {
    const b = this.k.defs.require(input.factory);
    const files = Object.fromEntries(Object.entries(input.tree).map(([p, c]) => [`.kiln/definition/${p}`, c]));
    let changes: Record<string, string> = {};
    const prompt = [
      `Improve the factory definition in .kiln/definition so that agent "${input.agent}" stops failing like this (${input.category}):`,
      ...input.failures.map(({ score, run }) => `- run ${run.id}: ${score.scorer} = ${score.label}. ${score.rationale ?? ""} Summary: ${run.summary ?? ""}`),
      ...(input.negatives.length ? ["Reviewers rejected these earlier proposals; do not repeat them:", ...input.negatives.map((n) => `- ${n.rationale}`)] : []),
      "Edit instructions, skills, routers or runners. Do not touch policies/ or gates/. Write a one-paragraph rationale as result.summary.",
    ].join("\n");
    const model = this.k.defs.resolved(b.appliedSha!).factory.selfImprovement?.model;
    const run = await this.k.runs.execute({
      factory: input.factory,
      sha: b.appliedSha!,
      agent: this.agent,
      prompt,
      kind: "improver",
      repos: [],
      files,
      push: false,
      source: "SELF_IMPROVEMENT",
      title: `Self-improvement for ${input.agent}`,
      ...(model ? { overrides: { model } } : {}),
      collect: async (sandbox) => {
        const list = await sandbox.exec("cd .kiln/definition && find . -type f | sed 's|^./||'", { trusted: true });
        for (const p of list.stdout.split("\n").filter(Boolean)) {
          const c = await sandbox.readFile(`.kiln/definition/${p}`);
          if (c !== undefined && c !== input.tree[p]) changes[p] = c;
        }
      },
    });
    if (run.status !== "succeeded") changes = {};
    return { target: "definition", changes, rationale: String(run.result?.summary ?? run.summary ?? "") };
  }
}

function glob(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
}

export class ImprovementService {
  constructor(private readonly k: Kiln) {}

  list(factory?: string): Proposal[] {
    return this.k.store.list<Proposal>(C.proposals, (p) => !factory || p.factory === factory).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string) {
    return this.k.store.get<Proposal>(C.proposals, id);
  }

  /** Scheduled check: enough distinct unreviewed failures, or the oldest is too old. */
  async check(factory: string, opts: { runNow?: boolean } = {}): Promise<Proposal[]> {
    const resolved = this.k.defs.current(factory);
    if (resolved.factory.selfImprovement?.enabled === false && !opts.runNow) return [];
    const threshold = resolved.factory.selfImprovement?.failedRunThreshold ?? 25;
    const maxAgeMs = (resolved.factory.selfImprovement?.maxAgeDays ?? 7) * 86_400_000;
    const now = this.k.clock.now().getTime();
    const byAgent = new Map<string, Score[]>();
    for (const s of this.k.scoring.failures(factory)) byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s]);
    const out: Proposal[] = [];
    for (const [agent, scores] of byAgent) {
      const runs = new Set(scores.map((s) => s.runId));
      const oldest = Math.min(...scores.map((s) => new Date(s.createdAt).getTime()));
      if ((opts.runNow && runs.size >= 1) || runs.size >= threshold || now - oldest >= maxAgeMs) {
        const p = await this.improve(factory, agent, scores);
        if (p) out.push(p);
      }
    }
    return out;
  }

  async improve(factory: string, agent: string, scores: Score[]): Promise<Proposal | undefined> {
    const binding = this.k.defs.require(factory);
    const tree = this.k.defs.tree(binding.appliedSha!)!;
    const resolved = this.k.defs.resolved(binding.appliedSha!);
    const failures = scores.map((score) => ({ score, run: this.k.runs.get(score.runId)! })).filter((f) => f.run);
    // Cluster first, so the improver reads one kind of failure at a time.
    const groups = new Map<string, typeof failures>();
    for (const f of failures) {
      const o = await runDecision("failure-category", resolved.parsed.decisions["failure-category"] ?? BUILTIN_DECISIONS["failure-category"]!, { agent, label: f.score.label, summary: f.run.summary ?? "" }, this.k.decide);
      const cat = top(o.answers.failure_category)?.option ?? "instructions";
      this.k.store.put(C.scores, { ...f.score, failureCategory: cat });
      groups.set(cat, [...(groups.get(cat) ?? []), f]);
    }
    const [category, group] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ["instructions", failures];
    const negatives = this.list(factory).filter((p) => p.agent === agent && p.state === "rejected");
    const proposal = await this.k.improver.propose({ factory, agent, category, tree, failures: group, negatives });

    const protectedGlobs = Object.values(resolved.parsed.policies).flatMap((p) => p.protectedPaths ?? []).map(glob);
    const twoApproval = Object.values(resolved.parsed.policies).flatMap((p) => p.twoApprovalPaths ?? []).map(glob);
    const dropped = Object.keys(proposal.changes).filter((p) => protectedGlobs.some((g) => g.test(p)) || p.startsWith("policies/") || p.startsWith("gates/"));
    const changes = Object.fromEntries(Object.entries(proposal.changes).filter(([p]) => !dropped.includes(p)));
    if (Object.keys(changes).length === 0) {
      this.k.audit("self-improvement", "proposal.empty", factory, { agent, dropped });
      return undefined;
    }
    const candidate = { ...tree, ...changes };
    const valid = validateTree(candidate);
    if (!valid.ok) {
      this.k.audit("self-improvement", "proposal.invalid", factory, { agent, errors: valid.errors.slice(0, 5) });
      return undefined;
    }

    // Replay 10–30 of the failing runs under the current and the proposed definition.
    const limit = Math.min(this.k.options.replayLimit ?? 30, group.length);
    const replay: Proposal["replay"] = [];
    for (const { run } of group.slice(0, limit)) {
      const before = await this.k.runs.replay(run.id, { sha: binding.appliedSha });
      const after = await this.k.runs.replay(run.id, { tree: candidate });
      const passed = async (r: Run) => (await this.k.scoring.scoreRun(r.id, { force: true })).every((s) => s.passed);
      replay.push({ runId: run.id, before: await passed(before), after: await passed(after) });
    }
    const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
    const passRateBefore = rate(replay.map((r) => r.before));
    const passRateAfter = rate(replay.map((r) => r.after));
    const needsTwoApprovals = Object.keys(changes).some((p) => twoApproval.some((g) => g.test(p)));
    const reviewer = this.pickReviewer(factory, `${agent}:${category}:${group.length}`);
    const body = [
      `Self-improvement for \`${agent}\` (${category}).`,
      "",
      proposal.rationale,
      "",
      "## Regressions addressed",
      ...group.map(({ score, run }) => `- [${run.id}](${this.k.link(`/runs/${run.id}`)}): ${score.scorer} = ${score.label}${score.rationale ? ` — ${score.rationale}` : ""}`),
      "",
      "## Replay",
      `Pass rate before: ${(passRateBefore * 100).toFixed(0)}% · after: ${(passRateAfter * 100).toFixed(0)}% (${replay.length} runs)`,
      "",
      "| Run | Before | After |",
      "| --- | --- | --- |",
      ...replay.map((r) => `| ${r.runId} | ${r.before ? "pass" : "fail"} | ${r.after ? "pass" : "fail"} |`),
      "",
      "## Changes",
      ...Object.keys(changes).map((p) => `- \`${p}\``),
      ...(dropped.length ? ["", `Dropped changes to protected paths: ${dropped.join(", ")}`] : []),
      ...(needsTwoApprovals ? ["", "This change touches a path that needs two human approvals."] : []),
      ...(reviewer ? ["", `Reviewer: ${reviewer}`] : []),
    ].join("\n");
    // The meta rule: a proposal without replay evidence is never opened.
    if (!body.includes("## Replay") || replay.length === 0) throw new Error("self-improvement proposals must include a replay report");

    const p: Proposal = {
      id: newId("prop"),
      factory,
      agent,
      category,
      target: proposal.target,
      failures: group.map(({ score }) => ({ scoreId: score.id, runId: score.runId, label: score.label })),
      changes,
      rationale: proposal.rationale,
      replay,
      passRateBefore,
      passRateAfter,
      body,
      candidateSha: treeSha(candidate),
      needsTwoApprovals,
      ...(reviewer ? { reviewer } : {}),
      droppedProtectedPaths: dropped,
      state: "open",
      createdAt: this.k.clock.now().toISOString(),
    };
    this.k.store.put(C.definitions, { id: p.candidateSha!, factory, tree: candidate, author: `self-improvement:${p.id}`, createdAt: p.createdAt, valid: true });
    if (binding.definitionRepo) {
      const branch = `kiln/self-improve-${agent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${p.id.slice(-6)}`;
      const repo = binding.definitionRepo;
      const files = Object.fromEntries(Object.entries(changes).map(([path, c]) => [repo.dir ? `${repo.dir}/${path}` : path, c]));
      await this.k.commitFiles(repo, branch, files, `Self-improvement for ${agent}`);
      const pr = await this.k.forge.openPullRequest({ repo, head: branch, base: repo.ref, title: `Self-improvement: ${agent} (${category})`, body, labels: ["kiln:self-improvement"] });
      p.pr = { repo: pr.repo, number: pr.number, url: pr.url };
    }
    this.k.store.put(C.proposals, p);
    this.k.scoring.markReviewed(group.map(({ score }) => score.id));
    this.k.bus.publish("self_improvement.proposed", { factory, agent, url: p.pr?.url ?? this.k.link(`/factories/${factory}/self-improvement/${p.id}`) });
    this.k.audit("self-improvement", "proposal.opened", p.id, { factory, agent, passRateBefore, passRateAfter });
    return p;
  }

  /**
   * One reviewer from the factory's pool: admins (default), the whole team, a custom list, or
   * none. The pick is stable for the same failures so retries ask the same person.
   */
  pickReviewer(factory: string, seed: string): string | undefined {
    const si = this.k.defs.current(factory).factory.selfImprovement;
    const type = si?.reviewers.type ?? "admins";
    const roles = this.k.options.roles ?? {};
    const pool = type === "none" ? [] : type === "custom" ? (si?.reviewers.emails ?? []) : type === "team" ? [...new Set(Object.values(roles).flat())] : (roles.admins ?? []);
    if (!pool.length) return undefined;
    const h = [...seed].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return [...pool].sort()[h % pool.length];
  }

  /** Settings shown on the self-improvement page: the toggle, threshold, reviewers, model and per-scorer toggles. */
  settings(factory: string) {
    const r = this.k.defs.current(factory);
    const si = r.factory.selfImprovement;
    return {
      enabled: si?.enabled ?? true,
      failedRunThreshold: si?.failedRunThreshold ?? 25,
      maxAgeDays: si?.maxAgeDays ?? 7,
      reviewers: si?.reviewers ?? { type: "admins" },
      model: si?.model,
      scorers: Object.entries(r.parsed.scorers).map(([slug, s]) => ({ slug, name: s.frontmatter.name, selfImprovement: s.frontmatter.selfImprovement })),
      unreviewedFailures: this.k.scoring.failures(factory).length,
    };
  }

  /**
   * A reviewer accepts: apply as a 10% canary. Paths marked for two approvals need two people,
   * unless a factory Admin forces it (`force`, checked by the caller).
   */
  approve(id: string, by: string, opts: { force?: boolean } = {}): Proposal {
    const p = this.get(id);
    if (!p || p.state !== "open") throw new Error(`proposal ${id} is not open`);
    const approvals = new Set([...(p.approvals ?? []), by]);
    if (by.startsWith("kiln-agent") || by.startsWith("self-improvement")) throw new Error("agents cannot approve proposals");
    if (p.needsTwoApprovals && approvals.size < 2 && !opts.force) {
      const next = { ...p, approvals: [...approvals] };
      this.k.store.put(C.proposals, next);
      return next;
    }
    const tree = this.k.defs.tree(p.candidateSha!)!;
    const r = this.k.defs.apply(tree, { author: `proposal:${p.id} approved by ${[...approvals].join(", ")}`, factory: p.factory, canaryPercent: this.k.options.canaryPercent ?? 10 });
    if (!r.ok) throw new Error(`candidate no longer applies: ${r.errors[0]}`);
    const next: Proposal = { ...p, state: "merged" };
    this.k.store.put(C.proposals, { ...next, approvals: [...approvals] });
    this.k.audit(by, opts.force && p.needsTwoApprovals && approvals.size < 2 ? "proposal.force_approved" : "proposal.approved", id);
    return next;
  }

  /** Rejections are kept as negative examples for the improver. */
  reject(id: string, by: string, reason?: string): Proposal {
    const p = this.get(id);
    if (!p) throw new Error(`unknown proposal ${id}`);
    const next: Proposal = { ...p, state: "rejected", rationale: reason ? `${p.rationale} (rejected: ${reason})` : p.rationale };
    this.k.store.put(C.proposals, next);
    this.k.audit(by, "proposal.rejected", id, { reason });
    return next;
  }

  /** After a week, promote a canary whose scores held, or roll it back. */
  evaluateCanaries() {
    const now = this.k.clock.now().getTime();
    const out: { factory: string; action: "promoted" | "rolled_back" | "waiting" }[] = [];
    for (const f of this.k.defs.list()) {
      if (!f.canary) continue;
      if (now - new Date(f.canary.since).getTime() < (this.k.options.canaryDays ?? 7) * 86_400_000) {
        out.push({ factory: f.id, action: "waiting" });
        continue;
      }
      const scores = this.k.scoring.list({ factory: f.id });
      const rate = (sha: string) => {
        const s = scores.filter((x) => x.definitionSha === sha);
        return s.length ? s.filter((x) => x.passed).length / s.length : undefined;
      };
      const cand = rate(f.canary.sha);
      const base = rate(f.appliedSha!);
      if (cand !== undefined && (base === undefined || cand >= base - 0.02)) {
        this.k.defs.promoteCanary(f.id, "canary-evaluator");
        out.push({ factory: f.id, action: "promoted" });
      } else {
        this.k.defs.rollbackCanary(f.id, "canary-evaluator");
        out.push({ factory: f.id, action: "rolled_back" });
      }
    }
    return out;
  }
}
