import { createHash } from "node:crypto";
import { top, type DecisionProvider } from "@kiln/decide";
import type { ScorerFrontmatter } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { C, newId, type Run, type Score } from "./types";

export type JudgeInput = { scorer: ScorerFrontmatter; rubric: string; run: Run; transcript: string };
export type JudgeOutput = { label: string; confidence: number; rationale?: string; judge: string; costUsd?: number };

export interface Judge {
  readonly name: string;
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

/**
 * Typed-decision judge: each scorer label is one option of a choice question. Cheap enough to
 * score every run; answers below `minConfidence` go to the fallback (LLM) judge.
 */
export class DecisionJudge implements Judge {
  readonly name = "decision";

  constructor(
    private readonly provider: DecisionProvider,
    private readonly fallback?: Judge,
    private readonly minConfidence = 0.7,
  ) {}

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const answers = await this.provider.ask({
      decision: `scorer:${input.scorer.name}`,
      state: { rubric: input.rubric, summary: input.run.summary ?? "", result: input.run.result ?? {}, transcript: input.transcript.slice(-6000), agent: input.run.agent },
      questions: { label: { type: "choice", options: input.scorer.labels.map((l) => l.value) } },
      timeoutMs: 2000,
    });
    const best = top(answers.label);
    if ((!best || best.p < this.minConfidence) && this.fallback) return this.fallback.judge(input);
    return { label: best?.option ?? input.scorer.labels[0]!.value, confidence: best?.p ?? 0, judge: `${this.name}:${this.provider.name}` };
  }
}

/** Rule-based judge for tests and offline dev. */
export class FakeJudge implements Judge {
  readonly name = "fake";

  constructor(private readonly rule: (input: JudgeInput) => string | { label: string; rationale?: string }) {}

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const r = this.rule(input);
    const out = typeof r === "string" ? { label: r } : r;
    return { ...out, confidence: 1, judge: this.name };
  }
}

export function sampled(runId: string, scorer: string, rate: number): boolean {
  if (rate >= 100) return true;
  if (rate <= 0) return false;
  return parseInt(createHash("sha256").update(`${runId}:${scorer}`).digest("hex").slice(0, 8), 16) % 100 < rate;
}

export class ScoringService {
  constructor(private readonly k: Kiln) {}

  list(filter: { factory?: string; agent?: string; runId?: string; scorer?: string } = {}) {
    return this.k.store.list<Score>(
      C.scores,
      (s) => (!filter.factory || s.factory === filter.factory) && (!filter.agent || s.agent === filter.agent) && (!filter.runId || s.runId === filter.runId) && (!filter.scorer || s.scorer === filter.scorer),
    );
  }

  private transcriptOf(runId: string) {
    return this.k.runs
      .events(runId)
      .map((e) => `${e.type}: ${e.text ?? ""}`)
      .join("\n");
  }

  /**
   * Score a finished run with every scorer that covers its agent. Replays and benchmarks are
   * always scored. `scorers` limits it to some scorers (by slug or name) and bypasses sampling;
   * `replace` re-scores (a manual re-score replaces the earlier result).
   */
  async scoreRun(runId: string, opts: { force?: boolean; scorers?: string[]; replace?: boolean; trigger?: "automatic" | "manual"; resolvedSha?: string } = {}): Promise<Score[]> {
    const run = this.k.runs.get(runId);
    if (!run || run.status === "running" || run.status === "queued" || run.status === "claimed") return [];
    let resolved;
    try {
      resolved = this.k.defs.resolved(opts.resolvedSha ?? run.definitionSha);
    } catch {
      return [];
    }
    const out: Score[] = [];
    const base = this.transcriptOf(run.id);
    for (const [name, s] of Object.entries(resolved.parsed.scorers)) {
      const selected = opts.scorers ? opts.scorers.includes(name) || opts.scorers.includes(s.frontmatter.name) : undefined;
      if (selected === false) continue;
      const ref = s.frontmatter.agents.find((a) => (typeof a === "string" ? a : a.name) === run.agent);
      if (!ref && !selected) continue;
      if (s.frontmatter.kind === "benchmark_task_correctness" && !selected) continue;
      const force = selected || opts.force || run.kind === "replay" || run.kind === "benchmark";
      const rate = this.k.options.scoreAllRuns ? 100 : s.frontmatter.samplingRate;
      if (!force && !sampled(run.id, name, rate)) continue;
      const existing = this.list({ runId: run.id, scorer: s.frontmatter.name });
      if (existing.length && !opts.replace) continue;
      for (const old of existing) this.k.store.delete(C.scores, old.id);
      const withDescendants = typeof ref === "object" && ref.includeDescendants;
      const transcript = withDescendants ? [base, ...this.k.runs.descendants(run.id).map((d) => `--- subagent ${d.agent} (${d.id}) ---\n${this.transcriptOf(d.id)}`)].join("\n") : base;
      const started = Date.now();
      const verdict = await this.k.judge.judge({ scorer: s.frontmatter, rubric: s.rubric, run, transcript });
      const label = s.frontmatter.labels.find((l) => l.value === verdict.label);
      if (!label) {
        this.k.audit("scorer", "score.invalid_label", run.id, { scorer: name, label: verdict.label });
        continue;
      }
      const score: Score = {
        id: newId("score"),
        runId: run.id,
        factory: run.factory,
        agent: run.agent,
        scorer: s.frontmatter.name,
        label: label.value,
        score: label.score,
        passed: label.score >= s.frontmatter.passingScore,
        rationale: verdict.rationale,
        judge: verdict.judge,
        definitionSha: run.definitionSha,
        selfImprovement: s.frontmatter.selfImprovement && run.kind === "work",
        reviewed: false,
        trigger: opts.trigger ?? (selected ? "manual" : "automatic"),
        costUsd: verdict.costUsd ?? 0,
        durationMs: Date.now() - started,
        createdAt: this.k.clock.now().toISOString(),
      };
      this.k.store.put(C.scores, score);
      this.k.bus.publish("score.recorded", { runId: run.id, scorer: score.scorer, label: score.label, score: score.score, passed: score.passed });
      out.push(score);
    }
    return out;
  }

  /** Unreviewed failures per agent that feed self-improvement. */
  failures(factory: string, agent?: string): Score[] {
    return this.list({ factory, agent }).filter((s) => s.selfImprovement && !s.passed && !s.reviewed);
  }

  markReviewed(scoreIds: string[]) {
    for (const id of scoreIds) {
      const s = this.k.store.get<Score>(C.scores, id);
      if (s) this.k.store.put(C.scores, { ...s, reviewed: true });
    }
  }
}
