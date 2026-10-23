import type { ExecResult, Proc, Sandbox, SnapshotRef } from "@kiln/sandbox";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  codexUsageLimitReset,
  EventStream,
  FakeHarness,
  COMMAND_APPROVAL_MAX_WAIT_MS,
  GUARD_HOOK_DEADLINE_MS,
  GUARD_HOOK_TIMEOUT_MS,
  guardHook,
  OpenCodeAdapter,
  type HarnessAdapter,
  type HarnessEvent,
} from "./index";

type Emulator = (
  args: string[],
  io: { out: (line: unknown) => void; end: (code?: number) => void; stdin: EventStream<string>; fail: boolean },
) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emulates each CLI's wire format closely enough to exercise the adapters' parsing and steering. */
const emulators: Record<string, Emulator> = {
  claude: async (_args, io) => {
    // The Agent SDK talks to the CLI over stdin/stdout: control requests (initialize first) get control responses.
    const lines = io.stdin[Symbol.asyncIterator]();
    const it = {
      async next(): Promise<IteratorResult<string>> {
        for (;;) {
          const r = await lines.next();
          if (r.done) return r;
          const msg = JSON.parse(r.value);
          if (msg.type !== "control_request") return r;
          const response =
            msg.request.subtype === "initialize"
              ? { commands: [], agents: [], output_style: "default", available_output_styles: [], models: [], account: {} }
              : {};
          io.out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response } });
        }
      },
    };
    const prompt = await it.next();
    if (prompt.done) return io.end(0);
    const first = JSON.parse(prompt.value);
    if (io.fail) {
      io.out({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom", total_cost_usd: 0.01 });
      return io.end(0);
    }
    // The shape Claude Code streams for subscription tokens.
    io.out({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1792530600,
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: { utilization: 0.02, resetsAt: 1792530600 },
          seven_day: { utilization: 0.19, resetsAt: 1792987200 },
          seven_day_fable: { utilization: 0.03, resetsAt: 1792987200 },
        },
      },
    });
    io.out({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: `working on ${first.message.content[0].text}` },
          { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
        ],
      },
    });
    io.out({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "ok" }] }] } });
    const next = await Promise.race([it.next(), sleep(50).then(() => undefined)]);
    if (next && !next.done) {
      const steer = JSON.parse(next.value);
      io.out({ type: "assistant", message: { content: [{ type: "text", text: `steered: ${steer.message.content[0].text}` }] } });
    }
    io.out({ type: "result", subtype: "success", result: "done", total_cost_usd: 0.42 });
    io.end(0);
  },
  codex: async (args, io) => {
    if (io.fail) {
      io.out({ type: "turn.failed", error: { message: "boom" } });
      return io.end(1);
    }
    const message = args.at(-1)!;
    if (args.includes("resume")) io.out({ type: "item.completed", item: { type: "agent_message", text: `steered: ${message}` } });
    else {
      io.out({ type: "item.completed", item: { type: "command_execution", command: "pnpm test", aggregated_output: "ok", exit_code: 0 } });
      await sleep(30);
      io.out({ type: "item.completed", item: { type: "agent_message", text: "done" } });
    }
    io.out({ type: "turn.completed", usage: { input_tokens: 1000, output_tokens: 100 } });
    io.end(0);
  },
  opencode: async (args, io) => {
    if (io.fail) {
      io.out({ type: "error", error: { message: "boom" } });
      return io.end(1);
    }
    const message = args.at(-1)!;
    if (args.includes("--continue")) io.out({ type: "text", part: { text: `steered: ${message}` } });
    else {
      io.out({ type: "tool_use", part: { tool: "bash", state: { input: { command: "pnpm test" }, output: "ok" } } });
      await sleep(30);
      io.out({ type: "text", part: { text: "done" } });
    }
    io.out({ type: "step_finish", part: { cost: 0.2 } });
    io.end(0);
  },
};

