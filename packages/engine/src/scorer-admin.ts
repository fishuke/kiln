import { scorerAgentNames, type ScorerFrontmatter } from "@kiln/schema";
import { stringify } from "yaml";
import { KilnError } from "./errors";
import { periods, type Period } from "./factory-metrics";
import type { Kiln } from "./kiln";
import { page } from "./run-state";
import { C, type Score } from "./types";

export type ScorerInput = {
  name: string;
  slug?: string;
  description?: string;
  scoringPrompt: string;
  classifications: { value: string; score: number; description?: string }[];
  threshold: number;
  scopeMode: "all_agents" | "selected_agents";
  agents?: (string | { name: string; includeDescendants?: boolean })[];
  samplingRate?: number;
  model: string;
  selfImprovementEnabled?: boolean;
  runner?: string;
  secrets?: string[];
  mcpServers?: string[];
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scorer";

export type DispatchStatus = "dispatched" | "already_in_flight" | "failed_no_transcript" | "failed_run_tree_not_ready" | "failed_run_tree_incomplete" | "failed_run_tree_too_large" | "failed_to_dispatch";

/**
 * Scorers as an API: CRUD writes scorers/<slug>/scorer.md (applied directly for Kiln-managed
 * factories, a pull request for repo-backed ones); results, pass-rate metrics and manual scoring
 * read and write the score store.
 */
export class ScorerAdmin {
  private readonly inFlight = new Set<string>();

  constructor(private readonly k: Kiln) {}

  private scorers(factory: string) {
    return this.k.defs.current(factory).parsed.scorers;
  }

  private version(factory: string, slug: string): number {
    return this.k.store.get<{ id: string; version: number }>(C.scorerMeta, `${factory}/${slug}`)?.version ?? 1;
  }

  view(factory: string, slug: string, s: { frontmatter: ScorerFrontmatter; rubric: string }) {
    const scores = this.k.scoring.list({ factory, scorer: s.frontmatter.name });
    const last = scores.map((x) => x.createdAt).sort().at(-1);
    return {
      slug,
      ...s.frontmatter,
      scorerKind: s.frontmatter.kind,
      agentNames: scorerAgentNames(s.frontmatter.agents),
      scoringPrompt: s.rubric,
      version: this.version(factory, slug),
      resultCount: scores.length,
      ...(last ? { lastScoredAt: last } : {}),
    };
  }

  list(factory: string) {
    return Object.entries(this.scorers(factory)).map(([slug, s]) => this.view(factory, slug, s));
  }

  get(factory: string, slug: string) {
    const s = this.scorers(factory)[slug];
    if (!s) throw new KilnError("resource_not_found", `factory ${factory} has no scorer ${slug}`);
    return this.view(factory, slug, s);
  }

  private file(factory: string, input: ScorerInput): string {
    const agents = input.scopeMode === "all_agents" ? Object.keys(this.k.defs.current(factory).agents) : (input.agents ?? []);
    if (!agents.length) throw new KilnError("invalid_request", "selected_agents needs at least one agent");
    const front = {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      agents: agents.map((a) => (typeof a === "string" ? a : a.includeDescendants ? { name: a.name, includeDescendants: true } : a.name)),
      labels: input.classifications.map((c) => ({ value: c.value, score: c.score, ...(c.description ? { description: c.description } : {}) })),
      passingScore: input.threshold,
      samplingRate: input.samplingRate ?? 100,
      model: input.model,
      selfImprovement: input.selfImprovementEnabled ?? false,
      ...(input.runner ? { runner: input.runner } : {}),
      ...(input.secrets ? { secrets: input.secrets } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    };
    return `---\n${stringify(front).trimEnd()}\n---\n${input.scoringPrompt.trim()}\n`;
  }

  /** Creating a scorer does not score past runs; use dispatch for that. */
  async create(factory: string, input: ScorerInput, by: string) {
    const slug = input.slug ?? slugify(input.name);
    if (this.scorers(factory)[slug]) throw new KilnError("conflict", `scorer ${slug} already exists`);
    const r = await this.k.editor.write(factory, { [`scorers/${slug}/scorer.md`]: this.file(factory, input) }, { message: `Add scorer ${input.name}`, by });
    if (!r.ok) throw new KilnError("invalid_request", r.errors.join("\n"), { errors: r.errors });
    return { slug, result: r, scorer: r.mode === "applied" ? this.get(factory, slug) : undefined };
  }

  /** Each update bumps the scorer's version; runs scored earlier keep the snapshot they used. */
  async update(factory: string, slug: string, patch: Partial<ScorerInput>, by: string) {
    const current = this.get(factory, slug);
    const merged: ScorerInput = {
      name: patch.name ?? current.name,
      slug,
      description: patch.description ?? current.description,
      scoringPrompt: patch.scoringPrompt ?? current.scoringPrompt,
      classifications: patch.classifications ?? current.labels,
      threshold: patch.threshold ?? current.passingScore,
      scopeMode: patch.scopeMode ?? "selected_agents",
      agents: patch.agents ?? (patch.scopeMode === "all_agents" ? undefined : current.agents.map((a) => (typeof a === "string" ? a : { name: a.name, includeDescendants: a.includeDescendants }))),
      samplingRate: patch.samplingRate ?? current.samplingRate,
      model: patch.model ?? current.model,
      selfImprovementEnabled: patch.selfImprovementEnabled ?? current.selfImprovement,
      runner: patch.runner ?? current.runner,
      secrets: patch.secrets ?? current.secrets,
      mcpServers: patch.mcpServers ?? current.mcpServers,
    };
    const r = await this.k.editor.write(factory, { [`scorers/${slug}/scorer.md`]: this.file(factory, merged) }, { message: `Update scorer ${merged.name}`, by });
    if (!r.ok) throw new KilnError("invalid_request", r.errors.join("\n"), { errors: r.errors });
    this.k.store.put(C.scorerMeta, { id: `${factory}/${slug}`, version: this.version(factory, slug) + 1 });
    return { slug, result: r, scorer: r.mode === "applied" ? this.get(factory, slug) : undefined };
  }

  /** Hard delete: the file and every score it recorded. */
  async remove(factory: string, slug: string, by: string) {
    const current = this.get(factory, slug);
    const r = await this.k.editor.write(factory, { [`scorers/${slug}/scorer.md`]: null }, { message: `Remove scorer ${current.name}`, by });
    if (!r.ok) throw new KilnError("invalid_request", r.errors.join("\n"), { errors: r.errors });
    let deleted = 0;
    if (r.mode === "applied") for (const s of this.k.scoring.list({ factory, scorer: current.name })) deleted += this.k.store.delete(C.scores, s.id) ? 1 : 0;
    this.k.store.delete(C.scorerMeta, `${factory}/${slug}`);
    return { slug, result: r, deletedScores: deleted };
  }

  private resultView(s: Score, includeReasons: boolean) {
    return {
      id: s.id,
      runId: s.runId,
      agent: s.agent,
      status: "scored" as const,
      classification: s.label,
      score: s.score,
      outcome: s.passed ? ("pass" as const) : ("fail" as const),
      reasonStatus: s.rationale ? ("available" as const) : ("absent" as const),
      ...(includeReasons && s.rationale ? { reason: s.rationale } : {}),
      judge: s.judge,
      trigger: s.trigger ?? "automatic",
      scoringRunUsage: { costUsd: s.costUsd ?? 0 },
      scoringRunTimeMs: s.durationMs ?? 0,
      definitionSha: s.definitionSha,
      createdAt: s.createdAt,
    };
  }

  results(factory: string, slug: string, opts: { limit?: number; cursor?: string; includeReasons?: boolean; runIds?: string[] }) {
    const s = this.get(factory, slug);
    const rows = this.k.scoring
      .list({ factory, scorer: s.name })
      .filter((x) => !opts.runIds?.length || opts.runIds.includes(x.runId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const inFlight = [...this.inFlight].filter((k) => k.startsWith(`${factory}/${slug}/`)).map((k) => ({ runId: k.split("/")[2]!, status: "in_flight" as const }));
    const { items, pageInfo } = page(rows, Math.min(Math.max(opts.limit ?? 50, 1), 200), opts.cursor);
    return { results: [...(opts.cursor ? [] : inFlight), ...items.map((x) => this.resultView(x, Boolean(opts.includeReasons)))], pageInfo };
  }

  metrics(factory: string, slug: string, input: { start?: string; end?: string; groupByPeriod?: Period; includeCost?: boolean }) {
    const s = this.get(factory, slug);
    const r = this.k.factoryMetrics.range(input);
    const all = this.k.scoring.list({ factory, scorer: s.name });
    const calc = (start: string, end: string) => {
      const xs = all.filter((x) => x.createdAt >= start && x.createdAt < end);
      const pass = xs.filter((x) => x.passed).length;
      return { passCount: pass, failCount: xs.length - pass, passRate: xs.length ? Math.round((pass / xs.length) * 10_000) / 10_000 : null, costUsd: Math.round(xs.reduce((n, x) => n + (x.costUsd ?? 0), 0) * 10_000) / 10_000 };
    };
    const total = calc(r.start, r.end);
    const series = periods(r).map((p, i, ps) => ({ periodStart: p, ...calc(p, ps[i + 1] ?? r.end) }));
    const { costUsd, ...counts } = total;
    return {
      asOf: this.k.clock.now().toISOString(),
      factory,
      scorer: slug,
      startDate: r.start,
      endDate: r.end,
      ...counts,
      ...(series.length ? { series: series.map(({ costUsd: _c, ...rest }) => rest) } : {}),
      ...(input.includeCost ? { totalCostUsd: costUsd, ...(series.length ? { costUsdSeries: series.map((p) => ({ periodStart: p.periodStart, costUsd: p.costUsd })) } : {}) } : {}),
    };
  }

  /** Manual scoring, both directions: runs × scorers. Bypasses sampling and cool-down; re-scoring replaces. */
  async dispatch(factory: string, runIds: string[], slugs: string[], by: string): Promise<{ runId: string; scorer: string; status: DispatchStatus; scoreId?: string }[]> {
    if (!runIds.length || runIds.length > 100 || !slugs.length || slugs.length > 100) throw new KilnError("invalid_request", "pass 1–100 runs and 1–100 scorers");
    const all = this.scorers(factory);
    const out: { runId: string; scorer: string; status: DispatchStatus; scoreId?: string }[] = [];
    for (const runId of runIds) {
      const run = this.k.runs.get(runId);
      for (const slug of slugs) {
        if (!all[slug]) throw new KilnError("resource_not_found", `factory ${factory} has no scorer ${slug}`);
        const key = `${factory}/${slug}/${runId}`;
        if (!run || run.factory !== factory) {
          out.push({ runId, scorer: slug, status: "failed_to_dispatch" });
          continue;
        }
        if (this.inFlight.has(key)) {
          out.push({ runId, scorer: slug, status: "already_in_flight" });
          continue;
        }
        if (["running", "queued", "claimed"].includes(run.status)) {
          out.push({ runId, scorer: slug, status: "failed_run_tree_not_ready" });
          continue;
        }
        if (!this.k.runs.events(runId).length) {
          out.push({ runId, scorer: slug, status: "failed_no_transcript" });
          continue;
        }
        if (this.k.runs.descendants(runId).some((d) => ["running", "queued", "claimed"].includes(d.status))) {
          out.push({ runId, scorer: slug, status: "failed_run_tree_incomplete" });
          continue;
        }
        this.inFlight.add(key);
        try {
          const [score] = await this.k.scoring.scoreRun(runId, { scorers: [slug], replace: true, trigger: "manual", resolvedSha: this.k.defs.require(factory).appliedSha });
          out.push({ runId, scorer: slug, status: score ? "dispatched" : "failed_to_dispatch", ...(score ? { scoreId: score.id } : {}) });
        } finally {
          this.inFlight.delete(key);
        }
      }
    }
    this.k.audit(by, "scorers.dispatched", factory, { runIds, scorers: slugs });
    return out;
  }

  /** Every score recorded for a run, with how it was triggered. */
  runScores(runId: string) {
    return this.k.scoring.list({ runId }).map((s) => ({ ...this.resultView(s, true), scorer: s.scorer, attemptStatus: "scored" as const, triggerSource: s.trigger ?? "automatic" }));
  }
}
