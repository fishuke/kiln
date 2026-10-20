import { z } from "zod";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { listOf, queryObject } from "./util";

const RepoRef = z.union([z.string().regex(/^(github|gitlab)\.com:[^/]+\/[^@]+@[0-9a-f]{40}$/), z.object({ codeForge: z.enum(["GITHUB", "GITLAB", "github", "gitlab"]).optional(), owner: z.string(), repo: z.string(), ref: z.string().regex(/^[0-9a-f]{40}$/) })]);
export const BenchTask = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/).optional(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  startingRepoRefs: z.array(RepoRef).min(1),
  sourceRunId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});
const ConfigAgent = z.object({ agent: z.string(), model: z.string().optional(), harness: z.object({ type: z.string(), model: z.string().optional() }).optional() });
export const Suite = z.object({
  name: z.string().min(1).max(60),
  displayName: z.string().optional(),
  description: z.string().optional(),
  agent: z.string().min(1),
  configurations: z.array(z.object({ name: z.string().min(1), agents: z.array(ConfigAgent).optional(), runner: z.string().optional() })).min(1).max(6).optional(),
  tasks: z.array(z.string()).optional(),
  firstTask: BenchTask.optional(),
});
export const PatchSuite = Suite.omit({ name: true, firstTask: true }).partial();
export const StartBenchmark = z.object({
  configurations: z
    .array(z.object({ name: z.string().min(1), agents: z.array(z.object({ agent: z.string(), harness: z.string().optional(), model: z.string().optional(), runner: z.string().optional(), authSecretName: z.string().optional() })), runner: z.string().optional() }))
    .min(1)
    .max(6)
    .optional(),
  repetitions: z.number().int().min(1).max(10).default(1),
  scorers: z.array(z.string()).optional(),
  tasks: z.array(z.string()).optional(),
});
export const RunToTask = z.object({ suite: z.string(), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/).optional(), title: z.string().optional(), successCriteria: z.array(z.string()).optional(), tags: z.array(z.string()).optional() });

const S = "/api/v1/factories/{id}/benchmark-suites";
export const routes: Route[] = [
  { method: "get", path: S, summary: "Benchmark suites with their tasks", scope: "read", tag: "Benchmarks" },
  { method: "post", path: S, summary: "Create a suite (with its first task)", scope: "definitions:write", body: Suite, tag: "Benchmarks" },
  { method: "get", path: `${S}/{suite}`, summary: "One suite", scope: "read", tag: "Benchmarks" },
  { method: "patch", path: `${S}/{suite}`, summary: "Update a suite (agent, configurations, tasks)", scope: "definitions:write", body: PatchSuite, tag: "Benchmarks" },
  { method: "delete", path: `${S}/{suite}`, summary: "Delete a suite's files (runs and results stay)", scope: "definitions:write", tag: "Benchmarks" },
  { method: "post", path: `${S}/{suite}/tasks`, summary: "Add a task (idempotent on identical content; same title is a conflict)", scope: "definitions:write", body: BenchTask, tag: "Benchmarks" },
  { method: "get", path: `${S}/{suite}/tasks/{task}`, summary: "One task", scope: "read", tag: "Benchmarks" },
  { method: "patch", path: `${S}/{suite}/tasks/{task}`, summary: "Update a task", scope: "definitions:write", body: BenchTask.partial(), tag: "Benchmarks" },
  { method: "delete", path: `${S}/{suite}/tasks/{task}`, summary: "Delete a task", scope: "definitions:write", tag: "Benchmarks" },
  { method: "post", path: `${S}/{suite}/runs`, summary: "Run the suite: configurations (harness/model/router/runner per agent), repetitions, scorers, tasks. Not idempotent", scope: "definitions:write", body: StartBenchmark, tag: "Benchmarks" },
  { method: "get", path: `${S}/{suite}/runs`, summary: "Benchmark runs of a suite (?state=)", scope: "read", tag: "Benchmarks" },
  { method: "get", path: "/api/v1/benchmark-runs/{id}", summary: "A benchmark run", scope: "read", tag: "Benchmarks" },
  { method: "post", path: "/api/v1/benchmark-runs/{id}/cancel", summary: "Cancel while running or scoring", scope: "definitions:write", tag: "Benchmarks" },
  { method: "get", path: "/api/v1/benchmark-runs/{id}/results", summary: "Per-configuration metrics, recommendation, Pareto chart data, spend and narrative", scope: "read", tag: "Benchmarks" },
  { method: "get", path: "/api/v1/benchmark-runs/{id}/trials", summary: "Trials (?task, configuration, agent_run_id)", scope: "read", tag: "Benchmarks" },
  { method: "get", path: "/api/v1/benchmark-trials/{id}", summary: "One trial with its scores", scope: "read", tag: "Benchmarks" },
  { method: "post", path: "/api/v1/runs/{id}/benchmark-task", summary: "Turn a finished run into a benchmark task of a suite", scope: "definitions:write", body: RunToTask, tag: "Benchmarks" },
];

