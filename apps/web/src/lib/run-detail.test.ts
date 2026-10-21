import { describe, expect, it } from "vitest";
import { agentTree, artifactUrl, collectArtifacts, gateOutcome, runTranscript, workItemTranscript, type EventLike } from "./run-detail";
import type { RunLike } from "./run-tree";

const ev = (seq: number, type: string, text?: string, data?: unknown, sec = seq): EventLike => ({ seq, type, text, data, at: `2026-10-20T10:00:${String(sec).padStart(2, "0")}Z` });
const run = (id: string, over: Partial<RunLike> = {}): RunLike => ({ id, kind: "work", factory: "kiln", agent: "implement", status: "succeeded", costUsd: 1, startedAt: "2026-10-20T10:00:00Z", artifacts: [], ...over });

describe("runTranscript", () => {
  it("folds tool calls between messages into one work group with outputs", () => {
    const items = runTranscript([ev(1, "started", "x"), ev(2, "message", "Looking"), ev(3, "tool_call", "Bash", { command: "ls -la" }), ev(4, "tool_result", "a\nb", { isError: true }), ev(5, "thinking", "hmm"), ev(9, "tool_call", "Read", { file_path: "src/a.ts" }), ev(10, "message", "Done"), ev(11, "finished", "succeeded")]);
    expect(items.map((i) => i.type)).toEqual(["agent", "work", "agent"]);
    const work = items[1] as Extract<(typeof items)[number], { type: "work" }>;
    expect(work.durationMs).toBe(6000);
    expect(work.steps).toEqual([
      { kind: "command", label: "Ran", detail: "ls -la", output: "a\nb", isError: true },
      { kind: "reasoning", label: "Reasoned", output: "hmm", durationMs: 0 },
      { kind: "tool", label: "Called Read", detail: "src/a.ts" },
    ]);
  });

  it("shows the prompt, steering and failures", () => {
    const items = runTranscript([ev(1, "steer", "use Button"), ev(2, "error", "boom"), ev(3, "finished", "failed")], { prompt: "Build it" });
    expect(items.map((i) => i.type)).toEqual(["user", "user", "system", "system"]);
  });
});

describe("workItemTranscript", () => {
  it("orders conversation, subagents and gates by time and merges launches", () => {
    const items = workItemTranscript({
      title: "Add todo",
      requester: "me",
      createdAt: "2026-10-20T10:00:00Z",
      conversation: [{ at: "2026-10-20T10:00:05Z", from: "foreman", role: "foreman", text: "On it" }],
      runs: [run("r1", { startedAt: "2026-10-20T10:00:10Z", agent: "triage", stage: "triage" }), run("r2", { startedAt: "2026-10-20T10:00:11Z" }), run("r3", { parentRunId: "r2", startedAt: "2026-10-20T10:00:12Z" })],
      gates: [
        { id: "g1", kind: "spec", title: "Approve spec", state: "approved", decidedBy: "me", evidence: [], openedAt: "2026-10-20T10:00:20Z", decidedAt: "2026-10-20T10:00:30Z" },
        { id: "g2", kind: "preview", title: "Accept preview", state: "open", evidence: [], openedAt: "2026-10-20T10:00:40Z" },
      ],
    });
    expect(items.map((i) => i.type)).toEqual(["user", "agent", "subagents", "system", "gate"]);
    const sub = items[2] as Extract<(typeof items)[number], { type: "subagents" }>;
    expect(sub.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(sub.runs[0]!.title).toBe("Triage Add todo");
  });

  it("shows a running subagent's activity under its row", () => {
    const events: EventLike[] = [
      { seq: 1, at: "2026-10-20T10:00:12Z", type: "tool_call", text: "pnpm install", data: { name: "bash", input: { command: "pnpm install" } } },
      { seq: 2, at: "2026-10-20T10:00:13Z", type: "message", text: "Reading the setup docs" },
    ];
    const items = workItemTranscript({
      title: "Add todo",
      requester: "me",
      createdAt: "2026-10-20T10:00:00Z",
      conversation: [],
      runs: [run("r1", { startedAt: "2026-10-20T10:00:10Z" })],
      gates: [],
      activity: { r1: runTranscript(events) },
    });
    const sub = items.find((i) => i.type === "subagents") as Extract<(typeof items)[number], { type: "subagents" }>;
    expect(sub.runs[0]!.activity?.map((i) => i.type)).toEqual(["work", "agent"]);
  });
});

describe("helpers", () => {
  it("builds the agents tree", () => {
    const t = agentTree([run("a"), run("b", { parentRunId: "a" }), run("c")]);
    expect(t.map((n) => [n.id, n.children.map((c) => c.id)])).toEqual([
      ["a", ["b"]],
      ["c", []],
    ]);
  });
  it("lists agents in the order they started", () => {
    const t = agentTree([run("late", { startedAt: "2026-10-20T10:05:00Z" }), run("early", { startedAt: "2026-10-20T10:01:00Z" })]);
    expect(t.map((n) => n.id)).toEqual(["early", "late"]);
  });
  it("groups artifacts and proxies stored files", () => {
    expect(artifactUrl({ url: "s3://x", key: "runs/r1/a.png" })).toBe("/files/runs/r1/a.png");
    expect(artifactUrl({ url: "file:///tmp/data/objects/evidence/wi/v.webm" })).toBe("/files/evidence/wi/v.webm");
    const g = collectArtifacts({
      runs: [run("r", { artifacts: [{ kind: "image", name: "a.png", url: "u", key: "k/a.png" }, { kind: "file", name: "log.txt", url: "u2", key: "k/log.txt" }, { kind: "pr", name: "PR", url: "https://gh/o/r/pull/4" }] })],
      pr: { repo: "o/r", number: 4, url: "https://gh/o/r/pull/4" },
      previewUrl: "https://pr-4.preview",
    });
    expect(g.prs).toHaveLength(1);
    expect(g.media.map((m) => m.url)).toEqual(["/files/k/a.png"]);
    expect(g.files.map((m) => m.name)).toEqual(["log.txt"]);
    expect(g.previews).toEqual([{ url: "https://pr-4.preview", label: "Preview" }]);
  });
  it("describes decided gates", () => {
    expect(gateOutcome({ kind: "spec", state: "approved", decidedBy: "ann", title: "x" })).toBe("Spec approved by ann");
    expect(gateOutcome({ kind: "preview", state: "approved", title: "x" })).toBe("Preview accepted");
  });
});