function scriptedSandbox(fail = false) {
  const files: Record<string, string> = {};
  const spawned: string[][] = [];
  const envs: Record<string, string>[] = [];
  const written: string[] = [];
  const sandbox: Sandbox = {
    id: "sbx_test",
    provider: "scripted",
    workdir: "/workspace",
    startedInMs: 0,
    exec: async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async (p, c) => void (files[p] = c),
    readFile: async (p) => files[p],
    writeBytes: async (p, b) => void (files[p] = new TextDecoder().decode(b)),
    readBytes: async (p) => (files[p] === undefined ? undefined : new TextEncoder().encode(files[p])),
    snapshot: async () => ({}) as SnapshotRef,
    destroy: async () => {},
    spawn: (cmd, args, opts): Proc => {
      spawned.push([cmd, ...args]);
      envs.push(opts?.env ?? {});
      const lines = new EventStream<string>();
      const stdin = new EventStream<string>();
      let resolveExit!: (r: ExecResult) => void;
      const exit = new Promise<ExecResult>((r) => (resolveExit = r));
      void emulators[cmd]!(args, {
        out: (l) => lines.push(JSON.stringify(l)),
        end: (code = 0) => {
          lines.close();
          resolveExit({ code, stdout: "", stderr: code ? "boom" : "" });
        },
        stdin,
        fail,
      });
      const kill = () => {
        lines.close();
        resolveExit({ code: 143, stdout: "", stderr: "" });
      };
      const write = (l: string) => {
        written.push(l);
        stdin.push(l);
      };
      return { lines, write, closeStdin: () => stdin.close(), kill, exit };
    },
  };
  return { sandbox, files, spawned, envs, written };
}

async function collect(events: AsyncIterable<HarnessEvent>) {
  const out: HarnessEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const adapters: [string, HarnessAdapter, string][] = [
  ["claude-code", new ClaudeCodeAdapter(), ".claude/skills/testing/SKILL.md"],
  ["codex", new CodexAdapter(), ".agents/skills/testing/SKILL.md"],
  ["opencode", new OpenCodeAdapter(), ".opencode/skills/testing/SKILL.md"],
];

const base = { instructions: "You implement.", prompt: "add a button", model: "m", skills: [{ name: "testing", body: "Use vitest." }] };

describe.each(adapters)("harness contract: %s", (_name, adapter, skillPath) => {
  it("streams normalized events and succeeds with a summary and cost", async () => {
    const { sandbox, files } = scriptedSandbox();
    const session = await adapter.start({ ...base, sandbox });
    const events = await collect(session.events);
    const result = await session.result;
    expect(result.outcome).toBe("succeeded");
    expect(result.summary).toBe("done");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "message")).toBe(true);
    expect(files[skillPath]).toContain("Use vitest.");
  });

  it("delivers a steering message to the running agent", async () => {
    const { sandbox } = scriptedSandbox();
    const session = await adapter.start({ ...base, sandbox });
    await session.steer("use the blue variant");
    const events = await collect(session.events);
    expect(events).toContainEqual({ type: "steer", text: "use the blue variant" });
    expect(events.some((e) => e.type === "message" && e.text === "steered: use the blue variant")).toBe(true);
    expect((await session.result).outcome).toBe("succeeded");
  });

  it("reports failure", async () => {
    const { sandbox } = scriptedSandbox(true);
    const session = await adapter.start({ ...base, sandbox });
    await collect(session.events);
    expect((await session.result).outcome).toBe("failed");
  });
});

