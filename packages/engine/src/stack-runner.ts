import { resolveStackEnv, startOrder, type Stack } from "@kiln/schema";
import type { Proc, Sandbox } from "@kiln/sandbox";

/**
 * Runs a product's stack (ADR-020) in one sandbox, as processes: datastores, seed, install,
 * migrate, then each service in `depends_on` order, each waited on before what depends on it.
 */

export type StackUpInput = {
  stack: Stack;
  /** Where each service's repository is checked out, relative to the sandbox workspace. Datastores default to `.kiln/stack/<service>`. */
  dirs: Record<string, string>;
  /** The preview URL a person (and a browser) uses for a service. */
  publicUrl: (service: string) => string;
  /** The change set's branch: changed services run it, the others their base. */
  branch?: string;
  /** owner/name of the changed repositories. */
  changed?: string[];
  /** Branches are already local (tests); otherwise the branch is fetched from origin. */
  local?: boolean;
  /** Project environment values; the stack's own env wins. */
  env?: Record<string, string>;
};

export type ServiceState = {
  service: string;
  surface?: string;
  repo?: string;
  /** The branch the service runs; unset for a datastore. */
  ref?: string;
  port?: number;
  url?: string;
  status: "starting" | "ready" | "failed" | "skipped";
  reason?: string;
};

export type StackUp = { services: ServiceState[]; healthy: boolean; failed?: { service: string; reason: string; log: string[] } };

export interface StackRunner {
  up(input: StackUpInput): Promise<StackUp>;
  /** A service's last output lines. */
  logs(service: string): string[];
  /** Stop every process it started. The sandbox stays; its owner destroys it. */
  down(): Promise<void>;
}

const LOG_LINES = 200;

type Running = { proc: Proc; log: string[]; exited?: number; pidFile: string };

/** Stops a process and everything it started (a dev server under `yarn`, `pnpm` or `sh` is a tree). */
const KILL_TREE = 'kt() { for c in $(pgrep -P "$1" 2>/dev/null); do kt "$c"; done; kill -TERM "$1" 2>/dev/null; }; [ -f "$F" ] && kt "$(cat "$F")"; rm -f "$F"';

export class SandboxStackRunner implements StackRunner {
  private readonly running = new Map<string, Running>();
  private readonly logLines = new Map<string, string[]>();

  constructor(
    private readonly sandbox: Sandbox,
    private readonly opts: { readyTimeoutMs?: number; pollMs?: number; fetch?: typeof fetch } = {},
  ) {}

  logs(service: string): string[] {
    return [...(this.running.get(service)?.log ?? this.logLines.get(service) ?? [])];
  }

  async down(): Promise<void> {
    const all = [...this.running.values()];
    this.running.clear();
    for (const r of all) await this.stop(r);
  }

  private async stop(r: Running) {
    await this.sandbox.exec(KILL_TREE, { trusted: true, env: { F: r.pidFile } }).catch(() => undefined);
    r.proc.kill();
    await Promise.race([r.proc.exit.catch(() => undefined), new Promise((res) => setTimeout(res, 5_000))]);
  }

