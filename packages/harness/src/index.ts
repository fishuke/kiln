import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { query, type Options, type SDKMessage, type SDKUserMessage, type SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessType } from "@kiln/schema";
import type { ExecResult, Proc, Sandbox } from "@kiln/sandbox";

export type HarnessEvent =
  | { type: "message"; text: string }
  /** The model's thinking, when the harness exposes it; `durationMs` is how long it thought. */
  | { type: "reasoning"; text: string; durationMs?: number }
  | { type: "tool_call"; name: string; input?: unknown }
  | { type: "tool_result"; name?: string; output?: string; isError?: boolean }
  | { type: "steer"; text: string }
  | { type: "cost"; usd: number }
  /** Subscription usage (a Claude token or a ChatGPT login): share of each window used, 0..1. */
  | { type: "rate_limit"; status: string; fiveHour?: UsageWindow; sevenDay?: UsageWindow; others?: Record<string, UsageWindow> }
  | { type: "error"; text: string };

export type UsageWindow = { utilization: number; resetsAt?: string };

export type HarnessResult = { outcome: "succeeded" | "failed" | "cancelled"; summary: string; costUsd: number; turns: number };

/** An MCP server for the agent: streamable HTTP (url) or a stdio command. */
export type McpServerConfig =
  { name: string; url: string; headers?: Record<string, string> } | { name: string; command: string; args?: string[]; env?: Record<string, string> };

export type StartOptions = {
  sandbox: Sandbox;
  /** Working directory inside the sandbox, usually the repo folder. */
  cwd?: string;
  instructions: string;
  prompt: string;
  model?: string;
  skills?: { name: string; body: string; description?: string }[];
  mcpServers?: McpServerConfig[];
  env?: Record<string, string>;
  /** When set, the harness's own shell tool calls are checked against this URL before running. */
  guardUrl?: string;
};

export interface HarnessSession {
  readonly events: AsyncIterable<HarnessEvent>;
  /** Live steering: deliver a message to the running agent. */
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  readonly result: Promise<HarnessResult>;
}

export interface HarnessAdapter {
  readonly type: HarnessType | "fake";
  start(opts: StartOptions): Promise<HarnessSession>;
}

