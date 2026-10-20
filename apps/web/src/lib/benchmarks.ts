import YAML from "yaml";
import { slugify, toYaml } from "@/lib/frontmatter";

export type BenchConfig = { name: string; agents?: { agent: string; model?: string; harness?: { type: string; model?: string } }[]; runner?: string };
export type SuiteModel = { slug: string; name: string; description?: string; agent: string; configurations: BenchConfig[]; tasks: string[]; extra: Record<string, unknown> };
export type TaskModel = { slug: string; title: string; prompt: string; successCriteria: string[]; startingRepoRefs: string[]; sourceRunId?: string; tags?: string[]; extra: Record<string, unknown> };

export const REPO_REF = /^(github|gitlab)\.com:[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/;

export function parseSuite(slug: string, text: string): SuiteModel {
  const d = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  const { name, description, agent, configurations, tasks, ...extra } = d;
  return {
    slug,
    name: String(name ?? slug),
    description: description ? String(description) : undefined,
    agent: String(agent ?? ""),
    configurations: Array.isArray(configurations) ? (configurations as BenchConfig[]) : [],
    tasks: Array.isArray(tasks) ? tasks.map(String) : [],
    extra,
  };
}

export function serializeSuite(s: SuiteModel): string {
  return toYaml({ name: s.name, ...(s.description ? { description: s.description } : {}), agent: s.agent, configurations: s.configurations, tasks: s.tasks, ...s.extra });
}

export function parseTask(slug: string, text: string): TaskModel {
  const d = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  const { title, prompt, successCriteria, startingRepoRefs, sourceRunId, tags, ...extra } = d;
  return {
    slug,
    title: String(title ?? slug),
    prompt: String(prompt ?? ""),
    successCriteria: Array.isArray(successCriteria) ? successCriteria.map(String) : [],
    startingRepoRefs: Array.isArray(startingRepoRefs) ? startingRepoRefs.map((r) => (typeof r === "string" ? r : `${String((r as { codeForge?: string }).codeForge ?? "github").toLowerCase()}.com:${(r as { owner: string }).owner}/${(r as { repo: string }).repo}@${(r as { ref: string }).ref}`)) : [],
    sourceRunId: sourceRunId ? String(sourceRunId) : undefined,
    tags: Array.isArray(tags) ? tags.map(String) : undefined,
    extra,
  };
}

export function serializeTask(t: TaskModel): string {
  return toYaml({
    title: t.title,
    prompt: t.prompt,
    successCriteria: t.successCriteria,
    startingRepoRefs: t.startingRepoRefs,
    ...(t.sourceRunId ? { sourceRunId: t.sourceRunId } : {}),
    ...(t.tags?.length ? { tags: t.tags } : {}),
    ...t.extra,
  });
}

export function suitesInTree(tree: Record<string, string>): { suite: SuiteModel; tasks: TaskModel[] }[] {
  const out: { suite: SuiteModel; tasks: TaskModel[] }[] = [];
  for (const [path, text] of Object.entries(tree)) {
    const m = /^benchmarks\/([^/]+)\/suite\.ya?ml$/.exec(path);
    if (!m) continue;
    try {
      const suite = parseSuite(m[1]!, text);
      const tasks = Object.entries(tree).flatMap(([p, t]) => {
        const tm = new RegExp(`^benchmarks/${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/tasks/([^/]+)\\.ya?ml$`).exec(p);
        if (!tm) return [];
        try {
          return [parseTask(tm[1]!, t)];
        } catch {
          return [];
        }
      });
      tasks.sort((a, b) => suite.tasks.indexOf(a.slug) - suite.tasks.indexOf(b.slug));
      out.push({ suite, tasks });
    } catch {
      /* skip unparsable suites */
    }
  }
  return out.sort((a, b) => a.suite.name.localeCompare(b.suite.name));
}

export function uniqueSlug(name: string, taken: string[], fallback = "item"): string {
  const base = slugify(name) || fallback;
  let s = base;
  for (let i = 2; taken.includes(s); i++) s = `${base}-${i}`;
  return s;
}

export type Result = { configuration: string; task: string; runId: string; success: boolean; score: number; costUsd: number; durationMs: number; at: string };
export type ConfigRow = { configuration: string; trials: number; successRate: number; avgScore: number; avgCostUsd: number; totalCostUsd: number; avgDurationMs: number; pareto: boolean };

/** Per-configuration summary with the cost/quality Pareto frontier marked. */
export function summarize(results: Result[]): ConfigRow[] {
  const by = new Map<string, Result[]>();
  for (const r of results) by.set(r.configuration, [...(by.get(r.configuration) ?? []), r]);
  const rows = [...by.entries()].map(([configuration, rs]) => ({
    configuration,
    trials: rs.length,
    successRate: rs.filter((r) => r.success).length / rs.length,
    avgScore: rs.reduce((s, r) => s + r.score, 0) / rs.length,
    avgCostUsd: rs.reduce((s, r) => s + r.costUsd, 0) / rs.length,
    totalCostUsd: rs.reduce((s, r) => s + r.costUsd, 0),
    avgDurationMs: rs.reduce((s, r) => s + r.durationMs, 0) / rs.length,
    pareto: false,
  }));
  for (const a of rows) a.pareto = !rows.some((b) => b !== a && b.successRate >= a.successRate && b.avgCostUsd <= a.avgCostUsd && (b.successRate > a.successRate || b.avgCostUsd < a.avgCostUsd));
  return rows.sort((a, b) => b.successRate - a.successRate || a.avgCostUsd - b.avgCostUsd);
}

export type Recommendation = { kind: "overall" | "efficient" | "cheapest"; title: string; configuration: string; detail: string };

/** Overall pick (highest quality, needs two comparable configurations), most efficient (quality per dollar), lowest cost. */
export function recommend(rows: ConfigRow[]): Recommendation[] {
  if (rows.length < 2) return [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const best = [...rows].sort((a, b) => b.successRate - a.successRate || b.avgScore - a.avgScore || a.avgCostUsd - b.avgCostUsd)[0]!;
  const efficient = [...rows].filter((r) => r.successRate > 0).sort((a, b) => b.successRate / Math.max(b.avgCostUsd, 1e-6) - a.successRate / Math.max(a.avgCostUsd, 1e-6))[0];
  const cheapest = [...rows].sort((a, b) => a.avgCostUsd - b.avgCostUsd)[0]!;
  const out: Recommendation[] = [{ kind: "overall", title: "Highest quality", configuration: best.configuration, detail: `${pct(best.successRate)} correct at ${usd(best.avgCostUsd)} per trial` }];
  if (efficient && efficient.configuration !== best.configuration) out.push({ kind: "efficient", title: "Most efficient", configuration: efficient.configuration, detail: `${pct(efficient.successRate)} correct at ${usd(efficient.avgCostUsd)} per trial` });
  if (cheapest.configuration !== best.configuration && cheapest.configuration !== efficient?.configuration) out.push({ kind: "cheapest", title: "Lowest cost", configuration: cheapest.configuration, detail: `${usd(cheapest.avgCostUsd)} per trial, ${pct(cheapest.successRate)} correct` });
  return out;
}

/** A short plain-language summary of a run. */
export function narrative(rows: ConfigRow[], tasks: number): string {
  if (!rows.length) return "";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const [top, ...rest] = rows;
  const parts = [`Across ${tasks} task${tasks === 1 ? "" : "s"}, **${top!.configuration}** solved ${pct(top!.successRate)} of trials at $${top!.avgCostUsd.toFixed(2)} each.`];
  const cheaper = rest.find((r) => r.avgCostUsd < top!.avgCostUsd && r.successRate >= top!.successRate - 0.1);
  if (cheaper) parts.push(`**${cheaper.configuration}** came within ten points (${pct(cheaper.successRate)}) for ${Math.round((1 - cheaper.avgCostUsd / Math.max(top!.avgCostUsd, 1e-6)) * 100)}% less.`);
  const dominated = rows.filter((r) => !r.pareto).map((r) => r.configuration);
  if (dominated.length) parts.push(`${dominated.join(", ")} ${dominated.length === 1 ? "is" : "are"} beaten on both cost and quality by another configuration.`);
  return parts.join(" ");
}

/** Configuration › task › repetition grouping for the expandable overall table. */
export function groupResults(results: Result[]): { configuration: string; tasks: { task: string; reps: Result[] }[] }[] {
  const out: { configuration: string; tasks: { task: string; reps: Result[] }[] }[] = [];
  for (const r of results) {
    let c = out.find((x) => x.configuration === r.configuration);
    if (!c) out.push((c = { configuration: r.configuration, tasks: [] }));
    let t = c.tasks.find((x) => x.task === r.task);
    if (!t) c.tasks.push((t = { task: r.task, reps: [] }));
    t.reps.push(r);
  }
  for (const c of out) for (const t of c.tasks) t.reps.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}
