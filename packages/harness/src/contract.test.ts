import type { ExecResult, Proc, Sandbox, SnapshotRef } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  codexUsageLimitReset,
  EventStream,
  FakeHarness,
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
    expect(JSON.parse(files["app/.kiln/claude-settings.json"]!).hooks.PreToolUse[0].hooks[0].command).toBe("node .kiln/kiln-guard.mjs");
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