/** Push-based async iterable used to stream events to any number of late readers. */
export class EventStream<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiters: (() => void)[] = [];
  private closed = false;

  push(item: T) {
    this.items.push(item);
    this.flush();
  }

  close() {
    this.closed = true;
    this.flush();
  }

  private flush() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((fn) => fn());
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let i = 0;
    while (true) {
      if (i < this.items.length) {
        yield this.items[i++]!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

/**
 * Claude Code's timeout for the command-guard hook. When a hook times out, Claude Code runs the
 * command anyway, so Kiln sets it explicitly and answers before it.
 */
export const GUARD_HOOK_TIMEOUT_MS = 10 * 60_000;
/** The hook stops waiting for the guard here and blocks the command (fail closed). */
export const GUARD_HOOK_DEADLINE_MS = GUARD_HOOK_TIMEOUT_MS - 30_000;
/** The longest the guard waits for a person to approve a command; it then answers block, before the hook's deadline. */
export const COMMAND_APPROVAL_MAX_WAIT_MS = GUARD_HOOK_DEADLINE_MS - 30_000;

/** The command-guard hook script; `deadlineMs` is how long it waits for the guard before it blocks. */
export function guardHook(url: string, deadlineMs = GUARD_HOOK_DEADLINE_MS): string {
  return `#!/usr/bin/env node
// Kiln command guard: Claude Code PreToolUse hook. Exit code 2 blocks the tool call.
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const GUARD = new URL(${JSON.stringify(url)});
// Claude Code runs the command when the hook times out: without an answer by then, block it.
const DEADLINE_MS = ${deadlineMs};

// Sandboxes reach the network only through the egress proxy, and Node's fetch ignores HTTPS_PROXY.
function post(body) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body), authorization: "Bearer " + (process.env.KILN_RUN_TOKEN || "") };
  const read = (resolve, reject) => (res) => {
    let text = "";
    res.on("data", (d) => (text += d));
    res.on("end", () => (res.statusCode < 300 ? resolve(JSON.parse(text)) : reject(new Error("guard answered " + res.statusCode))));
  };
  return new Promise((resolve, reject) => {
    if (!proxy) return void fetch(GUARD, { method: "POST", headers, body }).then((r) => r.json()).then(resolve, reject);
    const p = new URL(proxy);
    if (GUARD.protocol === "http:") {
      const req = http.request({ host: p.hostname, port: p.port || 80, method: "POST", path: GUARD.href, headers: { ...headers, host: GUARD.host } }, read(resolve, reject));
      req.on("error", reject);
      return void req.end(body);
    }
    const target = GUARD.hostname + ":" + (GUARD.port || 443);
    const connect = http.request({ host: p.hostname, port: p.port || 80, method: "CONNECT", path: target, headers: { host: target } });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error("proxy answered " + res.statusCode));
      const req = https.request(GUARD, { method: "POST", headers, createConnection: () => tls.connect({ socket, servername: GUARD.hostname }) }, read(resolve, reject));
      req.on("error", reject);
      req.end(body);
    });
    connect.on("error", reject);
    connect.end();
  });
}

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const event = JSON.parse(input || "{}");
  const command = event.tool_input?.command;
  if (!command) process.exit(0);
  setTimeout(() => {
    console.error("No answer from the Kiln guard in time, blocking: " + command);
    process.exit(2);
  }, DEADLINE_MS);
  try {
    const { verdict } = await post(JSON.stringify({ command, cwd: process.cwd() }));
    if (verdict === "allow") process.exit(0);
    console.error(verdict === "block" ? "Blocked by the Kiln guardrail: " + command : "Waiting for a human to approve: " + command);
    process.exit(2);
  } catch (err) {
    console.error("Kiln guard unreachable, blocking: " + command);
    process.exit(2);
  }
});
`;
}

async function writeSkills(opts: StartOptions, dir: string) {
  for (const s of opts.skills ?? []) {
    const fm = `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description ?? s.name)}\n---\n`;
    await opts.sandbox.writeFile(`${opts.cwd ? `${opts.cwd}/` : ""}${dir}/${s.name}/SKILL.md`, `${fm}${s.body}\n`);
  }
}

function parseJson(line: string): Record<string, any> | undefined {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The docker CLI's own noise on stderr, which says nothing about why the agent stopped. */
const DOCKER_CLI_WARNING = /^WARNING: Error loading config file/;

/** Why a process failed: its stderr without docker's noise, then the last lines it printed that were not JSON. */
function failureText(exit: ExecResult, plain: string[]): string {
  const stderr = exit.stderr
    .split("\n")
    .filter((l) => l.trim() && !DOCKER_CLI_WARNING.test(l))
    .join("\n");
  return [stderr, ...plain.slice(-20)].filter(Boolean).join("\n") || `exited with code ${exit.code}`;
}

/** Shared session plumbing: runs one or more processes in sequence and streams normalized events. */
abstract class CliSession implements HarnessSession {
  readonly events = new EventStream<HarnessEvent>();
  readonly result: Promise<HarnessResult>;
  protected costUsd = 0;
  protected turns = 0;
  protected summary = "";
  protected failed = false;
  protected cancelled = false;
  protected proc?: Proc;
  protected readonly queued: string[] = [];
  private resolve!: (r: HarnessResult) => void;

  constructor() {
    this.result = new Promise((r) => (this.resolve = r));
  }

  /** When the last event arrived, to time the model's thinking. */
  protected lastEventAt = Date.now();

  protected emit(e: HarnessEvent) {
    this.lastEventAt = Date.now();
    this.events.push(e);
  }

  protected abstract handle(line: string): void;

  protected async pump(proc: Proc) {
    this.proc = proc;
    // Output that is not the CLI's JSON, such as docker exec's "OCI runtime exec failed" (printed on stdout).
    const plain: string[] = [];
    for await (const line of proc.lines) {
      if (!line.trim()) continue;
      if (!parseJson(line)) plain.push(line.trim());
      this.handle(line);
    }
    const exit = await proc.exit;
    if (exit.code !== 0 && !this.cancelled) {
      this.failed = true;
      const text = failureText(exit, plain);
      this.emit({ type: "error", text });
      if (!this.summary) this.summary = text;
    }
  }

  protected finish() {
    if (this.costUsd) this.emit({ type: "cost", usd: this.costUsd });
    this.events.close();
    this.resolve({
      outcome: this.cancelled ? "cancelled" : this.failed ? "failed" : "succeeded",
      summary: this.summary,
      costUsd: this.costUsd,
      turns: this.turns,
    });
  }

  async stop() {
    this.cancelled = true;
    this.proc?.kill();
  }

  abstract steer(text: string): Promise<void>;
}

/**
 * Claude Code through the Claude Agent SDK. The SDK runs here; the CLI it drives runs inside the
 * sandbox (`spawnClaudeCodeProcess`) with only the run's environment. Steering sends another user message.
 */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly type = "claude-code" as const;

  constructor(private readonly bin = "claude") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    const prefix = opts.cwd ? `${opts.cwd}/` : "";
    await writeSkills(opts, ".claude/skills");
    // Run config lives in .kiln/ (git-excluded): the MCP config carries the run token, so it goes in a file rather
    // than on the command line, and the repository's own .mcp.json and .claude/settings.json are left alone.
    const extraArgs: Record<string, string | null> = {};
    if (opts.mcpServers?.length) {
      const mcpServers = Object.fromEntries(
        opts.mcpServers.map((s) => [
          s.name,
          "url" in s ? { type: "http", url: s.url, headers: s.headers } : { type: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} },
        ]),
      );
      await opts.sandbox.writeFile(`${prefix}.kiln/mcp.json`, JSON.stringify({ mcpServers }, null, 2));
      extraArgs["mcp-config"] = ".kiln/mcp.json";
    }
    let settings: string | undefined;
    if (opts.guardUrl) {
      await opts.sandbox.writeFile(`${prefix}.kiln/kiln-guard.mjs`, guardHook(opts.guardUrl));
      await opts.sandbox.writeFile(
        `${prefix}.kiln/claude-settings.json`,
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node .kiln/kiln-guard.mjs", timeout: GUARD_HOOK_TIMEOUT_MS / 1000 }] }] } }, null, 2),
      );
      settings = ".kiln/claude-settings.json";
    }
    const session = new ClaudeSdkSession(opts.prompt);
    const options: Options = {
      pathToClaudeCodeExecutable: this.bin,
      // Without it the SDK starts from the host's environment; the sandbox gets the run's variables only.
      env: { ...opts.env },
      systemPrompt: { type: "preset", preset: "claude_code", append: opts.instructions },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      abortController: session.abort,
      extraArgs,
      ...(settings ? { settings } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      spawnClaudeCodeProcess: (spawn) => session.attach(opts.sandbox.spawn(spawn.command, spawn.args, { cwd: opts.cwd, env: stringEnv(spawn.env) })),
    };
    session.run(query({ prompt: session.input, options }));
    return session;
  }
}

function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/**
 * A sandbox process as the SDK's SpawnedProcess: line-oriented stdin and stdout become Node streams. Only JSON
 * reaches the SDK; other output (docker exec prints "OCI runtime exec failed" on stdout) is kept for `onExit`.
 */
function spawnedProcess(proc: Proc, onExit: (r: ExecResult, plain: string[]) => void): SpawnedProcess {
  const plain: string[] = [];
  const emitter = new EventEmitter();
  let exitCode: number | null = null;
  let killed = false;
  let partial = "";
  const stdin = new Writable({
    write(chunk, _enc, done) {
      const lines = (partial + String(chunk)).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) if (line) proc.write(line);
      done();
    },
    final(done) {
      if (partial) proc.write(partial);
      partial = "";
      proc.closeStdin();
      done();
    },
  });
  const stdout = Readable.from(
    (async function* () {
      for await (const line of proc.lines) {
        if (!line.trim()) continue;
        if (parseJson(line)) yield `${line}\n`;
        else plain.push(line.trim());
      }
    })(),
  );
  void proc.exit.then((r) => {
    exitCode = r.code;
    onExit(r, plain);
    emitter.emit("exit", r.code, null);
  });
  return {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    kill: () => {
      killed = true;
      proc.kill();
      return true;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => void emitter.on(event, listener),
    once: (event: string, listener: (...args: unknown[]) => void) => void emitter.once(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => void emitter.off(event, listener),
  } as SpawnedProcess;
}

class ClaudeSdkSession implements HarnessSession {
  readonly events = new EventStream<HarnessEvent>();
  readonly result: Promise<HarnessResult>;
  readonly abort = new AbortController();
  /** User messages for the SDK: the prompt, then steering; closed once Claude reports its result. */
  private readonly messages = new EventStream<SDKUserMessage>();
  private resolve!: (r: HarnessResult) => void;
  private costUsd = 0;
  private turns = 0;
  private summary = "";
  private failed = false;
  private cancelled = false;
  private done = false;
  /** The CLI's exit and the non-JSON lines it printed (still filling while its stdout drains). */
  private exit?: { result: ExecResult; plain: string[] };
  /** When the last event arrived, to time the model's thinking. */
  private lastEventAt = Date.now();

  constructor(prompt: string) {
    this.result = new Promise((r) => (this.resolve = r));
    this.push(prompt);
  }

  get input(): AsyncIterable<SDKUserMessage> {
    return this.messages;
  }

  attach(proc: Proc): SpawnedProcess {
    return spawnedProcess(proc, (r, plain) => (this.exit = { result: r, plain }));
  }

  run(messages: AsyncIterable<SDKMessage>) {
    void (async () => {
      let error: string | undefined;
      try {
        for await (const msg of messages) this.handle(msg);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      try {
        // A process that died before Claude reported a result failed, whether or not the SDK noticed.
        const exitFailure = this.exit && this.exit.result.code !== 0 ? failureText(this.exit.result, this.exit.plain) : undefined;
        if ((error !== undefined || (!this.done && exitFailure)) && !this.cancelled) {
          const text = exitFailure ?? error!;
          this.failed = true;
          this.emit({ type: "error", text });
          if (!this.summary) this.summary = text;
        }
      } finally {
        this.messages.close();
        this.finish();
      }
    })();
  }

  private push(text: string) {
    this.messages.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" });
  }

  private emit(e: HarnessEvent) {
    this.lastEventAt = Date.now();
    this.events.push(e);
  }

  private handle(msg: SDKMessage) {
    if (msg.type === "assistant") {
      this.turns++;
      const now = Date.now();
      for (const c of msg.message.content) {
        // Thinking time: from the previous event to this message.
        if (c.type === "thinking" && c.thinking) this.emit({ type: "reasoning", text: c.thinking, durationMs: now - this.lastEventAt });
        if (c.type === "text") this.emit({ type: "message", text: c.text });
        if (c.type === "tool_use") this.emit({ type: "tool_call", name: c.name, input: c.input });
      }
    } else if (msg.type === "user") {
      const content = msg.message.content;
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type === "tool_result") {
          const output = Array.isArray(c.content) ? c.content.map((x) => ("text" in x ? x.text : "")).join("") : String(c.content ?? "");
          this.emit({ type: "tool_result", output, isError: Boolean(c.is_error) });
        }
      }
    } else if (msg.type === "rate_limit_event") {
      this.emit(rateLimitEvent(msg.rate_limit_info as RateLimitInfo));
    } else if (msg.type === "result") {
      this.costUsd = Number(msg.total_cost_usd ?? 0);
      this.summary = msg.subtype === "success" ? msg.result : (msg.errors ?? []).join("; ");
      this.failed = msg.is_error || msg.subtype !== "success";
      this.done = true;
      this.messages.close();
    }
  }

  private finish() {
    if (this.costUsd) this.emit({ type: "cost", usd: this.costUsd });
    this.events.close();
    this.resolve({
      outcome: this.cancelled ? "cancelled" : this.failed ? "failed" : "succeeded",
      summary: this.summary,
      costUsd: this.costUsd,
      turns: this.turns,
    });
  }

  async steer(text: string) {
    if (this.done) throw new Error("session already finished");
    this.push(text);
    this.emit({ type: "steer", text });
  }

  async stop() {
    this.cancelled = true;
    this.abort.abort();
  }
}

type RateLimitInfo = { status?: string; unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }> };

