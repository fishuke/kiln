import { describe, expect, it } from "vitest";
import { planView, waitingFor } from "./run-plan";

const plan = {
  cursor: 2,
  stages: [
    { id: "triage", kind: "triage", agent: "triage" },
    { id: "build", kind: "build", agent: "implement" },
    { id: "review", kind: "review", agent: "review" },
    { id: "handoff", kind: "handoff" },
  ],
};
const run = (stage: string, status: string, startedAt = "2026-10-21T10:00:00Z") => ({ agent: stage === "build" ? "implement" : stage, stage, status, startedAt });

describe("planView", () => {
  it("lists one line per stage with its status and attempts", () => {
    const v = planView({ state: "reviewing", plan, runs: [run("triage", "succeeded"), run("build", "failed"), run("build", "succeeded"), run("review", "running")] })!;
    expect(v.tasks.map((t) => [t.label, t.status, t.attempts])).toEqual([
      ["Triage the request", "done", 1],
      ["Implement the change", "done", 2],
      ["Review the change", "active", 1],
      ["Hand off the pull request", "todo", 0],
    ]);
    expect([v.done, v.total, v.current]).toEqual([2, 4, "Review"]);
    expect(v.waiting).toBe("Waiting for review agent…");
  });

  it("marks the current stage as waiting or failed from the task state", () => {
    expect(planView({ state: "blocked", plan, runs: [] })!.tasks[2]!.status).toBe("waiting");
    expect(planView({ state: "failed", plan, runs: [] })!.tasks[2]!.status).toBe("failed");
    const done = planView({ state: "complete", plan, runs: [] })!;
    expect(done.done).toBe(4);
    expect(done.current).toBeUndefined();
  });

  it("counts the hand-off as done once the pull request is handed off", () => {
    const v = planView({ state: "handed_off", plan: { ...plan, cursor: 3 }, runs: [], openGates: [{ title: 'Review "Footer"' }] })!;
    expect(v.done).toBe(4);
    expect(v.waiting).toBe('Waiting for you: Review "Footer"');
  });

  it("has no view without a plan", () => {
    expect(planView({ state: "received", runs: [] })).toBeUndefined();
  });
});

describe("planView with the agent foreman's checklist", () => {
  it("uses the foreman's own titles and status", () => {
    const tasks = [
      { title: "Triage: research the request", status: "done" as const },
      { title: "Implement persistence", status: "active" as const },
      { title: "Hand off PR to user", status: "todo" as const },
    ];
    const v = planView({ state: "building", tasks, runs: [run("build", "running")] })!;
    expect(v.tasks.map((t) => [t.label, t.status])).toEqual([
      ["Triage: research the request", "done"],
      ["Implement persistence", "active"],
      ["Hand off PR to user", "todo"],
    ]);
    expect([v.done, v.total, v.current]).toEqual([1, 3, "Implement persistence"]);
    expect(planView({ state: "building", tasks, runs: [], openGates: [{ title: "Which storage?" }] })!.tasks[1]!.status).toBe("waiting");
  });
});

describe("waitingFor", () => {
  it("names CI, and nothing for a stop or a finished task", () => {
    expect(waitingFor({ state: "building", blockedReason: "waiting for CI", runs: [] })).toBe("Waiting for CI…");
    expect(waitingFor({ state: "blocked", blockedReason: "implement failed twice", runs: [] })).toBeUndefined();
    expect(waitingFor({ state: "complete", runs: [run("build", "running")] })).toBeUndefined();
  });
});