describe("claude code specifics", () => {
  it("reports subscription usage windows from rate_limit_event", async () => {
    const { sandbox } = scriptedSandbox();
    const session = await new ClaudeCodeAdapter().start({ ...base, sandbox });
    const events: HarnessEvent[] = [];
    for await (const e of session.events) events.push(e);
    expect(events.find((e) => e.type === "rate_limit")).toEqual({
      type: "rate_limit",
      status: "allowed",
      fiveHour: { utilization: 0.02, resetsAt: "2026-10-20T21:10:00.000Z" },
      sevenDay: { utilization: 0.19, resetsAt: "2026-10-26T04:00:00.000Z" },
      others: { seven_day_fable: { utilization: 0.03, resetsAt: "2026-10-26T04:00:00.000Z" } },
    });
  });

  it("keeps the guard hook and MCP config (with the run token) in the git-excluded .kiln/ folder", async () => {
    const { sandbox, files, spawned } = scriptedSandbox();
    const session = await new ClaudeCodeAdapter().start({
      ...base,
      sandbox,
      cwd: "app",
      guardUrl: "http://kiln/api/v1/guard",
      mcpServers: [{ name: "kiln", url: "http://kiln/mcp", headers: { authorization: "Bearer run-token" } }],
    });
    await session.result;
    expect(JSON.parse(files["app/.kiln/claude-settings.json"]!).hooks.PreToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "node .kiln/kiln-guard.mjs",
      // Claude Code runs the command when a hook times out, so the timeout is explicit and the guard answers first.
      timeout: GUARD_HOOK_TIMEOUT_MS / 1000,
    });
    expect(files["app/.kiln/kiln-guard.mjs"]).toContain("http://kiln/api/v1/guard");
    expect(JSON.parse(files["app/.kiln/mcp.json"]!).mcpServers.kiln.url).toBe("http://kiln/mcp");
    // Nothing that could be committed carries the token, and the repository's own config is left alone.
    expect(Object.entries(files).filter(([p, c]) => !p.startsWith("app/.kiln/") && c.includes("run-token"))).toEqual([]);
    expect(files["app/.mcp.json"]).toBeUndefined();
    expect(files["app/.claude/settings.json"]).toBeUndefined();
    expect(spawned[0]).toEqual(
      expect.arrayContaining(["--output-format", "stream-json", "--model", "m", "--mcp-config", ".kiln/mcp.json", "--settings", ".kiln/claude-settings.json"]),
    );
  });

  it("reports why the process could not start when docker exec prints it on stdout", async () => {
    // docker exec writes OCI failures (bad cwd, missing binary) to stdout, and its own warnings to stderr.
    const oci = 'OCI runtime exec failed: exec failed: unable to start container process: exec: "claude": executable file not found in $PATH: unknown';
    const { sandbox } = scriptedSandbox();
    sandbox.spawn = (): Proc => {
      const lines = new EventStream<string>();
      lines.push(oci);
      lines.close();
      return {
        lines,
        write: () => {},
        closeStdin: () => {},
        kill: () => {},
        exit: Promise.resolve({ code: 126, stdout: "", stderr: "WARNING: Error loading config file: open /root/.docker/config.json: permission denied\n" }),
      };
    };
    const session = await new ClaudeCodeAdapter().start({ ...base, sandbox });
    const events = await collect(session.events);
    const result = await session.result;
    expect(result.outcome).toBe("failed");
    expect(result.summary).toContain(oci);
    const error = events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.text).toContain(oci);
    expect(error?.type === "error" && error.text).not.toContain("docker/config.json");
  });
});

describe("claude code through the agent sdk", () => {
  it("runs the CLI in the sandbox with the run's environment, never the host's", async () => {
    process.env.KILN_TEST_HOST_ONLY = "host-secret";
    try {
      const { sandbox, spawned, envs, written } = scriptedSandbox();
      const session = await new ClaudeCodeAdapter().start({ ...base, sandbox, env: { CLAUDE_CODE_OAUTH_TOKEN: "run-token" } });
      await session.result;
      expect(spawned[0]![0]).toBe("claude");
      expect(spawned[0]).toEqual(expect.arrayContaining(["--permission-mode", "bypassPermissions"]));
      // The SDK sends the instructions with its initialize request.
      expect(JSON.parse(written[0]!).request).toMatchObject({ subtype: "initialize", appendSystemPrompt: "You implement." });
      expect(envs[0]!.CLAUDE_CODE_OAUTH_TOKEN).toBe("run-token");
      expect(envs[0]!.KILN_TEST_HOST_ONLY).toBeUndefined();
      expect(Object.values(envs[0]!)).not.toContain("host-secret");
    } finally {
      delete process.env.KILN_TEST_HOST_ONLY;
    }
  });

  it("stops the run", async () => {
    const { sandbox } = scriptedSandbox();
    const session = await new ClaudeCodeAdapter().start({ ...base, sandbox });
    await session.stop();
    await collect(session.events);
    expect((await session.result).outcome).toBe("cancelled");
  });
});

