"use server";

import { revalidatePath } from "next/cache";
import { api, safe } from "@/lib/kiln";
import { serializeSuite, serializeTask, suitesInTree, uniqueSlug, type BenchConfig, type SuiteModel, type TaskModel } from "@/lib/benchmarks";
import { failure, write, type ActionResult, type WriteResult } from "@/lib/write-result";

const refresh = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

/** A task to add: written from scratch, or captured from a completed run. */
export type NewTask = { kind: "scratch"; task: Omit<TaskModel, "slug" | "extra"> } | { kind: "run"; runId: string; title?: string; successCriteria?: string[] };

async function taskFiles(suite: string, tasks: NewTask[], taken: string[]): Promise<{ files: { path: string; content: string }[]; slugs: string[] }> {
  const files: { path: string; content: string }[] = [];
  const slugs: string[] = [];
  for (const t of tasks) {
    const title = t.kind === "scratch" ? t.task.title : (t.title ?? t.runId);
    const slug = uniqueSlug(title, [...taken, ...slugs], "task");
    if (t.kind === "scratch") {
      files.push({ path: `benchmarks/${suite}/tasks/${slug}.yaml`, content: serializeTask({ ...t.task, slug, extra: {} }) });
    } else {
      const r = await api.saveBenchmark(t.runId, { suite, slug, title: t.title, successCriteria: t.successCriteria?.length ? t.successCriteria : undefined });
      for (const [path, content] of Object.entries(r.files)) files.push({ path, content });
    }
    slugs.push(slug);
  }
  return { files, slugs };
}

export async function createBenchmark(factory: string, input: { name: string; description?: string; agent: string; tasks: NewTask[] }): Promise<WriteResult & { slug?: string }> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  if (!input.agent) return { ok: false, error: "Choose the agent to evaluate." };
  if (!input.tasks.length) return { ok: false, error: "Add at least one task." };
  try {
    const def = await api.definition(factory);
    const existing = suitesInTree(def.tree);
    if (existing.some((s) => s.suite.name.toLowerCase() === input.name.trim().toLowerCase())) return { ok: false, error: `A benchmark named ${input.name} already exists.` };
    const slug = uniqueSlug(input.name, existing.map((s) => s.suite.slug), "benchmark");
    const { files, slugs } = await taskFiles(slug, input.tasks, []);
    const suite: SuiteModel = { slug, name: input.name.trim(), description: input.description?.trim() || undefined, agent: input.agent, configurations: [{ name: "Baseline" }], tasks: slugs, extra: {} };
    const r = await write(factory, [{ path: `benchmarks/${slug}/suite.yaml`, content: serializeSuite(suite) }, ...files], `Add benchmark ${suite.name}`);
    refresh(factory);
    return { ...r, slug };
  } catch (e) {
    return failure(e);
  }
}

async function loadSuite(factory: string, slug: string) {
  const def = await api.definition(factory);
  const found = suitesInTree(def.tree).find((s) => s.suite.slug === slug);
  if (!found) throw new Error(`Benchmark ${slug} no longer exists`);
  const path = Object.keys(def.tree).find((p) => p === `benchmarks/${slug}/suite.yaml` || p === `benchmarks/${slug}/suite.yml`)!;
  return { ...found, path, tree: def.tree };
}

