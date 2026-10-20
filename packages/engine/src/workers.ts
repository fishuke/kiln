import { EventStream, type StartOptions } from "@kiln/harness";
import type { HarnessType, Runner } from "@kiln/schema";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { C, type WorkerRecord } from "./types";

/** Everything a self-hosted worker needs to run one agent run without talking to the store. */
export type WorkerJob = {
  runId: string;
  factory: string;
  agent: string;
  agentType: string;
  workerHost: string;
  harness: HarnessType;
  model?: string;
  instructions: string;
  prompt: string;
  skills: { name: string; body: string; description?: string }[];
  runner: Runner;
  /** `url` carries the run's scoped token; `key` is owner/name. */
  repos: { name: string; key: string; url: string }[];
  branch?: string;
  pinned?: Record<string, string>;
  files: Record<string, string>;
  attachments: { name: string; contentType: string; base64: string }[];
  env: Record<string, string>;
  deniedHosts?: string[];
  push: boolean;
  /** The run token: agents use it for the guard and the Kiln MCP server. */
  token: string;
  mcpServers: NonNullable<StartOptions["mcpServers"]>;
  guardUrl?: string;
  idleTimeoutMinutes: number;
};

export type WorkerEvent = { type: "message" | "reasoning" | "tool_call" | "tool_result" | "steer" | "error" | "artifact" | "pushed" | "started" | "log"; text?: string; data?: unknown };

export type WorkerResult = {
  outcome: "succeeded" | "failed" | "cancelled";
  summary: string;
  costUsd: number;
  result?: Record<string, unknown>;
  artifacts: { name: string; contentType: string; base64: string }[];
  pushed: { repo: string; branch: string; sha: string }[];
  startRepos: { name: string; key: string; sha: string; branch?: string }[];
  diffStat?: { additions: number; deletions: number; files: number };
  workspaceSha?: string;
  error?: string;
};

export type WorkerControl = { cancel: string[]; steer: Record<string, string[]> };

/** What the run service holds while a worker executes a run. */
export class RemoteSession {
  readonly events = new EventStream<WorkerEvent>();
  readonly result: Promise<WorkerResult>;
  resolve!: (r: WorkerResult) => void;
  reject!: (e: unknown) => void;
  steering: string[] = [];
  cancelRequested = false;
  instance?: string;
  settled = false;

  constructor(readonly job: WorkerJob, readonly queuedAt: number, readonly onClaimed: (worker: WorkerRecord) => void) {
    this.result = new Promise<WorkerResult>((resolve, reject) => {
      this.resolve = (r) => {
        if (this.settled) return;
        this.settled = true;
        this.events.close();
        resolve(r);
      };
      this.reject = (e) => {
        if (this.settled) return;
        this.settled = true;
        this.events.close();
        reject(e);
      };
    });
  }

  async steer(text: string) {
    this.steering.push(text);
  }

  async stop() {
    this.cancelRequested = true;
  }
}

/**
 * Self-hosted workers connect outbound, long-poll for runs routed to their `workerHost` id and
 * stream events back. Several processes may share one id; each run goes to the process with
 * the most free capacity that asks. Runs wait in the queue while no worker is connected.
 */
export class WorkerRegistry {
  private readonly queue: RemoteSession[] = [];
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly waiters = new Map<string, () => void>();

  constructor(private readonly k: Kiln) {}

  private now() {
    return this.k.clock.now();
  }

  private get staleMs() {
    return this.k.options.workerStaleMs ?? 60_000;
  }

  get(instance: string) {
    return this.k.store.get<WorkerRecord>(C.workers, instance);
  }

  connect(input: { workerId: string; backend: string; version?: string; maxConcurrent: number; owner: string; instance?: string }): WorkerRecord {
    if (/^kiln/i.test(input.workerId)) throw new KilnError("invalid_request", "worker ids starting with kiln are reserved");
    const now = this.now().toISOString();
    const id = input.instance ?? `wkr_${Math.random().toString(36).slice(2, 10)}`;
    const existing = this.get(id);
    const rec: WorkerRecord = {
      id,
      workerId: input.workerId,
      backend: input.backend,
      version: input.version,
      maxConcurrent: input.maxConcurrent,
      active: existing?.active ?? [],
      owner: input.owner,
      connectedAt: existing?.connectedAt ?? now,
      lastHeartbeatAt: now,
      claimed: existing?.claimed ?? 0,
      completed: existing?.completed ?? 0,
    };
    this.k.store.put(C.workers, rec);
    this.k.audit(input.owner, "worker.connected", id, { workerId: input.workerId, backend: input.backend });
    return rec;
  }

  private touch(instance: string): WorkerRecord {
    const w = this.get(instance);
    if (!w) throw new KilnError("resource_not_found", `unknown worker ${instance}; connect first`);
    const next = { ...w, lastHeartbeatAt: this.now().toISOString() };
    this.k.store.put(C.workers, next);
    return next;
  }

  private control(instance: string): WorkerControl {
    const out: WorkerControl = { cancel: [], steer: {} };
    for (const s of this.sessions.values()) {
      if (s.instance !== instance) continue;
      if (s.cancelRequested) out.cancel.push(s.job.runId);
      if (s.steering.length) out.steer[s.job.runId] = s.steering.splice(0);
    }
    return out;
  }

  heartbeat(instance: string): WorkerControl {
    this.touch(instance);
    return this.control(instance);
  }

