import type { ExecResult, Proc, Sandbox, SnapshotRef } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter, CodexAdapter, EventStream, FakeHarness, OpenCodeAdapter, type HarnessAdapter, type HarnessEvent } from "./index";

type Emulator = (args: string[], io: { out: (line: unknown) => void; end: (code?: number) => void; stdin: EventStream<string>; fail: boolean }) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emulates each CLI's wire format closely enough to exercise the adapters' parsing and steering. */
const emulators: Record<string, Emulator> = {
  claude: async (_args, io) => {
    const it = io.stdin[Symbol.asyncIterator]();
    const first = JSON.parse((await it.next()).value);
    if (io.fail) {
      io.out({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom", total_cost_usd: 0.01 });
      return io.end(0);
    }
    io.out({ type: "assistant", message: { content: [{ type: "text", text: `working on ${first.message.content[0].text}` }, { type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } });
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
  const sandbox: Sandbox = {
    id: "sbx_test",
    provider: "scripted",
    workdir: "/workspace",
    startedInMs: 0,
    exec: async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async (p, c) => void (files[p] = c),
    readFile: async (p) => files[p],
    snapshot: async () => ({}) as SnapshotRef,
    destroy: async () => {},
    spawn: (cmd, args): Proc => {
      spawned.push([cmd, ...args]);
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
      return { lines, write: (l) => stdin.push(l), closeStdin: () => stdin.close(), kill: () => {}, exit };
    },
  };
  return { sandbox, files, spawned };
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
  it("installs the guard hook and MCP config when asked", async () => {
    const { sandbox, files, spawned } = scriptedSandbox();
    const session = await new ClaudeCodeAdapter().start({
      ...base,
      sandbox,
      cwd: "app",
      guardUrl: "http://kiln/api/v1/guard",
      mcpServers: [{ name: "kiln", url: "http://kiln/mcp" }],
    });
    await session.result;
    expect(JSON.parse(files["app/.claude/settings.json"]!).hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(files["app/.claude/hooks/kiln-guard.mjs"]).toContain("http://kiln/api/v1/guard");
    expect(JSON.parse(files["app/.mcp.json"]!).mcpServers.kiln.url).toBe("http://kiln/mcp");
    expect(spawned[0]).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--model", "m"]));
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
