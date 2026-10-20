import type { HarnessType } from "@kiln/schema";
import { parse, stringify } from "yaml";
import { paretoFrontier } from "./benchmarks";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { C, newId, type BenchmarkConfiguration, type BenchmarkRun, type BenchmarkTrial, type Run } from "./types";

export type SuiteInput = {
  name: string;
  displayName?: string;
  description?: string;
  agent: string;
  configurations?: { name: string; agents?: { agent: string; model?: string; harness?: { type: string; model?: string } }[]; runner?: string }[];
  tasks?: string[];
};

export type TaskInput = {
  slug?: string;
  title: string;
  prompt: string;
  successCriteria: string[];
  startingRepoRefs: (string | { codeForge?: string; owner: string; repo: string; ref: string })[];
  sourceRunId?: string;
  tags?: string[];
  labels?: string[];
};

export type RunInput = {
  configurations?: BenchmarkConfiguration[];
  repetitions: number;
  scorers?: string[];
  tasks?: string[];
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "task";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);

function refString(r: TaskInput["startingRepoRefs"][number]): string {
  if (typeof r === "string") return r;
  return `${(r.codeForge ?? "github").toLowerCase() === "gitlab" ? "gitlab" : "github"}.com:${r.owner}/${r.repo}@${r.ref}`;
}

/**
 * Benchmarks: suites and tasks are definition files; benchmark runs, trials and results are
 * runtime state. A run freezes its configurations and tasks, runs every task × configuration ×
 * repetition, scores each trial (task correctness plus the selected scorers) and recommends a
 * configuration.
 */
export class BenchmarkAdmin {
  constructor(private readonly k: Kiln) {}

  private parsed(factory: string) {
    return this.k.defs.current(factory).parsed.benchmarks;
  }

  suites(factory: string) {
    return Object.entries(this.parsed(factory)).map(([slug, b]) => ({ slug, ...b.suite, taskDetails: b.tasks, runs: this.runs(factory, slug).length }));
  }

  suite(factory: string, slug: string) {
    const b = this.parsed(factory)[slug];
    if (!b) throw new KilnError("resource_not_found", `factory ${factory} has no benchmark suite ${slug}`);
    return { slug, ...b.suite, taskDetails: b.tasks };
  }

  private suiteFile(input: SuiteInput, current?: { configurations: unknown[]; tasks: string[] }) {
    return stringify({
      name: input.displayName ?? input.name,
      ...(input.description ? { description: input.description } : {}),
      agent: input.agent,
      configurations: input.configurations ?? current?.configurations ?? [{ name: "default" }],
      tasks: input.tasks ?? current?.tasks ?? [],
    });
  }

  private async write(factory: string, changes: Record<string, string | null>, message: string, by: string) {
    const r = await this.k.editor.write(factory, changes, { message, by });
    if (!r.ok) throw new KilnError("invalid_request", r.errors.join("\n"), { errors: r.errors });
    return r;
  }

  /** A suite needs at least one task file to validate; pass `tasks` with the first task, or add tasks first. */
  async createSuite(factory: string, input: SuiteInput & { firstTask?: TaskInput }, by: string) {
    const slug = slugify(input.name);
    if (this.parsed(factory)[slug]) throw new KilnError("conflict", `benchmark suite ${slug} already exists`);
    const changes: Record<string, string> = {};
    let tasks = input.tasks ?? [];
    if (input.firstTask) {
      const t = this.taskFile(input.firstTask);
      changes[`benchmarks/${slug}/tasks/${t.slug}.yaml`] = t.content;
      tasks = [...new Set([...tasks, t.slug])];
    }
    if (!tasks.length) throw new KilnError("invalid_request", "a suite needs at least one task: pass firstTask");
    changes[`benchmarks/${slug}/suite.yaml`] = this.suiteFile({ ...input, tasks });
    return { slug, result: await this.write(factory, changes, `Add benchmark suite ${input.name}`, by) };
  }

  async updateSuite(factory: string, slug: string, patch: Partial<SuiteInput>, by: string) {
    const cur = this.suite(factory, slug);
    const next: SuiteInput = { name: slug, displayName: patch.displayName ?? cur.name, description: patch.description ?? cur.description, agent: patch.agent ?? cur.agent, configurations: patch.configurations ?? cur.configurations, tasks: patch.tasks ?? cur.tasks };
    return { slug, result: await this.write(factory, { [`benchmarks/${slug}/suite.yaml`]: this.suiteFile(next) }, `Update benchmark suite ${slug}`, by) };
  }