  disconnect(instance: string) {
    const w = this.get(instance);
    if (!w) return;
    this.k.store.delete(C.workers, instance);
    for (const runId of w.active) this.sessions.get(runId)?.reject(new KilnError("resource_unavailable", `worker ${w.workerId} disconnected while running ${runId}`));
  }

  /** Connected processes: a heartbeat within the last minute. */
  connected(): (WorkerRecord & { stale: boolean })[] {
    const cutoff = this.now().getTime() - this.staleMs;
    return this.k.store
      .list<WorkerRecord>(C.workers)
      .map((w) => ({ ...w, stale: new Date(w.lastHeartbeatAt).getTime() < cutoff }))
      .filter((w) => !w.stale)
      .sort((a, b) => a.workerId.localeCompare(b.workerId) || a.connectedAt.localeCompare(b.connectedAt));
  }

  queued(): { runId: string; workerHost: string; queuedAt: string }[] {
    return this.queue.map((s) => ({ runId: s.job.runId, workerHost: s.job.workerHost, queuedAt: new Date(s.queuedAt).toISOString() }));
  }

  /** Queue a run for a worker id. The session resolves when a worker reports the result. */
  dispatch(job: WorkerJob, onClaimed: (worker: WorkerRecord) => void): RemoteSession {
    const session = new RemoteSession(job, this.now().getTime(), onClaimed);
    this.sessions.set(job.runId, session);
    this.queue.push(session);
    void session.result.finally(() => {
      this.sessions.delete(job.runId);
      const i = this.queue.indexOf(session);
      if (i >= 0) this.queue.splice(i, 1);
    }).catch(() => {});
    this.wake(job.workerHost);
    return session;
  }

  /** Cancel a run that no worker has claimed yet. */
  cancelQueued(runId: string): boolean {
    const s = this.sessions.get(runId);
    if (!s || s.instance) return false;
    s.resolve({ outcome: "cancelled", summary: "cancelled before a worker claimed it", costUsd: 0, artifacts: [], pushed: [], startRepos: [] });
    return true;
  }

  session(runId: string) {
    return this.sessions.get(runId);
  }

  /** Wake the waiting process of this worker id with the most free capacity. */
  private wake(workerHost: string) {
    const candidates = this.connected()
      .filter((w) => w.workerId === workerHost && this.waiters.has(w.id) && (w.maxConcurrent === 0 || w.active.length < w.maxConcurrent))
      .sort((a, b) => a.active.length - b.active.length);
    const pick = candidates[0];
    if (pick) this.waiters.get(pick.id)!();
  }

  private take(instance: string): RemoteSession | undefined {
    const w = this.touch(instance);
    if (w.maxConcurrent > 0 && w.active.length >= w.maxConcurrent) return undefined;
    const idx = this.queue.findIndex((s) => s.job.workerHost === w.workerId && !s.cancelRequested);
    if (idx < 0) return undefined;
    const [s] = this.queue.splice(idx, 1);
    s!.instance = instance;
    const next = { ...w, active: [...w.active, s!.job.runId], claimed: w.claimed + 1 };
    this.k.store.put(C.workers, next);
    s!.onClaimed(next);
    return s;
  }

  /** Long-poll: return a run for this worker, waiting up to `waitMs` for one to arrive. */
  async claim(instance: string, waitMs = 25_000): Promise<{ job?: WorkerJob; control: WorkerControl }> {
    const first = this.take(instance);
    if (first || waitMs <= 0) return { job: first?.job, control: this.control(instance) };
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.waiters.delete(instance);
        resolve();
      }, waitMs);
      this.waiters.set(instance, () => {
        clearTimeout(t);
        this.waiters.delete(instance);
        resolve();
      });
    });
    const s = this.take(instance);
    return { job: s?.job, control: this.control(instance) };
  }

  /** Events streamed from a worker; the reply carries steering and cancellation for that run. */
  events(instance: string, runId: string, events: WorkerEvent[]): WorkerControl {
    const s = this.owned(instance, runId);
    for (const e of events) s.events.push(e);
    return this.control(instance);
  }

  complete(instance: string, runId: string, result: WorkerResult) {
    const s = this.owned(instance, runId);
    const w = this.get(instance);
    if (w) this.k.store.put(C.workers, { ...w, active: w.active.filter((r) => r !== runId), completed: w.completed + 1 });
    s.resolve(result);
    this.wake(s.job.workerHost);
  }

  private owned(instance: string, runId: string): RemoteSession {
    const s = this.sessions.get(runId);
    if (!s || s.instance !== instance) throw new KilnError("resource_not_found", `run ${runId} is not assigned to this worker`);
    this.touch(instance);
    return s;
  }

  /** Timers: drop stale workers (their runs fail and retry) and expire runs nobody claims. */
  tick() {
    const cutoff = this.now().getTime() - this.staleMs * 3;
    for (const w of this.k.store.list<WorkerRecord>(C.workers)) if (new Date(w.lastHeartbeatAt).getTime() < cutoff) this.disconnect(w.id);
    const maxQueue = this.k.options.workerQueueTimeoutMs ?? 30 * 60_000;
    for (const s of [...this.queue]) {
      if (this.now().getTime() - s.queuedAt > maxQueue) s.reject(new KilnError("infrastructure_timeout", `no worker ${s.job.workerHost} claimed the run within ${Math.round(maxQueue / 60_000)} minutes`));
    }
  }

  /** Numbers for /metrics. */
  stats() {
    const connected = this.connected();
    return { connected: connected.length, active: connected.reduce((n, w) => n + w.active.length, 0), queued: this.queue.length, byWorkerId: [...new Set(connected.map((w) => w.workerId))] };
  }
}
