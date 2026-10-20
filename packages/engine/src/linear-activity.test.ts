import { FakeHarness } from "@kiln/harness";
import { FakeLinearAgentApi, type IncomingEvent } from "@kiln/integrations";
import { describe, expect, it, vi } from "vitest";
import { LinearActivityStream, toolParameter } from "./linear-activity";
import { createTestKiln } from "./testing";

const ev = (provider: IncomingEvent["provider"], event: string, data: IncomingEvent["data"], deliveryId?: string): IncomingEvent => ({
  provider,
  event,
  data,
  deliveryId,
});

describe("linear activity stream", () => {
  const stream = () => {
    const posted: unknown[] = [];
    const s = new LinearActivityStream(async (_runId, activity) => {
      posted.push(activity);
    });
    return { s, posted };
  };

  it("pairs a tool call with its result as one action", async () => {
    const { s, posted } = stream();
    await s.push("r1", { type: "tool_call", text: "Read", data: { file_path: "src/a.ts" } });
    expect(posted).toEqual([]);
    await s.push("r1", { type: "tool_result", text: "line 1\nline 2" });
    expect(posted).toEqual([{ type: "action", body: "", action: "Read", parameter: "src/a.ts", result: "line 1\nline 2" }]);
  });

  it("flushes a tool call without a result when something else comes first", async () => {
    const { s, posted } = stream();
    await s.push("r1", { type: "tool_call", text: "Bash", data: { command: "pnpm test" } });
    await s.push("r1", { type: "message", text: "Tests are running" });
    expect(posted).toEqual([
      { type: "action", body: "", action: "Bash", parameter: "pnpm test" },
      { type: "thought", body: "Tests are running" },
    ]);
  });

  it("posts failed tool results, errors and failed runs", async () => {
    const { s, posted } = stream();
    await s.push("r1", { type: "tool_call", text: "Bash", data: { command: "false" } });
    await s.push("r1", { type: "tool_result", text: "exit 1", data: { isError: true } });
    await s.push("r1", { type: "error", text: "agent_failed: tests fail" });
    await s.push("r1", { type: "finished", text: "failed" });
    expect(posted).toEqual([
      { type: "action", body: "", action: "Bash", parameter: "false", result: "Failed: exit 1" },
      { type: "error", body: "agent_failed: tests fail" },
    ]);
    await s.push("r2", { type: "finished", text: "failed" }, "the agent reported a failure");
    expect(posted.at(-1)).toEqual({ type: "error", body: "Run failed: the agent reported a failure" });
  });

  it("says when a run starts and skips bookkeeping events", async () => {
    const { s, posted } = stream();
    await s.push("r1", { type: "started", text: "implement (claude-code, claude-opus-5-5) on local" });
    for (const type of ["queued", "claimed", "steer", "cost", "rate_limit", "artifact"]) await s.push("r1", { type, text: "x" });
    await s.push("r1", { type: "finished", text: "succeeded" });
    expect(posted).toEqual([{ type: "thought", body: "Started implement (claude-code, claude-opus-5-5)" }]);
  });

  it("truncates long bodies", async () => {
    const { s, posted } = stream();
    await s.push("r1", { type: "message", text: "x".repeat(5000) });
    expect((posted[0] as { body: string }).body.length).toBeLessThanOrEqual(2000);
  });

  it("summarises tool inputs", () => {
    expect(toolParameter({ file_path: "a.ts", content: "..." })).toBe("a.ts");
    expect(toolParameter({ pattern: "TODO", path: "src" })).toBe("TODO");
    expect(toolParameter({ url: "https://x.test" })).toBe("https://x.test");
    expect(toolParameter({ todos: [1, 2] })).toBe('{"todos":[1,2]}');
    expect(toolParameter(undefined)).toBe("");
  });
});

describe("linear session progress from runs", () => {
  it("streams a run's work into the session it came from", async () => {
    const linear = new FakeLinearAgentApi();
    const script = new FakeHarness(async ({ emit }) => {
      emit({ type: "message", text: "Looking at the footer" });
      emit({ type: "tool_call", name: "Edit", input: { file_path: "src/footer.tsx" } });
      emit({ type: "tool_result", name: "Edit", output: "ok" });
    });
    const { kiln } = createTestKiln({ adapters: { linearAgent: linear }, harness: () => script });
    const { started } = await kiln.automations.handle(
      ev("linear", "agent_session_created", { issueId: "i1", title: "Add a footer", sessionId: "as1", team_ids: ["t1"] }, "ls1"),
    );
    const wi = started[0]!;
    await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "Add a footer", workItem: wi, push: false });
    await vi.waitFor(() => {
      const mine = linear.activities.filter((a) => a.sessionId === "as1").map((a) => a.activity);
      expect(mine).toContainEqual({ type: "thought", body: "Looking at the footer" });
      expect(mine).toContainEqual({ type: "action", body: "", action: "Edit", parameter: "src/footer.tsx", result: "ok" });
    });
  });

  it("posts nothing for runs outside a Linear session", async () => {
    const linear = new FakeLinearAgentApi();
    const { kiln } = createTestKiln({ adapters: { linearAgent: linear } });
    await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "build", push: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(linear.activities).toEqual([]);
  });
});
