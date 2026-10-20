import { stringify } from "yaml";
import type { Kiln } from "./kiln";
import { C, newId, type BenchmarkResult } from "./types";

export type ConfigSummary = { configuration: string; tasks: number; successRate: number; avgCostUsd: number; avgDurationMs: number; pareto: boolean };

/** Configurations not beaten on both cost and success by another configuration. */
export function paretoFrontier<T extends { successRate: number; avgCostUsd: number }>(rows: T[]): T[] {
  return rows.filter((a) => !rows.some((b) => b !== a && b.successRate >= a.successRate && b.avgCostUsd <= a.avgCostUsd && (b.successRate > a.successRate || b.avgCostUsd < a.avgCostUsd)));
}

export class BenchmarkService {
  constructor(private readonly k: Kiln) {}

  results(factory: string, suite?: string): BenchmarkResult[] {
    return this.k.store.list<BenchmarkResult>(C.benchmarks, (r) => r.factory === factory && (!suite || r.suite === suite));
  }

  /** Run every task of a suite under every configuration, at the pinned commits. Costly: run on change only. */
  async run(factory: string, suiteName: string, by = "benchmarks"): Promise<{ results: BenchmarkResult[]; summary: ConfigSummary[] }> {
    const binding = this.k.defs.require(factory);
    const resolved = this.k.defs.resolved(binding.appliedSha!);
    const suite = resolved.parsed.benchmarks[suiteName];
    if (!suite) throw new Error(`no benchmark suite ${suiteName} in ${factory}`);
    const results: BenchmarkResult[] = [];
    for (const config of suite.suite.configurations) {
      const override = config.agents?.find((a) => a.agent === suite.suite.agent);
      for (const taskName of suite.suite.tasks) {
        const task = suite.tasks[taskName]!;
        const repos = task.startingRepoRefs.map((ref) => {
          const m = /^(?:github|gitlab)\.com:([^/]+)\/([^@]+)@([0-9a-f]{40})$/.exec(ref)!;
          return { owner: m[1]!, name: m[2]!, sha: m[3]! };
        });
        const started = Date.now();
        const run = await this.k.runs.execute({
          factory,
          sha: binding.appliedSha!,
          agent: suite.suite.agent,
          prompt: `${task.prompt}\n\nSuccess criteria:\n${task.successCriteria.map((c) => `- ${c}`).join("\n")}`,
          kind: "benchmark",
          stage: `bench:${suiteName}`,
          repos: repos.map(({ owner, name }) => ({ owner, name })),
          pinned: Object.fromEntries(repos.map((r) => [r.name, r.sha])),
          overrides: { model: override?.model, harness: override?.harness?.type },
          push: false,
        });
        const verdict = await this.k.judge.judge({
          scorer: { name: `bench:${suiteName}`, agents: [suite.suite.agent], labels: [{ value: "success", score: 1 }, { value: "failure", score: 0 }], passingScore: 1, samplingRate: 100, model: "judge", selfImprovement: false },
          rubric: `The run succeeds only if every criterion holds:\n${task.successCriteria.join("\n")}`,
          run,
          transcript: this.k.runs.events(run.id).map((e) => e.text ?? "").join("\n"),
        });
        const success = run.status === "succeeded" && verdict.label === "success";
        const r: BenchmarkResult = {
          id: newId("bench"),
          factory,
          suite: suiteName,
          configuration: config.name,
          task: taskName,
          runId: run.id,
          success,
          score: success ? 1 : 0,
          costUsd: run.costUsd,
          durationMs: Date.now() - started,
          at: this.k.clock.now().toISOString(),
        };
        this.k.store.put(C.benchmarks, r);
        results.push(r);
      }
    }
    this.k.audit(by, "benchmark.ran", `${factory}/${suiteName}`, { results: results.length });
    return { results, summary: this.summarize(results) };
  }

  summarize(results: BenchmarkResult[]): ConfigSummary[] {
    const by = new Map<string, BenchmarkResult[]>();
    for (const r of results) by.set(r.configuration, [...(by.get(r.configuration) ?? []), r]);
    const rows = [...by.entries()].map(([configuration, rs]) => ({
      configuration,
      tasks: rs.length,
      successRate: rs.filter((r) => r.success).length / rs.length,
      avgCostUsd: rs.reduce((s, r) => s + r.costUsd, 0) / rs.length,
      avgDurationMs: rs.reduce((s, r) => s + r.durationMs, 0) / rs.length,
      pareto: false,
    }));
    const front = new Set(paretoFrontier(rows).map((r) => r.configuration));
    return rows.map((r) => ({ ...r, pareto: front.has(r.configuration) }));
  }

