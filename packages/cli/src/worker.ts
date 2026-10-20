import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { formatPrometheus, startWorkerJob, type JobHandle, type WorkerControl, type WorkerEvent, type WorkerJob } from "@kiln/engine";
import { adapterFor, type HarnessAdapter } from "@kiln/harness";
import { DockerSandboxProvider, KubernetesSandboxProvider, LocalSandboxProvider, type GuardVerdict, type SandboxProvider } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import { KilnApiError, KilnClient } from "@kiln/sdk-ts";
import { parse } from "yaml";
import { z } from "zod";

export const WORKER_VERSION = "0.1.0";

/** Options of `kiln worker`, from flags, a config file and the environment. */
export const WorkerConfig = z.object({
  workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "use letters, digits, dots, dashes and underscores"),
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
  backend: z.enum(["docker", "kubernetes", "direct"]).default("docker"),
  maxConcurrentTasks: z.number().int().min(0).default(0),
  oneShot: z.boolean().default(false),
  /** How long a one-shot worker stays up after its run, in ms. */
  idleOnCompleteMs: z.number().int().min(0).default(45 * 60_000),
  volumes: z.array(z.string().regex(/^[^:]+:[^:]+(:(ro|rw))?$/, "use HOST:CONTAINER[:ro|rw]")).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cleanup: z.boolean().default(true),
  namespace: z.string().default("kiln-sandboxes"),
  workspaceRoot: z.string().optional(),
  imagePullPolicy: z.enum(["Always", "IfNotPresent", "Never"]).default("IfNotPresent"),
  metricsPort: z.number().int().min(0).max(65535).optional(),
  heartbeatMs: z.number().int().min(100).default(10_000),
  claimWaitSeconds: z.number().int().min(0).max(55).default(25),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type WorkerConfig = z.infer<typeof WorkerConfig>;

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
export function parseDuration(s: string): number {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) throw new Error(`bad duration ${s}; use e.g. 30s, 45m or 0s`);
  return Number(m[1]) * UNITS[m[2] ?? "s"]!;
}