export async function addTasks(factory: string, slug: string, tasks: NewTask[]): Promise<WriteResult> {
  try {
    const { suite, path } = await loadSuite(factory, slug);
    const { files, slugs } = await taskFiles(slug, tasks, suite.tasks);
    const r = await write(factory, [{ path, content: serializeSuite({ ...suite, tasks: [...suite.tasks, ...slugs] }) }, ...files], `Add ${slugs.length} task(s) to benchmark ${suite.name}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

export async function updateTask(factory: string, slug: string, task: TaskModel): Promise<WriteResult> {
  try {
    const { tree } = await loadSuite(factory, slug);
    const path = Object.keys(tree).find((p) => p === `benchmarks/${slug}/tasks/${task.slug}.yaml` || p === `benchmarks/${slug}/tasks/${task.slug}.yml`) ?? `benchmarks/${slug}/tasks/${task.slug}.yaml`;
    const r = await write(factory, [{ path, content: serializeTask(task) }], `Update benchmark task ${task.slug}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

export async function removeTask(factory: string, slug: string, task: string): Promise<WriteResult> {
  try {
    const { suite, path, tree } = await loadSuite(factory, slug);
    if (suite.tasks.length <= 1) return { ok: false, error: "A benchmark needs at least one task." };
    const files = Object.keys(tree).filter((p) => p === `benchmarks/${slug}/tasks/${task}.yaml` || p === `benchmarks/${slug}/tasks/${task}.yml`);
    const r = await write(factory, [{ path, content: serializeSuite({ ...suite, tasks: suite.tasks.filter((t) => t !== task) }) }, ...files.map((p) => ({ path: p, content: null }))], `Remove task ${task} from benchmark ${suite.name}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

export async function deleteBenchmark(factory: string, slug: string): Promise<WriteResult> {
  try {
    const { tree, suite } = await loadSuite(factory, slug);
    const r = await write(
      factory,
      Object.keys(tree)
        .filter((p) => p.startsWith(`benchmarks/${slug}/`))
        .map((p) => ({ path: p, content: null })),
      `Delete benchmark ${suite.name}`,
    );
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

export type RunSettings = { configurations: BenchConfig[]; scorers: string[]; repetitions: number };

/** Save the configurations (if they changed) and start the benchmark. */
export async function startBenchmark(factory: string, slug: string, settings: RunSettings): Promise<ActionResult<{ trials?: number; pullRequest?: string }>> {
  if (!settings.configurations.length) return { ok: false, error: "Add at least one configuration." };
  if (settings.configurations.length > 6) return { ok: false, error: "Use at most six configurations." };
  try {
    const { suite, path } = await loadSuite(factory, slug);
    if (JSON.stringify(suite.configurations) !== JSON.stringify(settings.configurations)) {
      const w = await write(factory, [{ path, content: serializeSuite({ ...suite, configurations: settings.configurations }) }], `Update configurations of benchmark ${suite.name}`);
      if (!w.ok) return w;
      if (w.pullRequest) return { ok: true, pullRequest: w.pullRequest };
    }
    const r = await api.request<{ results?: unknown[] }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/benchmarks/${encodeURIComponent(slug)}/run`, { scorers: settings.scorers, repetitions: settings.repetitions });
    refresh(factory);
    return { ok: true, trials: r.results?.length };
  } catch (e) {
    return failure(e);
  }
}

export async function suggestRouting(factory: string, slug: string): Promise<ActionResult<{ prUrl?: string; rules: { tag: string; model: string }[] }>> {
  try {
    const r = await api.proposeRouter(factory, slug);
    refresh(factory);
    return { ok: true, prUrl: r.prUrl, rules: r.rules };
  } catch (e) {
    return failure(e);
  }
}

export type RunOption = { id: string; title: string; agent: string; finishedAt?: string; costUsd: number };

/** Completed runs to turn into tasks, newest first, optionally filtered by text. */
export async function searchRuns(factory: string, agent: string | undefined, q: string): Promise<RunOption[]> {
  const runs = await safe(() => api.runs({ factory, agent, limit: 200 }), []);
  const needle = q.trim().toLowerCase();
  return runs
    .filter((r) => r.status === "succeeded" && r.kind === "work")
    .map((r) => ({ id: r.id, title: (r as { title?: string }).title ?? r.startState.prompt.replace(/^#\s*/, "").split("\n")[0]!.slice(0, 100), agent: r.agent, finishedAt: r.finishedAt, costUsd: r.costUsd }))
    .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.id.includes(needle))
    .slice(0, 50);
}