/** Subscription usage from Claude Code's rate_limit_event: the 5-hour and 7-day windows, and any others by name. */
function rateLimitEvent(info: RateLimitInfo): HarnessEvent {
  const window = (w: { utilization?: number; resetsAt?: number } | undefined): UsageWindow | undefined =>
    typeof w?.utilization === "number"
      ? { utilization: w.utilization, ...(w.resetsAt ? { resetsAt: new Date(w.resetsAt * 1000).toISOString() } : {}) }
      : undefined;
  const fiveHour = window(info.unifiedWindows?.five_hour);
  const sevenDay = window(info.unifiedWindows?.seven_day);
  // Other windows Claude Code reports (a model's own weekly limit, for example), by their names.
  const others = Object.fromEntries(
    Object.entries(info.unifiedWindows ?? {})
      .filter(([k]) => k !== "five_hour" && k !== "seven_day")
      .map(([k, w]) => [k, window(w)])
      .filter((e): e is [string, UsageWindow] => Boolean(e[1])),
  );
  return {
    type: "rate_limit",
    status: String(info.status ?? "allowed"),
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    ...(Object.keys(others).length ? { others } : {}),
  };
}

/** Codex `exec --json`; steering is delivered by resuming the session after the current turn. */
export class CodexAdapter implements HarnessAdapter {
  readonly type = "codex" as const;

