import { describe, expect, it } from "vitest";
import { normalizeTemplate } from "./templates";

describe("normalizeTemplate", () => {
  it("reads triggers and prompt from an API template's automation file", () => {
    const t = normalizeTemplate({
      id: "triage-linear",
      title: "Triage new Linear issues",
      description: "Label and route",
      category: "default",
      requires: ["linear"],
      files: { "automations/triage-linear/automation.md": "---\ndisplayName: Triage\ntriggers:\n  - provider: linear\n    event: issue_created\n---\nTriage the issue.\n" },
    });
    expect(t).toMatchObject({ slug: "triage-linear", categories: ["suggested"], source: "linear", triggers: [{ provider: "linear", event: "issue_created" }], prompt: "Triage the issue." });
  });
});