  /** "Save as benchmark task": the prompt, the exact starting commits and the success criteria of a finished run. */
  saveRunAsTask(runId: string, input: { suite: string; slug: string; title?: string; successCriteria?: string[]; tags?: string[] }): Record<string, string> {
    const run = this.k.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    const wi = run.workItemId ? this.k.workflow.get(run.workItemId) : undefined;
    const criteria = input.successCriteria ?? wi?.spec?.criteria ?? [`The change described in the prompt works and its tests pass`];
    const task = {
      title: input.title ?? wi?.title ?? run.startState.prompt.split("\n")[0]!.slice(0, 80),
      prompt: run.startState.prompt,
      successCriteria: criteria,
      startingRepoRefs: run.startState.repos.map((r) => `github.com:${r.url}@${r.sha}`),
      sourceRunId: run.id,
      ...(input.tags?.length ? { tags: input.tags } : {}),
    };
    return { [`benchmarks/${input.suite}/tasks/${input.slug}.yaml`]: stringify(task) };
  }

  /** Suggest routing rules: per task tag, the cheapest configuration that matches the best success rate. */
  suggestRouter(factory: string, suite: string, name = "by-task"): { file: string; content: string; rules: { tag: string; model: string }[] } | undefined {
    const resolved = this.k.defs.current(factory);
    const s = resolved.parsed.benchmarks[suite];
    if (!s) return undefined;
    const results = this.results(factory, suite);
    const modelOf = (config: string) => s.suite.configurations.find((c) => c.name === config)?.agents?.find((a) => a.agent === s.suite.agent)?.model;
    const defaultModel = resolved.agents[s.suite.agent]?.harness.model ?? "default";
    const tags = new Map<string, string[]>();
    for (const [name, t] of Object.entries(s.tasks)) for (const tag of t.tags ?? ["general"]) tags.set(tag, [...(tags.get(tag) ?? []), name]);
    const rules: { tag: string; model: string }[] = [];
    for (const [tag, taskNames] of tags) {
      const rows = this.summarize(results.filter((r) => taskNames.includes(r.task)));
      if (!rows.length) continue;
      const best = Math.max(...rows.map((r) => r.successRate));
      const cheapest = rows.filter((r) => r.successRate >= best).sort((a, b) => a.avgCostUsd - b.avgCostUsd)[0]!;
      const model = modelOf(cheapest.configuration);
      if (model && model !== defaultModel) rules.push({ tag, model });
    }
    if (!rules.length) return undefined;
    const router = { name, type: "prompt", default: defaultModel, routing: rules.map((r) => ({ description: `${r.tag} tasks`, model: r.model })) };
    return { file: `routers/${name}.yaml`, content: stringify(router), rules };
  }

  /** Open the suggested router as a definition PR (config repo) or a proposal (managed factory). */
  async proposeRouter(factory: string, suite: string, by: string) {
    const suggestion = this.suggestRouter(factory, suite);
    if (!suggestion) return undefined;
    const binding = this.k.defs.require(factory);
    const body = [`Routing rules suggested by benchmark suite \`${suite}\`:`, ...suggestion.rules.map((r) => `- ${r.tag} → ${r.model}`), "", "Benchmarks are costly; they run when models or skills change."].join("\n");
    if (binding.definitionRepo) {
      const repo = binding.definitionRepo;
      const branch = `kiln/router-${suite}-${Date.now().toString(36)}`;
      await this.k.commitFiles(repo, branch, { [repo.dir ? `${repo.dir}/${suggestion.file}` : suggestion.file]: suggestion.content }, `Routing rules from ${suite}`);
      const pr = await this.k.forge.openPullRequest({ repo, head: branch, base: repo.ref, title: `Routing rules from benchmark ${suite}`, body, labels: ["kiln:benchmarks"] });
      this.k.audit(by, "router.proposed", factory, { pr: pr.url });
      return { ...suggestion, prUrl: pr.url };
    }
    this.k.audit(by, "router.proposed", factory, suggestion);
    return suggestion;
  }
}