  constructor(private readonly bin = "codex") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    await writeSkills(opts, ".agents/skills");
    const session = new ResumingSession(
      opts,
      (message, resume) => [
        "exec",
        ...(resume ? ["resume", "--last"] : []),
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        ...(opts.model ? ["-m", opts.model] : []),
        message,
      ],
      this.bin,
      codexLine,
    );
    session.begin(`${opts.instructions}\n\n${opts.prompt}`);
    return session;
  }
}

/** OpenCode `run --format json`; steering continues the same session. */
export class OpenCodeAdapter implements HarnessAdapter {
  readonly type = "opencode" as const;

  constructor(private readonly bin = "opencode") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    await writeSkills(opts, ".opencode/skills");
    await opts.sandbox.writeFile(`${opts.cwd ? `${opts.cwd}/` : ""}AGENTS.md`, `${opts.instructions}\n`);
    const session = new ResumingSession(
      opts,
      (message, resume) => ["run", ...(resume ? ["--continue"] : []), "--format", "json", ...(opts.model ? ["-m", opts.model] : []), message],
      this.bin,
      openCodeLine,
    );
    session.begin(opts.prompt);
    return session;
  }
}

type LineHandler = (
  msg: Record<string, any>,
  s: { emit: (e: HarnessEvent) => void; addCost: (n: number) => void; setSummary: (t: string) => void; fail: () => void; turn: () => void },
) => void;