describe("command guard hook", () => {
  const listen = (server: Server) => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));

  async function hookFor(guardUrl: string) {
    const { sandbox, files } = scriptedSandbox();
    await (
      await new ClaudeCodeAdapter().start({ ...base, sandbox, guardUrl })
    ).result;
    const path = join(mkdtempSync(join(tmpdir(), "kiln-guard-")), "kiln-guard.mjs");
    writeFileSync(path, files[".kiln/kiln-guard.mjs"]!);
    return path;
  }

  // Asynchronous, so the fake servers in this process keep answering while the hook runs.
  const runHook = (path: string, env: Record<string, string>) =>
    new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [path], { env: { PATH: process.env.PATH ?? "", KILN_RUN_TOKEN: "run-token", ...env } });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("close", (status) => resolve({ status, stderr }));
      child.stdin.end(JSON.stringify({ tool_input: { command: "pnpm test" } }));
    });

  it("reaches the guard through the sandbox's egress proxy (Node's fetch ignores HTTPS_PROXY)", async () => {
    const seen: { url?: string; auth?: string; body?: string } = {};
    // A forwarding proxy: the request line carries the absolute guard URL.
    const proxy = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        Object.assign(seen, { url: req.url, auth: req.headers.authorization, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ verdict: "allow" }));
      });
    });
    const port = await listen(proxy);
    try {
      const hook = await hookFor("http://kiln.example/api/v1/guard");
      const r = await runHook(hook, { HTTP_PROXY: `http://127.0.0.1:${port}` });
      expect(r.status).toBe(0);
      expect(seen.url).toBe("http://kiln.example/api/v1/guard");
      expect(seen.auth).toBe("Bearer run-token");
      expect(JSON.parse(seen.body!).command).toBe("pnpm test");
    } finally {
      proxy.close();
    }
  });

  it("blocks the command when the guard doesn't answer before the hook's deadline", async () => {
    // A guard that never answers, like one waiting on a person who never decides.
    const guard = createServer(() => undefined);
    const port = await listen(guard);
    try {
      const path = join(mkdtempSync(join(tmpdir(), "kiln-guard-")), "kiln-guard.mjs");
      writeFileSync(path, guardHook(`http://127.0.0.1:${port}/api/v1/guard`, 200));
      const r = await runHook(path, {});
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("No answer from the Kiln guard in time, blocking: pnpm test");
    } finally {
      guard.closeAllConnections();
      guard.close();
    }
  });

  it("ends a person's approval wait before the hook gives up on the guard", () => {
    expect(COMMAND_APPROVAL_MAX_WAIT_MS).toBeLessThan(GUARD_HOOK_DEADLINE_MS);
    expect(GUARD_HOOK_DEADLINE_MS).toBeLessThan(GUARD_HOOK_TIMEOUT_MS);
  });

  it("tunnels to an https guard with CONNECT, and blocks when the proxy refuses", async () => {
    let connectTo = "";
    const proxy = createServer();
    proxy.on("connect", (req, socket) => {
      connectTo = req.url ?? "";
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    const port = await listen(proxy);
    try {
      const hook = await hookFor("https://kiln-api.example/api/v1/guard");
      const r = await runHook(hook, { HTTPS_PROXY: `http://127.0.0.1:${port}` });
      expect(connectTo).toBe("kiln-api.example:443");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Kiln guard unreachable");
    } finally {
      proxy.close();
    }
  });
});

describe("fake harness", () => {
  it("lets scripts wait for steering", async () => {
    const fake = new FakeHarness(async (ctx) => {
      const msg = await ctx.nextSteer(500);
      ctx.emit({ type: "message", text: `next action uses ${msg}` });
      return { summary: msg };
    });
    const { sandbox } = scriptedSandbox();
    const session = await fake.start({ ...base, sandbox });
    await session.steer("plan B");
    expect((await session.result).summary).toBe("plan B");
  });
});

describe("codex with a ChatGPT login", () => {
  const now = new Date("2026-10-20T18:00:00.000Z");

  it("reads when a usage limit resets", () => {
    expect(
      codexUsageLimitReset("You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 2 days 3 hours 5 minutes.", now),
    ).toBe("2026-10-22T21:05:00.000Z");
    expect(codexUsageLimitReset("You've hit your usage limit. Try again later.", now)).toBe("2026-10-20T19:00:00.000Z");
    expect(codexUsageLimitReset("stream disconnected before completion", now)).toBeUndefined();
  });
});