  async up(input: StackUpInput): Promise<StackUp> {
    const { stack } = input;
    const order = startOrder(stack);
    const changed = new Set((input.changed ?? []).map((r) => r.toLowerCase()));
    const states: ServiceState[] = order.map((service) => {
      const s = stack.services[service]!;
      return { service, ...(s.surface ? { surface: s.surface } : {}), ...(s.repo ? { repo: s.repo } : {}), ...(s.port ? { port: s.port, url: input.publicUrl(service) } : {}), status: "starting" };
    });
    const state = (service: string) => states.find((x) => x.service === service)!;
    const fail = (service: string, reason: string): StackUp => {
      const st = state(service);
      st.status = "failed";
      st.reason = reason;
      for (const other of states) if (other.status === "starting") other.status = "skipped";
      return { services: states, healthy: false, failed: { service, reason, log: this.logs(service) } };
    };

    for (const service of order) {
      const s = stack.services[service]!;
      const dir = input.dirs[service] ?? `.kiln/stack/${service}`;
      const st = state(service);
      const sh = async (what: string, command: string, env: Record<string, string> = {}) => {
        const r = await this.sandbox.exec(command, { cwd: dir, trusted: true, env });
        this.record(service, [r.stdout, r.stderr].join("\n"));
        return r.code === 0 ? undefined : `${what} failed (exit ${r.code}): ${lastLine(r.stderr || r.stdout)}`;
      };
      if (!input.dirs[service]) await this.sandbox.exec(`mkdir -p ${dir}`, { trusted: true });

      // 1. The branch for a changed service, its base otherwise.
      if (s.repo) {
        const isChanged = changed.has(s.repo.toLowerCase()) && input.branch;
        const ref = isChanged ? input.branch! : s.base;
        if (ref) {
          const fetchIt = input.local ? "" : `git fetch -q origin ${ref} && `;
          const err = await sh("checkout", `${fetchIt}git checkout -q ${input.local ? ref : `-B ${ref} FETCH_HEAD`}`);
          if (err) return fail(service, err);
        }
        st.ref = ref ?? (await this.sandbox.exec("git branch --show-current", { cwd: dir, trusted: true })).stdout.trim() ?? undefined;
        if (!st.ref) delete st.ref;
      }
      const env = resolveStackEnv(stack, service, Object.fromEntries(states.filter((x) => x.url).map((x) => [x.service, x.url!])), input.env);
      if (s.port) env.PORT ??= String(s.port);

      // 2. Install, once per lockfile.
      if (s.install) {
        const hash = (await this.sandbox.exec("cat pnpm-lock.yaml yarn.lock package-lock.json bun.lockb 2>/dev/null | cksum | cut -d' ' -f1", { cwd: dir, trusted: true })).stdout.trim() || "none";
        const marker = `.kiln-installed-${hash}`;
        if ((await this.sandbox.exec(`test -f ${marker}`, { cwd: dir, trusted: true })).code !== 0) {
          const err = await sh("install", s.install, env);
          if (err) return fail(service, err);
          await this.sandbox.exec(`touch ${marker}`, { cwd: dir, trusted: true });
        }
      }
      // 3. Migrate (its dependencies are already healthy).
      if (s.migrate) {
        const err = await sh("migrate", s.migrate, env);
        if (err) return fail(service, err);
      }
      // 4. Start and wait.
      if (s.start) {
        const before = this.running.get(service);
        if (before) await this.stop(before);
        const pidFile = `${this.sandbox.workdir}/.kiln-stack-${service}.pid`;
        const proc = this.sandbox.spawn("sh", ["-c", `exec 2>&1\necho $$ > ${pidFile}\n${s.start}`], { cwd: dir, env });
        const r: Running = { proc, log: [], pidFile };
        this.running.set(service, r);
        void (async () => {
          for await (const line of proc.lines) push(r.log, line);
        })().catch(() => undefined);
        void proc.exit.then((x) => (r.exited = x.code)).catch(() => (r.exited = -1));
        const err = await this.ready(service, s.port, s.health, dir, r);
        if (err) return fail(service, err);
      }
      // 5. Seed a datastore once it answers.
      if (s.seed) {
        const cmd = typeof s.seed === "string" ? s.seed : (s.seed.restore ?? "");
        const err = cmd ? await sh("seed", cmd, { ...env, ...(typeof s.seed === "object" ? { KILN_SEED: s.seed.from } : {}) }) : undefined;
        if (err) return fail(service, err);
      }
      st.status = "ready";
    }
    return { services: states, healthy: true };
  }

  /** Undefined once the service answers its health check (or its port); the reason otherwise. */
  private async ready(service: string, port: number | undefined, health: string | undefined, dir: string, r: Running): Promise<string | undefined> {
    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? 120_000);
    const poll = this.opts.pollMs ?? 100;
    const fetchImpl = this.opts.fetch ?? fetch;
    const address = port && this.sandbox.expose ? await this.sandbox.expose(port) : undefined;
    for (;;) {
      if (r.exited !== undefined) return `${service} exited with code ${r.exited} before it was ready`;
      if (health && !health.startsWith("/")) {
        if ((await this.sandbox.exec(health, { cwd: dir, trusted: true })).code === 0) return undefined;
      } else if (address) {
        try {
          const res = await fetchImpl(`http://${address.host}:${address.port}${health ?? "/"}`, { signal: AbortSignal.timeout(2_000) });
          if (res.status < 400 || !health) return undefined;
        } catch {
          // not listening yet
        }
      } else return undefined;
      if (Date.now() > deadline) return `${service} did not answer ${health ?? `port ${port}`} within ${Math.round((this.opts.readyTimeoutMs ?? 120_000) / 1000)} s`;
      await new Promise((res) => setTimeout(res, poll));
    }
  }

  private record(service: string, text: string) {
    const log = this.logLines.get(service) ?? [];
    for (const line of text.split("\n").filter(Boolean)) push(log, line);
    this.logLines.set(service, log);
  }
}

function push(log: string[], line: string) {
  log.push(line);
  if (log.length > LOG_LINES) log.shift();
}

function lastLine(text: string) {
  return text.trim().split("\n").at(-1) ?? "";
}

/** For tests: every service ready at its URL, unless told to fail one. */
export class FakeStackRunner implements StackRunner {
  readonly calls: StackUpInput[] = [];
  downs = 0;
  constructor(private readonly opts: { fail?: Record<string, string> } = {}) {}

  async up(input: StackUpInput): Promise<StackUp> {
    this.calls.push(input);
    const services: ServiceState[] = startOrder(input.stack).map((service) => {
      const s = input.stack.services[service]!;
      return { service, ...(s.surface ? { surface: s.surface } : {}), ...(s.repo ? { repo: s.repo, ref: input.changed?.includes(s.repo) ? input.branch : s.base } : {}), ...(s.port ? { port: s.port, url: input.publicUrl(service) } : {}), status: "ready" };
    });
    const failing = Object.entries(this.opts.fail ?? {})[0];
    if (!failing) return { services, healthy: true };
    const [service, reason] = failing;
    let after = false;
    for (const s of services) {
      if (s.service === service) {
        s.status = "failed";
        s.reason = reason;
        after = true;
      } else if (after) s.status = "skipped";
    }
    return { services, healthy: false, failed: { service, reason, log: [] } };
  }

  logs(): string[] {
    return [];
  }

  async down() {
    this.downs += 1;
  }
}