/**
 * When a ChatGPT plan's usage limit stopped Codex, the time it resets ("… or try again in 2 days 3 hours 5 minutes.");
 * an hour from now when the message gives no duration. Undefined for any other error.
 */
export function codexUsageLimitReset(message: string, now = new Date()): string | undefined {
  if (!/usage limit|usage_limit_reached/i.test(message)) return undefined;
  const span = /try again in ([^.]+)/i.exec(message)?.[1] ?? "";
  const part = (unit: string) => Number(new RegExp(`(\\d+)\\s*${unit}`, "i").exec(span)?.[1] ?? 0);
  const minutes = part("day") * 1440 + part("hour") * 60 + part("min");
  return new Date(now.getTime() + (minutes || 60) * 60_000).toISOString();
}

function codexLine(msg: Record<string, any>, s: Parameters<LineHandler>[1]) {
  if (msg.type === "item.completed") {
    const item = msg.item ?? {};
    if (item.type === "agent_message") {
      s.emit({ type: "message", text: item.text });
      s.setSummary(item.text);
    } else if (item.type === "reasoning" && item.text) {
      s.emit({ type: "reasoning", text: item.text });
    } else if (item.type === "mcp_tool_call") {
      s.emit({ type: "tool_call", name: `${item.server}.${item.tool}`, input: item.arguments });
      if (item.result !== undefined || item.error)
        s.emit({
          type: "tool_result",
          name: `${item.server}.${item.tool}`,
          output: JSON.stringify(item.error ?? item.result).slice(0, 4000),
          isError: Boolean(item.error),
        });
    } else if (item.type === "command_execution") {
      s.emit({ type: "tool_call", name: "shell", input: { command: item.command } });
      s.emit({ type: "tool_result", name: "shell", output: item.aggregated_output, isError: item.exit_code !== 0 });
    } else if (item.type === "file_change") {
      s.emit({ type: "tool_call", name: "apply_patch", input: item.changes });
    }
  } else if (msg.type === "turn.completed") {
    s.turn();
    const u = msg.usage ?? {};
    // Codex reports tokens, not dollars; cost is estimated by the gateway price table upstream.
    s.addCost(((u.input_tokens ?? 0) * 1.25 + (u.output_tokens ?? 0) * 10) / 1_000_000);
  } else if (msg.type === "turn.failed" || msg.type === "error") {
    const text: string = msg.error?.message ?? msg.message ?? "codex failed";
    // A ChatGPT login out of usage: report it like Claude's windows so the pool skips it until the reset.
    const resetsAt = codexUsageLimitReset(text);
    if (resetsAt) s.emit({ type: "rate_limit", status: "rejected", fiveHour: { utilization: 1, resetsAt } });
    s.emit({ type: "error", text });
    s.fail();
  }
}

