import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";

export type ExecResult = { code: number; stdout: string; stderr: string };

export type SpawnOptions = { cwd?: string; env?: Record<string, string>; stdin?: string };

/** A running process with line-oriented stdout, writable stdin and an exit promise. */
export interface Proc {
  readonly lines: AsyncIterable<string>;
  write(line: string): void;
  closeStdin(): void;
  kill(): void;
  readonly exit: Promise<ExecResult>;
}

/** Runs host commands. Fakes stand in for docker, kubectl and harness CLIs in tests. */
export interface CommandRunner {
  run(cmd: string, args: string[], opts?: SpawnOptions): Promise<ExecResult>;
  spawn(cmd: string, args: string[], opts?: SpawnOptions): Proc;
}

export class NodeCommandRunner implements CommandRunner {
  async run(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<ExecResult> {
    const proc = this.spawn(cmd, args, opts);
    if (opts.stdin === undefined) proc.closeStdin();
    for await (const _ of proc.lines) {
      // drain stdout so the process can exit
    }
    return proc.exit;
  }

  spawn(cmd: string, args: string[], opts: SpawnOptions = {}): Proc {
    const child = nodeSpawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    const rl = createInterface({ input: child.stdout });
    const lines = (async function* () {
      for await (const line of rl) {
        stdout += `${line}\n`;
        yield line;
      }
    })();
    const exit = new Promise<ExecResult>((resolve) => {
      child.on("error", (err) => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }
    return {
      lines,
      write: (line) => child.stdin.write(`${line}\n`),
      closeStdin: () => child.stdin.end(),
      kill: () => child.kill("SIGTERM"),
      exit,
    };
  }
}

/** Records every call and answers from a handler. */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: { cmd: string; args: string[]; opts?: SpawnOptions }[] = [];

  constructor(
    private readonly handler: (cmd: string, args: string[], opts?: SpawnOptions) => ExecResult | string[] = () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }),
  ) {}

  async run(cmd: string, args: string[], opts?: SpawnOptions): Promise<ExecResult> {
    this.calls.push({ cmd, args, opts });
    const r = this.handler(cmd, args, opts);
    return Array.isArray(r) ? { code: 0, stdout: r.join("\n"), stderr: "" } : r;
  }

  spawn(cmd: string, args: string[], opts?: SpawnOptions): Proc {
    this.calls.push({ cmd, args, opts });
    const r = this.handler(cmd, args, opts);
    const out = Array.isArray(r) ? r : r.stdout.split("\n").filter(Boolean);
    const written: string[] = [];
    return {
      lines: (async function* () {
        yield* out;
      })(),
      write: (l) => written.push(l),
      closeStdin: () => {},
      kill: () => {},
      exit: Promise.resolve(Array.isArray(r) ? { code: 0, stdout: out.join("\n"), stderr: "" } : r),
    };
  }
}