  /** Removes the suite's files; its benchmark runs and results stay for history. */
  async deleteSuite(factory: string, slug: string, by: string) {
    this.suite(factory, slug);
    const tree = this.k.editor.tree(factory);
    const changes = Object.fromEntries(Object.keys(tree).filter((p) => p.startsWith(`benchmarks/${slug}/`)).map((p) => [p, null]));
    return { slug, result: await this.write(factory, changes, `Remove benchmark suite ${slug}`, by) };
  }

  private taskFile(input: TaskInput) {
    const slug = input.slug ?? slugify(input.title);
    const content = stringify({
      title: input.title,
      prompt: input.prompt,
      successCriteria: input.successCriteria,
      startingRepoRefs: input.startingRepoRefs.map(refString),
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.labels?.length ? { labels: input.labels } : {}),
    });
    return { slug, content };
  }

  /** Idempotent on identical content; a different task with the same title is a conflict. */
  async createTask(factory: string, suiteSlug: string, input: TaskInput, by: string) {
    const suite = this.suite(factory, suiteSlug);
    const t = this.taskFile(input);
    const path = `benchmarks/${suiteSlug}/tasks/${t.slug}.yaml`;
    const existing = this.k.editor.file(factory, path);
    if (existing === t.content) return { slug: t.slug, created: false };
    if (existing || Object.entries(suite.taskDetails).some(([s, d]) => s !== t.slug && d.title === input.title)) throw new KilnError("conflict", `a task titled "${input.title}" already exists in ${suiteSlug}`);
    const suitePath = `benchmarks/${suiteSlug}/suite.yaml`;
    const suiteDoc = (parse(this.k.editor.file(factory, suitePath) ?? "") ?? {}) as { tasks?: string[] };
    const nextSuite = stringify({ ...suiteDoc, tasks: [...new Set([...(suiteDoc.tasks ?? []), t.slug])] });
    const result = await this.write(factory, { [path]: t.content, [suitePath]: nextSuite }, `Add benchmark task ${input.title}`, by);
    return { slug: t.slug, created: true, result };
  }

  async updateTask(factory: string, suiteSlug: string, taskSlug: string, patch: Partial<TaskInput>, by: string) {
    const suite = this.suite(factory, suiteSlug);
    const cur = suite.taskDetails[taskSlug];
    if (!cur) throw new KilnError("resource_not_found", `suite ${suiteSlug} has no task ${taskSlug}`);
    const t = this.taskFile({ ...cur, ...patch, slug: taskSlug, startingRepoRefs: patch.startingRepoRefs ?? cur.startingRepoRefs } as TaskInput);
    return { slug: taskSlug, result: await this.write(factory, { [`benchmarks/${suiteSlug}/tasks/${taskSlug}.yaml`]: t.content }, `Update benchmark task ${taskSlug}`, by) };
  }

  async deleteTask(factory: string, suiteSlug: string, taskSlug: string, by: string) {
    const suite = this.suite(factory, suiteSlug);
    if (!suite.taskDetails[taskSlug]) throw new KilnError("resource_not_found", `suite ${suiteSlug} has no task ${taskSlug}`);
    const tasks = suite.tasks.filter((t) => t !== taskSlug);
    if (!tasks.length) throw new KilnError("operation_not_supported", "a suite keeps at least one task; delete the suite instead");
    const suiteDoc = (parse(this.k.editor.file(factory, `benchmarks/${suiteSlug}/suite.yaml`) ?? "") ?? {}) as Record<string, unknown>;
    return { slug: taskSlug, result: await this.write(factory, { [`benchmarks/${suiteSlug}/tasks/${taskSlug}.yaml`]: null, [`benchmarks/${suiteSlug}/suite.yaml`]: stringify({ ...suiteDoc, tasks }) }, `Remove benchmark task ${taskSlug}`, by) };
  }

  /** Turn a finished run into a benchmark task of a suite. */
  async taskFromRun(factory: string, runId: string, input: { suite: string; slug?: string; title?: string; successCriteria?: string[]; tags?: string[] }, by: string) {
    const files = this.k.benchmarks.saveRunAsTask(runId, { suite: input.suite, slug: input.slug ?? `run-${runId.slice(-8)}`, title: input.title, successCriteria: input.successCriteria, tags: input.tags });
    const [path, content] = Object.entries(files)[0]!;
    const doc = parse(content) as TaskInput;
    return this.createTask(factory, input.suite, { ...doc, slug: path.split("/").pop()!.replace(/\.yaml$/, "") }, by);
  }

  // ---- runs ----

  runs(factory: string, suite?: string, states?: BenchmarkRun["state"][]) {
    return this.k.store
      .list<BenchmarkRun>(C.benchmarkRuns, (r) => r.factory === factory && (!suite || r.suite === suite) && (!states?.length || states.includes(r.state)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  run(id: string): BenchmarkRun {
    const r = this.k.store.get<BenchmarkRun>(C.benchmarkRuns, id);
    if (!r) throw new KilnError("resource_not_found", `unknown benchmark run ${id}`);
    return r;
  }

  trials(benchmarkRunId: string, f: { task?: string; configuration?: string; agentRunId?: string } = {}) {
    return this.k.store
      .list<BenchmarkTrial>(C.benchmarkTrials, (t) => t.benchmarkRunId === benchmarkRunId && (!f.task || t.task === f.task) && (!f.configuration || t.configuration === f.configuration) && (!f.agentRunId || t.agentRunId === f.agentRunId))
      .sort((a, b) => a.configuration.localeCompare(b.configuration) || a.task.localeCompare(b.task) || a.repetition - b.repetition);
  }

  trial(id: string) {
    const t = this.k.store.get<BenchmarkTrial>(C.benchmarkTrials, id);
    if (!t) throw new KilnError("resource_not_found", `unknown trial ${id}`);
    return t;
  }

  /** Not idempotent: each call starts a new benchmark run. */
  async start(factory: string, suiteSlug: string, input: RunInput, by: string, opts: { wait?: boolean } = {}): Promise<BenchmarkRun> {
    const suite = this.suite(factory, suiteSlug);
    const resolved = this.k.defs.current(factory);
    const configurations: BenchmarkConfiguration[] =
      input.configurations ?? suite.configurations.map((c) => ({ name: c.name, agents: (c.agents ?? []).map((a) => ({ agent: a.agent, model: a.model ?? a.harness?.model, harness: a.harness?.type })) }));
    if (!configurations.length || configurations.length > 6) throw new KilnError("invalid_request", "use 1 to 6 configurations");
    if (new Set(configurations.map((c) => c.name)).size !== configurations.length) throw new KilnError("invalid_request", "configuration names must be unique");
    const tasks = input.tasks ?? suite.tasks;
    for (const t of tasks) if (!suite.taskDetails[t]) throw new KilnError("resource_not_found", `suite ${suiteSlug} has no task ${t}`);
    if (!tasks.length) throw new KilnError("operation_not_supported", "the suite has no tasks to run");
    if (input.repetitions < 1 || input.repetitions > 10) throw new KilnError("invalid_request", "repetitions must be 1–10");
    for (const s of input.scorers ?? []) if (!resolved.parsed.scorers[s]) throw new KilnError("resource_not_found", `factory ${factory} has no scorer ${s}`);
    const now = this.k.clock.now().toISOString();
    const run: BenchmarkRun = { id: newId("bench_run"), factory, suite: suiteSlug, agent: suite.agent, state: "pending", configurations, tasks, repetitions: input.repetitions, scorers: input.scorers ?? [], creator: by, createdAt: now };
    this.k.store.put(C.benchmarkRuns, run);
    for (const c of configurations)
      for (const task of tasks)
        for (let rep = 1; rep <= input.repetitions; rep++) {
          const trial: BenchmarkTrial = { id: newId("trial"), benchmarkRunId: run.id, factory, configuration: c.name, task, repetition: rep, attempt: 1, state: "pending", scoring: { state: "awaiting_trial", scores: [] }, costUsd: 0, judgeCostUsd: 0, durationMs: 0 };
          this.k.store.put(C.benchmarkTrials, trial);
        }
    this.k.audit(by, "benchmark_run.started", run.id, { factory, suite: suiteSlug, trials: configurations.length * tasks.length * input.repetitions });
    const done = this.execute(run.id).catch((err) => {
      this.k.store.put(C.benchmarkRuns, { ...this.run(run.id), state: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: this.k.clock.now().toISOString() });
    });
    if (opts.wait) await done;
    return this.run(run.id);
  }

  private saveTrial(t: BenchmarkTrial) {
    this.k.store.put(C.benchmarkTrials, t);
  }

  private async execute(id: string) {
    let run: BenchmarkRun = { ...this.run(id), state: "running", startedAt: this.k.clock.now().toISOString() };
    this.k.store.put(C.benchmarkRuns, run);
    const binding = this.k.defs.require(run.factory);
    const resolved = this.k.defs.resolved(binding.appliedSha!);
    const suite = resolved.parsed.benchmarks[run.suite];
    if (!suite) throw new Error(`suite ${run.suite} no longer exists`);
    const agentRuns = new Map<string, Run>();
    for (const trial of this.trials(id)) {
      if (this.run(id).cancelRequested) {
        this.saveTrial({ ...trial, state: "cancelled", scoring: { state: "not_scoreable", scores: [] } });
        continue;
      }
      const task = suite.tasks[trial.task]!;
      const config = run.configurations.find((c) => c.name === trial.configuration)!;
      const override = config.agents.find((a) => a.agent === run.agent);
      const repos = task.startingRepoRefs.map((ref) => {
        const m = /^(?:github|gitlab)\.com:([^/]+)\/([^@]+)@([0-9a-f]{40})$/.exec(ref)!;
        return { owner: m[1]!, name: m[2]!, sha: m[3]! };
      });
      const started = Date.now();
      let t: BenchmarkTrial = { ...trial, state: "running", startedAt: this.k.clock.now().toISOString() };
      this.saveTrial(t);
      const agentRun = await this.k.runs.execute({
        factory: run.factory,
        sha: binding.appliedSha!,
        agent: run.agent,
        prompt: `${task.prompt}\n\nSuccess criteria:\n${task.successCriteria.map((c) => `- ${c}`).join("\n")}`,
        kind: "benchmark",
        stage: `bench:${run.suite}`,
        repos: repos.map(({ owner, name }) => ({ owner, name })),
        pinned: Object.fromEntries(repos.map((r) => [r.name, r.sha])),
        overrides: { model: override?.model, harness: override?.harness as HarnessType | undefined, runner: override?.runner ?? config.runner },
        push: false,
        source: "BENCHMARK_TRIAL",
        title: `${task.title} (${config.name} #${trial.repetition})`,
        creator: run.creator,
        metadata: { benchmarkRun: id, trial: trial.id, configuration: config.name.slice(0, 200) },
        onCreated: (r) => this.saveTrial({ ...t, agentRunId: r.id }),
      });
      agentRuns.set(trial.id, agentRun);
      t = {
        ...t,
        agentRunId: agentRun.id,
        state: agentRun.status === "succeeded" ? "succeeded" : agentRun.status === "cancelled" ? "cancelled" : agentRun.status === "blocked" || agentRun.status === "paused" ? "blocked" : "failed",
        ...(agentRun.status === "failed" || agentRun.status === "error" ? { terminalReason: agentRun.error?.code === "infrastructure_timeout" ? ("timeout" as const) : ("failure" as const) } : {}),
        costUsd: agentRun.costUsd,
        durationMs: Date.now() - started,
        finishedAt: this.k.clock.now().toISOString(),
        scoring: { state: "pending", scores: [] },
      };
      this.saveTrial(t);
    }
    run = { ...this.run(id), state: this.run(id).cancelRequested ? "cancelled" : "scoring" };
    this.k.store.put(C.benchmarkRuns, run);
    if (run.state === "scoring") {
      for (const trial of this.trials(id)) {
        const agentRun = agentRuns.get(trial.id) ?? (trial.agentRunId ? this.k.runs.get(trial.agentRunId) : undefined);
        if (!agentRun || trial.state === "cancelled") {
          this.saveTrial({ ...trial, scoring: { state: "not_scoreable", scores: [] } });
          continue;
        }
        this.saveTrial({ ...trial, scoring: { state: "judging", scores: [] } });
        const scores = await this.scoreTrial(run, suite.tasks[trial.task]!.successCriteria, agentRun);
        this.saveTrial({ ...this.trial(trial.id), scoring: { state: "scored", scores }, judgeCostUsd: scores.reduce((s, x) => s + x.costUsd, 0) });
      }
      // Keep the flat result rows the older benchmark summary reads.
      for (const trial of this.trials(id)) {
        const c = trial.scoring.scores.find((s) => s.scorer === "task-correctness");
        if (!trial.agentRunId) continue;
        this.k.store.put(C.benchmarks, { id: newId("bench"), factory: run.factory, suite: run.suite, configuration: trial.configuration, task: trial.task, runId: trial.agentRunId, success: Boolean(c?.passed), score: c?.score ?? 0, costUsd: trial.costUsd, durationMs: trial.durationMs, at: trial.finishedAt ?? this.k.clock.now().toISOString() });
      }
    }
    this.k.store.put(C.benchmarkRuns, { ...this.run(id), state: this.run(id).cancelRequested ? "cancelled" : "completed", finishedAt: this.k.clock.now().toISOString() });
  }

  /** Task correctness (the factory's correctness scorer, or the built-in one) plus the selected scorers. */
  private async scoreTrial(run: BenchmarkRun, criteria: string[], agentRun: Run) {
    const resolved = this.k.defs.current(run.factory);
    const transcript = this.k.runs.events(agentRun.id).map((e) => `${e.type}: ${e.text ?? ""}`).join("\n");
    const out: BenchmarkTrial["scoring"]["scores"] = [];
    const correctness = Object.entries(resolved.parsed.scorers).find(([, s]) => s.frontmatter.kind === "benchmark_task_correctness");
    const scorer = correctness?.[1].frontmatter ?? { name: "Task Correctness", kind: "benchmark_task_correctness" as const, agents: [run.agent], labels: [{ value: "correct", score: 1 }, { value: "incorrect", score: 0 }], passingScore: 1, samplingRate: 0, model: "judge", selfImprovement: false };
    const rubric = `${correctness?.[1].rubric ?? "The trial is correct only if every criterion holds."}\n\nSuccess criteria:\n${criteria.map((c) => `- ${c}`).join("\n")}`;
    if (agentRun.status === "succeeded") {
      const v = await this.k.judge.judge({ scorer, rubric, run: agentRun, transcript });
      const label = scorer.labels.find((l) => l.value === v.label) ?? scorer.labels.find((l) => /correct|success|meets/.test(l.value) && l.score >= scorer.passingScore) ?? scorer.labels.at(-1)!;
      out.push({ scorer: "task-correctness", label: label.value, score: label.score, passed: label.score >= scorer.passingScore, reason: v.rationale, costUsd: v.costUsd ?? 0 });
    } else {
      const worst = [...scorer.labels].sort((a, b) => a.score - b.score)[0]!;
      out.push({ scorer: "task-correctness", label: worst.value, score: worst.score, passed: false, reason: `the trial ended ${agentRun.status}`, costUsd: 0 });
    }
    for (const slug of run.scorers) {
      const s = resolved.parsed.scorers[slug];
      if (!s || s.frontmatter.kind === "benchmark_task_correctness") continue;
      const v = await this.k.judge.judge({ scorer: s.frontmatter, rubric: s.rubric, run: agentRun, transcript });
      const label = s.frontmatter.labels.find((l) => l.value === v.label) ?? s.frontmatter.labels[0]!;
      out.push({ scorer: slug, label: label.value, score: label.score, passed: label.score >= s.frontmatter.passingScore, reason: v.rationale, costUsd: v.costUsd ?? 0 });
    }
    return out;
  }

  async cancel(id: string, by: string) {
    const run = this.run(id);
    if (["completed", "failed", "cancelled"].includes(run.state)) throw new KilnError("conflict", `benchmark run ${id} is ${run.state}`);
    this.k.store.put(C.benchmarkRuns, { ...run, cancelRequested: true });
    for (const t of this.trials(id)) if (t.state === "running" && t.agentRunId) await this.k.runs.cancel(t.agentRunId, by);
    this.k.audit(by, "benchmark_run.cancelled", id);
    return this.run(id);
  }

  /** Per-configuration metrics, recommendations, Pareto chart data and a short narrative. */
  results(id: string) {
    const run = this.run(id);
    const trials = this.trials(id);
    const scorerNames = ["task-correctness", ...run.scorers];
    const rows = run.configurations.map((c) => {
      const ts = trials.filter((t) => t.configuration === c.name);
      const scored = ts.filter((t) => t.scoring.state === "scored");
      const scorerMeans = Object.fromEntries(scorerNames.map((s) => [s, r4(mean(scored.flatMap((t) => t.scoring.scores.filter((x) => x.scorer === s).map((x) => x.score))))]));
      const vals = Object.values(scorerMeans).filter((x): x is number => x !== null);
      return {
        configuration: c.name,
        trials: ts.length,
        succeeded: ts.filter((t) => t.state === "succeeded").length,
        scored: scored.length,
        correctness: scorerMeans["task-correctness"] ?? null,
        scorers: scorerMeans,
        overall: r4(mean(vals)),
        avgCostUsd: r4(mean(ts.map((t) => t.costUsd))) ?? 0,
        avgJudgeCostUsd: r4(mean(ts.map((t) => t.judgeCostUsd))) ?? 0,
        avgDurationMs: Math.round(mean(ts.map((t) => t.durationMs)) ?? 0),
        tasks: [...new Set(ts.map((t) => t.task))].map((task) => {
          const tt = ts.filter((t) => t.task === task);
          return { task, trials: tt.length, correctness: r4(mean(tt.flatMap((t) => t.scoring.scores.filter((x) => x.scorer === "task-correctness").map((x) => x.score)))), avgCostUsd: r4(mean(tt.map((t) => t.costUsd))) ?? 0 };
        }),
      };
    });
    const comparable = rows.filter((r) => r.overall !== null);
    const front = new Set(paretoFrontier(comparable.map((r) => ({ ...r, successRate: r.overall!, avgCostUsd: r.avgCostUsd }))).map((r) => r.configuration));
    const best = [...comparable].sort((a, b) => b.overall! - a.overall! || a.avgCostUsd - b.avgCostUsd)[0];
    // Most efficient: the most quality per second of run time.
    const efficientPick = [...comparable].sort((a, b) => b.overall! / Math.max(b.avgDurationMs, 1) - a.overall! / Math.max(a.avgDurationMs, 1))[0];
    const cheapest = [...comparable].sort((a, b) => a.avgCostUsd - b.avgCostUsd || b.overall! - a.overall!)[0];
    const recommendation =
      comparable.length >= 2
        ? { highestQuality: best?.configuration, mostEfficient: efficientPick?.configuration, lowestCost: cheapest?.configuration }
        : comparable.length === 1
          ? { highestQuality: comparable[0]!.configuration }
          : {};
    const execution = trials.reduce((s, t) => s + t.costUsd, 0);
    const judging = trials.reduce((s, t) => s + t.judgeCostUsd, 0);
    const done = ["completed", "cancelled", "failed"].includes(run.state);
    const narrative = !done
      ? { availability: "pending" as const }
      : comparable.length
        ? {
            availability: "available" as const,
            text: [
              `${best!.configuration} scored highest overall (${Math.round(best!.overall! * 100)}%) at $${best!.avgCostUsd.toFixed(3)} per trial.`,
              cheapest && cheapest.configuration !== best!.configuration ? `${cheapest.configuration} was cheapest ($${cheapest.avgCostUsd.toFixed(3)} per trial) at ${Math.round(cheapest.overall! * 100)}%.` : "",
              `${trials.filter((t) => t.state === "failed").length} of ${trials.length} trials failed; ${front.size} configuration(s) are on the cost–quality frontier.`,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : { availability: "unavailable" as const };
    return {
      benchmarkRun: run,
      provisional: run.state !== "completed",
      coverage: trials.length ? r4(trials.filter((t) => t.scoring.state === "scored").length / trials.length) : 0,
      spend: { execution: r4(execution), judging: r4(judging), combined: r4(execution + judging) },
      elapsedS: run.startedAt ? Math.round(((run.finishedAt ? new Date(run.finishedAt).getTime() : this.k.clock.now().getTime()) - new Date(run.startedAt).getTime()) / 1000) : 0,
      configurations: rows.map((r) => ({ ...r, pareto: front.has(r.configuration) })),
      recommendation,
      chart: { x: "avgCostUsd", y: "overall", points: comparable.map((r) => ({ configuration: r.configuration, quality: r.overall, cost: r.avgCostUsd, pareto: front.has(r.configuration) })) },
      narrative,
    };
  }
}