function openCodeLine(msg: Record<string, any>, s: Parameters<LineHandler>[1]) {
  const part = msg.part ?? {};
  if (msg.type === "text") {
    s.emit({ type: "message", text: part.text });
    s.setSummary(part.text);
  } else if (msg.type === "tool_use") {
    s.emit({ type: "tool_call", name: part.tool, input: part.state?.input });
    if (part.state?.output !== undefined) s.emit({ type: "tool_result", name: part.tool, output: String(part.state.output) });
  } else if (msg.type === "step_finish") {
    s.turn();
    s.addCost(Number(part.cost ?? 0));
  } else if (msg.type === "error") {
    s.emit({ type: "error", text: msg.error?.data?.message ?? msg.error?.message ?? "opencode failed" });
    s.fail();
  }
}

class ResumingSession extends CliSession {
  private running = false;

  constructor(
    private readonly opts: StartOptions,
    private readonly argsFor: (message: string, resume: boolean) => string[],
    private readonly bin: string,
    private readonly onLine: LineHandler,
  ) {
    super();
  }

  begin(first: string) {
    void this.loop(first);
  }

  private async loop(first: string) {
    let message: string | undefined = first;
    let resume = false;
    while (message !== undefined && !this.cancelled && !this.failed) {
      this.running = true;
      await this.pump(this.opts.sandbox.spawn(this.bin, this.argsFor(message, resume), { cwd: this.opts.cwd, env: this.opts.env }));
      this.running = false;
      message = this.queued.shift();
      resume = true;
    }
    this.finish();
  }

  protected handle(line: string) {
    const msg = parseJson(line);
    if (!msg) return;
    this.onLine(msg, {
      emit: (e) => this.emit(e),
      addCost: (n) => (this.costUsd += n),
      setSummary: (t) => (this.summary = t),
      fail: () => (this.failed = true),
      turn: () => this.turns++,
    });
  }

  async steer(text: string) {
    if (!this.running && this.queued.length === 0 && this.turns > 0) throw new Error("session already finished");
    this.queued.push(text);
    this.emit({ type: "steer", text });
  }
}

export type FakeScriptContext = {
  opts: StartOptions;
  emit: (e: HarnessEvent) => void;
  /** Resolves with the next steering message, or undefined if none arrives within `ms`. */
  nextSteer: (ms?: number) => Promise<string | undefined>;
  steering: string[];
  signal: { cancelled: boolean };
};

export type FakeScript = (ctx: FakeScriptContext) => Promise<Partial<HarnessResult> | void>;

/** Scripted harness for tests and offline dev; scripts can touch the sandbox like a real agent. */
export class FakeHarness implements HarnessAdapter {
  readonly type = "fake" as const;
  readonly started: StartOptions[] = [];