/** Config file (YAML or JSON) keys mirror the flags in snake_case. */
export function readConfigFile(path: string): Partial<WorkerConfig> {
  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Record<string, unknown>;
  const backend = raw.backend as string | Record<string, Record<string, unknown>> | undefined;
  const backendName = typeof backend === "string" ? backend : backend ? Object.keys(backend)[0] : undefined;
  const backendCfg = typeof backend === "object" && backendName ? (backend[backendName] ?? {}) : {};
  const env = (backendCfg.environment as { name: string; value?: string }[] | undefined) ?? [];
  const out: Record<string, unknown> = {
    workerId: raw.worker_id,
    apiUrl: raw.api_url,
    backend: backendName,
    maxConcurrentTasks: raw.max_concurrent_tasks,
    oneShot: raw.one_shot,
    idleOnCompleteMs: raw.idle_on_complete === undefined ? undefined : parseDuration(String(raw.idle_on_complete)),
    cleanup: raw.cleanup,
    volumes: backendCfg.volumes,
    namespace: backendCfg.namespace,
    workspaceRoot: backendCfg.workspace_root,
    imagePullPolicy: backendCfg.image_pull_policy,
    env: env.length ? Object.fromEntries(env.map((e) => [e.name, e.value ?? process.env[e.name] ?? ""])) : undefined,
    metricsPort: raw.metrics_port,
    logLevel: raw.log_level,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<WorkerConfig>;
}

export function providerFor(cfg: WorkerConfig): SandboxProvider {
  if (cfg.backend === "kubernetes") return new KubernetesSandboxProvider(undefined, cfg.namespace);
  if (cfg.backend === "docker") return new DockerSandboxProvider(undefined, { volumes: cfg.volumes, pullPolicy: cfg.imagePullPolicy });
  return new LocalSandboxProvider(cfg.workspaceRoot);
}

type Active = { job: WorkerJob; handle: JobHandle; started: number; buffer: WorkerEvent[]; flushing?: Promise<void> };

/**
 * `kiln worker`: connects outbound to the Kiln API, heartbeats, long-polls for runs routed to
 * its worker id, runs them with the local sandbox backend and streams events back. No inbound
 * ports are needed.
 */
export class KilnWorker {
  readonly client: KilnClient;
  instance?: string;
  private readonly active = new Map<string, Active>();
  private stopping = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private server?: Server;
  private readonly stats = { claimed: 0, rejected: 0, reconnects: 0, completed: { succeeded: 0, failed: 0, cancelled: 0 } as Record<string, number>, durations: [] as { result: string; seconds: number }[] };

  constructor(
    readonly cfg: WorkerConfig,
    private readonly deps: { client?: KilnClient; fetch?: typeof fetch; provider?: SandboxProvider; harness?: (type: HarnessType, agentType: string) => HarnessAdapter; log?: (level: string, msg: string) => void } = {},
  ) {
    this.client = deps.client ?? new KilnClient({ baseUrl: cfg.apiUrl, token: cfg.apiKey, fetch: deps.fetch });
  }

  private log(level: "debug" | "info" | "warn" | "error", msg: string) {
    const order = ["debug", "info", "warn", "error"];
    if (order.indexOf(level) < order.indexOf(this.cfg.logLevel)) return;
    (this.deps.log ?? ((l, m) => console.error(`[kiln-worker] ${l} ${m}`)))(level, msg);
  }

  get activeRuns() {
    return [...this.active.keys()];
  }

  private async connect() {
    const rec = await this.client.workerConnect({ workerId: this.cfg.workerId, backend: this.cfg.backend, version: WORKER_VERSION, maxConcurrent: this.cfg.oneShot ? 1 : this.cfg.maxConcurrentTasks, instance: this.instance });
    this.instance = rec.id;
    this.log("info", `connected as ${this.cfg.workerId} (${rec.id}, ${this.cfg.backend} backend)`);
  }

  private apply(control: WorkerControl | undefined) {
    if (!control) return;
    for (const runId of control.cancel) void this.active.get(runId)?.handle.stop();
    for (const [runId, texts] of Object.entries(control.steer)) for (const t of texts) void this.active.get(runId)?.handle.steer(t);
  }

  /** Run until stopped (or, with --one-shot, until the first run finishes and the idle time passes). */
  async start(): Promise<void> {
    await this.connect();
    if (this.cfg.metricsPort !== undefined) this.serveMetrics(this.cfg.metricsPort);
    this.heartbeat = setInterval(() => {
      if (!this.instance) return;
      this.client.workerHeartbeat(this.instance).then((c) => this.apply(c), (err) => this.log("warn", `heartbeat failed: ${err instanceof Error ? err.message : String(err)}`));
    }, this.cfg.heartbeatMs);
    let ran = false;
    try {
      while (!this.stopping) {
        const max = this.cfg.oneShot ? 1 : this.cfg.maxConcurrentTasks;
        if ((max > 0 && this.active.size >= max) || (this.cfg.oneShot && ran)) {
          if (this.cfg.oneShot && ran && this.active.size === 0) break;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        let claim: { job?: WorkerJob; control: WorkerControl };
        try {
          claim = await this.client.workerClaim(this.instance!, this.cfg.claimWaitSeconds);
        } catch (err) {
          if (this.stopping) break;
          this.stats.reconnects += 1;
          this.log("warn", `claim failed: ${err instanceof Error ? err.message : String(err)}; reconnecting`);
          await new Promise((r) => setTimeout(r, err instanceof KilnApiError && err.status === 404 ? 0 : 2000));
          await this.connect().catch(() => undefined);
          continue;
        }
        this.apply(claim.control);
        if (claim.job) {
          ran = true;
          this.run(claim.job);
        }
      }
      if (this.cfg.oneShot && this.cfg.idleOnCompleteMs > 0 && !this.stopping) await new Promise((r) => setTimeout(r, this.cfg.idleOnCompleteMs));
    } finally {
      await this.shutdown();
    }
  }

  private guardFor(job: WorkerJob) {
    const runClient = new KilnClient({ baseUrl: this.cfg.apiUrl, token: job.token, fetch: this.deps.fetch });
    return async (command: string, cwd?: string): Promise<GuardVerdict> => {
      try {
        const r = await runClient.request<{ verdict: GuardVerdict }>("POST", "/api/v1/guard", { command, cwd });
        return r.verdict === "ask_human" ? "block" : r.verdict;
      } catch (err) {
        this.log("warn", `guard unreachable, blocking ${command}: ${err instanceof Error ? err.message : String(err)}`);
        return "block";
      }
    };
  }

  private run(job: WorkerJob) {
    this.stats.claimed += 1;
    this.log("info", `run ${job.runId}: ${job.agent} (${job.harness})`);
    const entry: Active = { job, started: Date.now(), buffer: [], handle: undefined as unknown as JobHandle };
    const flush = async () => {
      if (!entry.buffer.length || !this.instance) return;
      const events = entry.buffer.splice(0);
      try {
        this.apply(await this.client.workerEvents(this.instance, job.runId, events));
      } catch (err) {
        this.log("warn", `could not send events for ${job.runId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const timer = setInterval(() => void (entry.flushing = flush()), 300);
    entry.handle = startWorkerJob(job, {
      provider: this.deps.provider ?? providerFor(this.cfg),
      harness: this.deps.harness ?? ((type) => adapterFor(type)),
      emit: (e) => entry.buffer.push(e),
      guard: this.guardFor(job),
      env: this.cfg.env,
      keepSandbox: !this.cfg.cleanup,
    });
    this.active.set(job.runId, entry);
    void entry.handle.result
      .then(async (result) => {
        clearInterval(timer);
        await entry.flushing;
        await flush();
        this.stats.completed[result.outcome] = (this.stats.completed[result.outcome] ?? 0) + 1;
        this.stats.durations.push({ result: result.outcome, seconds: (Date.now() - entry.started) / 1000 });
        await this.client.workerComplete(this.instance!, job.runId, result);
        this.log("info", `run ${job.runId} ${result.outcome}`);
      })
      .catch((err) => this.log("error", `run ${job.runId} could not be reported: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        clearInterval(timer);
        this.active.delete(job.runId);
      });
  }

  /** Stop claiming; running runs finish first unless `cancel` is set. */
  async stop(opts: { cancel?: boolean } = {}) {
    this.stopping = true;
    if (opts.cancel) for (const a of this.active.values()) await a.handle.stop();
  }

  private async shutdown() {
    clearInterval(this.heartbeat);
    while (this.active.size) await new Promise((r) => setTimeout(r, 50));
    if (this.instance) await this.client.workerDisconnect(this.instance).catch(() => undefined);
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  metrics(): string {
    const sum = (result: string) => this.stats.durations.filter((d) => d.result === result).reduce((s, d) => s + d.seconds, 0);
    const results = ["succeeded", "failed", "cancelled"];
    return formatPrometheus([
      { name: "kiln_worker_info", help: "Worker version, backend and id.", type: "gauge", samples: [{ labels: { version: WORKER_VERSION, backend: this.cfg.backend, worker_id: this.cfg.workerId }, value: 1 }] },
      { name: "kiln_worker_connected", help: "1 when connected to the Kiln API.", type: "gauge", samples: [{ value: this.instance && !this.stopping ? 1 : 0 }] },
      { name: "kiln_worker_tasks_active", help: "Runs executing now.", type: "gauge", samples: [{ value: this.active.size }] },
      { name: "kiln_worker_tasks_max_concurrent", help: "Concurrency limit (0 = unlimited).", type: "gauge", samples: [{ value: this.cfg.oneShot ? 1 : this.cfg.maxConcurrentTasks }] },
      { name: "kiln_worker_tasks_claimed_total", help: "Runs claimed.", type: "counter", samples: [{ value: this.stats.claimed }] },
      { name: "kiln_worker_tasks_completed_total", help: "Runs finished, by result.", type: "counter", samples: results.map((result) => ({ labels: { result }, value: this.stats.completed[result] ?? 0 })) },
      { name: "kiln_worker_task_duration_seconds_sum", help: "Total run time, by result.", type: "counter", samples: results.map((result) => ({ labels: { result }, value: sum(result) })) },
      { name: "kiln_worker_reconnects_total", help: "Reconnects to the API.", type: "counter", samples: [{ value: this.stats.reconnects }] },
    ]);
  }

  private serveMetrics(port: number) {
    this.server = createServer((req, res) => {
      if (req.url === "/metrics") {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(this.metrics());
      } else {
        res.writeHead(404);
        res.end();
      }
    }).listen(port);
    this.log("info", `metrics on :${port}/metrics`);
  }
}
