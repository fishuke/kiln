import type { HarnessType } from "@kiln/schema";
import type { Proc, Sandbox } from "@kiln/sandbox";

export type HarnessEvent =
  | { type: "message"; text: string }
  | { type: "tool_call"; name: string; input?: unknown }
  | { type: "tool_result"; name?: string; output?: string; isError?: boolean }
  | { type: "steer"; text: string }
  | { type: "cost"; usd: number }
  | { type: "error"; text: string };

export type HarnessResult = { outcome: "succeeded" | "failed" | "cancelled"; summary: string; costUsd: number; turns: number };

/** An MCP server for the agent: streamable HTTP (url) or a stdio command. */
export type McpServerConfig = { name: string; url: string; headers?: Record<string, string> } | { name: string; command: string; args?: string[]; env?: Record<string, string> };

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

function guardHook(url: string): string {
  return `#!/usr/bin/env node
// Kiln command guard: Claude Code PreToolUse hook. Exit code 2 blocks the tool call.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const event = JSON.parse(input || "{}");
  const command = event.tool_input?.command;
  if (!command) process.exit(0);
  try {
    const res = await fetch(${JSON.stringify(url)}, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + (process.env.KILN_RUN_TOKEN || "") },
      body: JSON.stringify({ command, cwd: process.cwd() }),
    });
    const { verdict } = await res.json();
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

  protected emit(e: HarnessEvent) {
    this.events.push(e);
  }

  protected abstract handle(line: string): void;

  protected async pump(proc: Proc) {
    this.proc = proc;
    for await (const line of proc.lines) {
      if (line.trim()) this.handle(line);
    }
    const exit = await proc.exit;
    if (exit.code !== 0 && !this.cancelled) {
      this.failed = true;
      this.emit({ type: "error", text: exit.stderr.trim() || `exited with code ${exit.code}` });
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

/** Claude Code in headless stream-json mode; steering writes another user message to stdin. */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly type = "claude-code" as const;

  constructor(private readonly bin = "claude") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    const prefix = opts.cwd ? `${opts.cwd}/` : "";
    await writeSkills(opts, ".claude/skills");
    if (opts.mcpServers?.length) {
      const mcpServers = Object.fromEntries(opts.mcpServers.map((s) => [s.name, "url" in s ? { type: "http", url: s.url, headers: s.headers } : { type: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} }]));
      await opts.sandbox.writeFile(`${prefix}.mcp.json`, JSON.stringify({ mcpServers }, null, 2));
    }
    if (opts.guardUrl) {
      await opts.sandbox.writeFile(`${prefix}.claude/hooks/kiln-guard.mjs`, guardHook(opts.guardUrl));
      await opts.sandbox.writeFile(
        `${prefix}.claude/settings.json`,
        JSON.stringify(
          { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node .claude/hooks/kiln-guard.mjs" }] }] } },
          null,
          2,
        ),
      );
    }
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--append-system-prompt",
      opts.instructions,
      ...(opts.model ? ["--model", opts.model] : []),
    ];
    const session = new ClaudeSession();
    const proc = opts.sandbox.spawn(this.bin, args, { cwd: opts.cwd, env: opts.env });
    session.begin(proc, opts.prompt);
    return session;
  }
}

class ClaudeSession extends CliSession {
  private done = false;

  begin(proc: Proc, prompt: string) {
    this.proc = proc;
    this.write(prompt);
    void this.pump(proc).then(() => this.finish());
  }

  private write(text: string) {
    this.proc?.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }));
  }

  protected handle(line: string) {
    const msg = parseJson(line);
    if (!msg) return;
    if (msg.type === "assistant") {
      this.turns++;
      for (const c of msg.message?.content ?? []) {
        if (c.type === "text") this.emit({ type: "message", text: c.text });
        if (c.type === "tool_use") this.emit({ type: "tool_call", name: c.name, input: c.input });
      }
    } else if (msg.type === "user") {
      for (const c of msg.message?.content ?? []) {
        if (c.type === "tool_result") {
          const output = Array.isArray(c.content) ? c.content.map((x: { text?: string }) => x.text ?? "").join("") : String(c.content ?? "");
          this.emit({ type: "tool_result", output, isError: Boolean(c.is_error) });
        }
      }
    } else if (msg.type === "result") {
      this.costUsd = Number(msg.total_cost_usd ?? 0);
      this.summary = String(msg.result ?? "");
      this.failed = Boolean(msg.is_error) || (msg.subtype !== undefined && msg.subtype !== "success");
      this.done = true;
      this.proc?.closeStdin();
    }
  }

  async steer(text: string) {
    if (this.done) throw new Error("session already finished");
    this.write(text);
    this.emit({ type: "steer", text });
  }
}

/** Codex `exec --json`; steering is delivered by resuming the session after the current turn. */
export class CodexAdapter implements HarnessAdapter {
  readonly type = "codex" as const;

  constructor(private readonly bin = "codex") {}

  async start(opts: StartOptions): Promise<HarnessSession> {
    await writeSkills(opts, ".agents/skills");
    const session = new ResumingSession(opts, (message, resume) => [
      "exec",
      ...(resume ? ["resume", "--last"] : []),
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      ...(opts.model ? ["-m", opts.model] : []),
      message,
    ], this.bin, codexLine);
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
    const session = new ResumingSession(opts, (message, resume) => [
      "run",
      ...(resume ? ["--continue"] : []),
      "--format",
      "json",
      ...(opts.model ? ["-m", opts.model] : []),
      message,
    ], this.bin, openCodeLine);
    session.begin(opts.prompt);
    return session;
  }
}

type LineHandler = (msg: Record<string, any>, s: { emit: (e: HarnessEvent) => void; addCost: (n: number) => void; setSummary: (t: string) => void; fail: () => void; turn: () => void }) => void;

function codexLine(msg: Record<string, any>, s: Parameters<LineHandler>[1]) {
  if (msg.type === "item.completed") {
    const item = msg.item ?? {};
    if (item.type === "agent_message") {
      s.emit({ type: "message", text: item.text });
      s.setSummary(item.text);
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
    s.emit({ type: "error", text: msg.error?.message ?? msg.message ?? "codex failed" });
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

export function adapterFor(type: HarnessType): HarnessAdapter {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "codex":
      return new CodexAdapter();
    case "opencode":
      return new OpenCodeAdapter();
  }
}