  constructor(private readonly script: FakeScript) {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    this.started.push(opts);
    const events = new EventStream<HarnessEvent>();
    const steering: string[] = [];
    const waiters: ((s: string) => void)[] = [];
    const signal = { cancelled: false };
    let finished = false;
    const ctx: FakeScriptContext = {
      opts,
      emit: (e) => events.push(e),
      steering,
      signal,
      nextSteer: (ms = 1000) =>
        new Promise((resolve) => {
          const t = setTimeout(() => resolve(undefined), ms);
          waiters.push((s) => {
            clearTimeout(t);
            resolve(s);
          });
        }),
    };
    const result = (async (): Promise<HarnessResult> => {
      try {
        const r = (await this.script(ctx)) ?? {};
        return { outcome: signal.cancelled ? "cancelled" : "succeeded", summary: "", costUsd: 0, turns: 1, ...r };
      } catch (err) {
        events.push({ type: "error", text: err instanceof Error ? err.message : String(err) });
        return { outcome: "failed", summary: err instanceof Error ? err.message : String(err), costUsd: 0, turns: 1 };
      } finally {
        finished = true;
        events.close();
      }
    })();
    return {
      events,
      result,
      steer: async (text) => {
        if (finished) throw new Error("session already finished");
        steering.push(text);
        events.push({ type: "steer", text });
        waiters.shift()?.(text);
      },
      stop: async () => {
        signal.cancelled = true;
      },
    };
  }
}

/** Streaming JSON events shared by the Gemini CLI and Pi: message, tool_use/tool_result, result/error. */
function streamJsonLine(msg: Record<string, any>, s: Parameters<LineHandler>[1]) {
  const text = typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : undefined;
  if ((msg.type === "message" || msg.type === "assistant") && text && msg.role !== "user") {
    s.emit({ type: "message", text });
    s.setSummary(text);
  } else if (msg.type === "tool_use" || msg.type === "tool_call") {
    s.emit({ type: "tool_call", name: String(msg.tool_name ?? msg.name ?? "tool"), input: msg.parameters ?? msg.args ?? msg.input });
  } else if (msg.type === "tool_result") {
    s.emit({
      type: "tool_result",
      name: msg.tool_name ?? msg.name,
      output: String(msg.output ?? msg.result ?? ""),
      isError: msg.status === "error" || msg.isError === true,
    });
  } else if (msg.type === "result" || msg.type === "turn_end" || msg.type === "agent_end") {
    s.turn();
    const cost = msg.stats?.cost_usd ?? msg.usage?.cost?.total ?? msg.cost;
    if (typeof cost === "number") s.addCost(cost);
    if (msg.status === "error") s.fail();
  } else if (msg.type === "error") {
    s.emit({ type: "error", text: String(msg.message ?? msg.error ?? "harness failed") });
    s.fail();
  }
}

/** Gemini CLI headless mode (`gemini -p … --output-format stream-json`); steering resumes the latest session. */
export class GeminiAdapter implements HarnessAdapter {
  readonly type = "gemini" as const;

  constructor(private readonly bin = "gemini") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    await writeSkills(opts, ".gemini/skills");
    await opts.sandbox.writeFile(`${opts.cwd ? `${opts.cwd}/` : ""}GEMINI.md`, `${opts.instructions}\n`);
    const session = new ResumingSession(
      opts,
      (message, resume) => [
        ...(resume ? ["--resume", "latest"] : []),
        "--output-format",
        "stream-json",
        "--yolo",
        ...(opts.model ? ["-m", opts.model] : []),
        "-p",
        message,
      ],
      this.bin,
      streamJsonLine,
    );
    session.begin(opts.prompt);
    return session;
  }
}

/** Pi coding agent in JSON mode; steering continues the same session. */
export class PiAdapter implements HarnessAdapter {
  readonly type = "pi" as const;

  constructor(private readonly bin = "pi") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    await writeSkills(opts, ".pi/skills");
    await opts.sandbox.writeFile(`${opts.cwd ? `${opts.cwd}/` : ""}AGENTS.md`, `${opts.instructions}\n`);
    const session = new ResumingSession(
      opts,
      (message, resume) => [...(resume ? ["--continue"] : []), "--mode", "json", ...(opts.model ? ["--model", opts.model] : []), "-p", message],
      this.bin,
      streamJsonLine,
    );
    session.begin(opts.prompt);
    return session;
  }
}

export function adapterFor(type: HarnessType): HarnessAdapter {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "codex":
      return new CodexAdapter();
    case "opencode":
      return new OpenCodeAdapter();
    case "gemini":
      return new GeminiAdapter();
    case "pi":
      return new PiAdapter();
  }
}
