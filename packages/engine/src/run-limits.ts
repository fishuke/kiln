import { KilnError } from "./errors";
import type { Clock } from "./types";

/**
 * A cap on how many local runs go at once. Runs over the cap wait in line (first come, first served);
 * a waiting run can leave the line when it is cancelled. No cap (undefined or 0) lets every run go.
 */
export class RunSlots {
  private readonly holders = new Set<string>();
  private readonly line: { runId: string; go: () => void; drop: (err: Error) => void }[] = [];

  constructor(private readonly max: () => number | undefined) {}

  /** Runs waiting for a slot. */
  get waiting(): number {
    return this.line.length;
  }

  /** Runs holding a slot. */
  get running(): number {
    return this.holders.size;
  }

  /** True when `runId` would have to wait. */
  full(): boolean {
    const max = this.max();
    return Boolean(max && max > 0 && this.holders.size >= max);
  }

  /** Resolves when `runId` holds a slot; rejects when it leaves the line first. */
  acquire(runId: string): Promise<void> {
    if (this.holders.has(runId)) return Promise.resolve();
    if (!this.full() && this.line.length === 0) {
      this.holders.add(runId);
      return Promise.resolve();
    }
    return new Promise((go, drop) => this.line.push({ runId, go: () => go(), drop }));
  }

  /** Gives `runId`'s slot back and lets the next waiting run go. */
  release(runId: string) {
    if (!this.holders.delete(runId)) return;
    this.next();
  }

  /** Takes a waiting run out of the line; false when it was not waiting. */
  leave(runId: string, err: Error): boolean {
    const i = this.line.findIndex((w) => w.runId === runId);
    if (i < 0) return false;
    const [w] = this.line.splice(i, 1);
    w!.drop(err);
    return true;
  }

  private next() {
    while (this.line.length && !this.full()) {
      const w = this.line.shift()!;
      this.holders.add(w.runId);
      w.go();
    }
  }
}

export type RunLimitOptions = {
  /** Stop a run whose agent sent nothing for this long. */
  stallMinutes?: number;
  /** Stop a run that has gone for this long. */
  maxMinutes?: number;
  /** How often the limits are checked (ms). */
  checkEveryMs: number;
  /** How long a stopped agent gets to end on its own before the run gives up on it (ms). */
  graceMs: number;
};

/**
 * One run's time limits and stop. Time comes from the injected clock; a timer only decides how often
 * the limits are compared with it. `stop` asks the agent to stop; when it has not ended after the
 * grace period, `bound` gives up on it so a hung agent or `docker exec` cannot hold the run.
 */
export class RunLimiter {
  /** Why the run was stopped, once it was. */
  stopped?: KilnError;
  private readonly startedAt: number;
  /** Unset until the agent starts: preparing the sandbox counts toward the max duration only. */
  private lastActivity?: number;
  private readonly timer: ReturnType<typeof setInterval>;
  private grace?: ReturnType<typeof setTimeout>;
  private giveUp!: () => void;
  private readonly abandoned = new Promise<void>((r) => (this.giveUp = r));

  constructor(
    private readonly clock: Clock,
    private readonly opts: RunLimitOptions,
    private readonly stopAgent: () => Promise<void> | undefined,
  ) {
    this.startedAt = clock.now().getTime();
    this.timer = setInterval(() => this.check(), opts.checkEveryMs);
    this.timer.unref?.();
  }

  /** The agent started or did something. */
  touch() {
    this.lastActivity = this.clock.now().getTime();
  }

  check() {
    const now = this.clock.now().getTime();
    const { stallMinutes, maxMinutes } = this.opts;
    if (maxMinutes && now - this.startedAt >= maxMinutes * 60_000)
      this.stop(new KilnError("infrastructure_timeout", `the run ran longer than ${maxMinutes} minutes and was stopped`));
    else if (stallMinutes && this.lastActivity !== undefined && now - this.lastActivity >= stallMinutes * 60_000)
      this.stop(new KilnError("infrastructure_timeout", `the agent showed no activity for ${stallMinutes} minutes and was stopped`));
  }

  stop(reason: KilnError) {
    if (this.stopped) return;
    this.stopped = reason;
    clearInterval(this.timer);
    void Promise.resolve(this.stopAgent()).catch(() => {});
    this.grace = setTimeout(this.giveUp, this.opts.graceMs);
    this.grace.unref?.();
  }

  /** `work`'s outcome, unless the run was stopped and the agent did not end within the grace period. */
  bound<T>(work: Promise<T>): Promise<T> {
    return Promise.race([
      work,
      this.abandoned.then(() => {
        throw this.stopped!;
      }),
    ]);
  }

  dispose() {
    clearInterval(this.timer);
    if (this.grace) clearTimeout(this.grace);
  }
}
