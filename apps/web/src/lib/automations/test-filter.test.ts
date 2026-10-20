import { describe, expect, it } from "vitest";
import { filterTestView } from "./test-filter";

const result = {
  wouldTrigger: false,
  delivery: "d1",
  triggers: [
    { index: 0, provider: "github", event: "issue_opened", wouldTrigger: false, checks: [{ check: "provider", ok: false, expected: "github", actual: "webhook" }] },
    { index: 1, provider: "webhook", event: "received", wouldTrigger: true, checks: [{ check: "provider", ok: true }, { check: "filter.ref", ok: true, reason: "matches main" }] },
  ],
};

describe("filterTestView", () => {
  it("shows the trigger the dialog opened from", () => {
    expect(filterTestView(result, 0)).toEqual({ matched: false, paused: false, trigger: "github issue_opened", checks: [{ name: "provider", passed: false, detail: 'expected github, got webhook' }] });
  });

  it("falls back to the matching trigger and flags a paused automation", () => {
    const v = filterTestView(result);
    expect(v).toMatchObject({ matched: true, paused: true, trigger: "webhook received" });
    expect(v.checks).toEqual([{ name: "provider", passed: true, detail: undefined }, { name: "filter.ref", passed: true, detail: "matches main" }]);
  });

  it("handles an automation without triggers", () => {
    expect(filterTestView({ wouldTrigger: false, delivery: "d1", triggers: [] })).toEqual({ matched: false, paused: false, checks: [] });
  });
});
