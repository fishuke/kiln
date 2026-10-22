import { describe, expect, it } from "vitest";
import { reasoningTitle, stepStatus, subagentsTitle, workSummary, workTitle } from "./trace-lines";

describe("reasoningTitle", () => {
  it("says how long the agent reasoned when it was timed", () => {
    expect(reasoningTitle(12_000)).toBe("Reasoned for 12s");
  });

  it("says only that it reasoned when there is no duration", () => {
    expect(reasoningTitle(0)).toBe("Reasoned");
    expect(reasoningTitle(undefined)).toBe("Reasoned");
  });
});

describe("workTitle", () => {
  it("reads Working while the agent is still at it and Worked once it stops", () => {
    expect(workTitle(65_000, true)).toBe("Working for 1m 5s");
    expect(workTitle(65_000, false)).toBe("Worked for 1m 5s");
  });
});

describe("workSummary", () => {
  it("counts commands and tool calls, and skips kinds that are absent", () => {
    expect(workSummary([{ kind: "command", label: "Ran" }, { kind: "command", label: "Ran" }, { kind: "tool", label: "Read" }])).toBe("Ran 2 commands · Called 1 tool");
    expect(workSummary([{ kind: "tool", label: "Read" }, { kind: "tool", label: "Edit" }])).toBe("Called 2 tools");
    expect(workSummary([{ kind: "reasoning", label: "" }])).toBe("");
  });
});

describe("stepStatus", () => {
  it("marks failed steps and error steps as errors", () => {
    expect(stepStatus({ kind: "command", label: "Ran", isError: true })).toBe("error");
    expect(stepStatus({ kind: "error", label: "Crashed" })).toBe("error");
  });

  it("leaves finished steps without a status", () => {
    expect(stepStatus({ kind: "tool", label: "Read", output: "ok" })).toBeUndefined();
  });
});

describe("subagentsTitle", () => {
  it("counts the subagents the foreman launched", () => {
    expect(subagentsTitle(1)).toBe("Launched 1 subagent");
    expect(subagentsTitle(3)).toBe("Launched 3 subagents");
  });
});