/** Benchmark suites, tasks, runs, trials and results. */
export function register({ app, kiln, need, who }: RouteContext) {
  const base = "/api/v1/factories/:id/benchmark-suites";
  app.get(base, (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json({ suites: kiln.benchmarkAdmin.suites(id) });
  });
  app.post(base, async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarkAdmin.createSuite(id, Suite.parse(await c.req.json()), who(c)), 201);
  });
  app.get(`${base}/:suite`, (c) => {
    const { id, suite } = c.req.param();
    need(c, "read", id);
    return c.json(kiln.benchmarkAdmin.suite(id, suite));
  });
  app.patch(`${base}/:suite`, async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarkAdmin.updateSuite(id, suite, PatchSuite.parse(await c.req.json()), who(c)));
  });
  app.delete(`${base}/:suite`, async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarkAdmin.deleteSuite(id, suite, who(c)));
  });
  app.post(`${base}/:suite/tasks`, async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    const r = await kiln.benchmarkAdmin.createTask(id, suite, BenchTask.parse(await c.req.json()), who(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.get(`${base}/:suite/tasks/:task`, (c) => {
    const { id, suite, task } = c.req.param();
    need(c, "read", id);
    const t = kiln.benchmarkAdmin.suite(id, suite).taskDetails[task];
    if (!t) throw new HttpError(404, `suite ${suite} has no task ${task}`);
    return c.json({ slug: task, ...t });
  });
  app.patch(`${base}/:suite/tasks/:task`, async (c) => {
    const { id, suite, task } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarkAdmin.updateTask(id, suite, task, BenchTask.partial().parse(await c.req.json()), who(c)));
  });
  app.delete(`${base}/:suite/tasks/:task`, async (c) => {
    const { id, suite, task } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarkAdmin.deleteTask(id, suite, task, who(c)));
  });
  app.post(`${base}/:suite/runs`, async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    const body = StartBenchmark.parse(await c.req.json().catch(() => ({})));
    return c.json(await kiln.benchmarkAdmin.start(id, suite, body, who(c), { wait: c.req.query("wait") === "true" }), 201);
  });
  app.get(`${base}/:suite/runs`, (c) => {
    const { id, suite } = c.req.param();
    need(c, "read", id);
    const states = listOf(z.enum(["pending", "running", "scoring", "completed", "failed", "cancelled"])).parse(queryObject(c).state);
    return c.json({ runs: kiln.benchmarkAdmin.runs(id, suite, states) });
  });
  const benchRun = (id: string) => kiln.benchmarkAdmin.run(id);
  app.get("/api/v1/benchmark-runs/:id", (c) => {
    const r = benchRun(c.req.param("id"));
    need(c, "read", r.factory);
    return c.json(r);
  });
  app.post("/api/v1/benchmark-runs/:id/cancel", async (c) => {
    const r = benchRun(c.req.param("id"));
    need(c, "definitions:write", r.factory);
    return c.json(await kiln.benchmarkAdmin.cancel(r.id, who(c)));
  });
  app.get("/api/v1/benchmark-runs/:id/results", (c) => {
    const r = benchRun(c.req.param("id"));
    need(c, "read", r.factory);
    return c.json(kiln.benchmarkAdmin.results(r.id));
  });
  app.get("/api/v1/benchmark-runs/:id/trials", (c) => {
    const r = benchRun(c.req.param("id"));
    need(c, "read", r.factory);
    const trials = kiln.benchmarkAdmin.trials(r.id, { task: c.req.query("task"), configuration: c.req.query("configuration"), agentRunId: c.req.query("agent_run_id") });
    const agentRunId = c.req.query("agent_run_id");
    return c.json({ trials, ...(agentRunId && trials[0] ? { matchedAttemptNumber: trials[0].attempt } : {}) });
  });
  app.get("/api/v1/benchmark-trials/:id", (c) => {
    const t = kiln.benchmarkAdmin.trial(c.req.param("id"));
    need(c, "read", t.factory);
    return c.json({ ...t, ...(t.agentRunId ? { agentRun: kiln.runs.get(t.agentRunId) } : {}) });
  });
  app.post("/api/v1/runs/:id/benchmark-task", async (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "definitions:write", run.factory);
    return c.json(await kiln.benchmarkAdmin.taskFromRun(run.factory, run.id, RunToTask.parse(await c.req.json()), who(c)), 201);
  });
}
