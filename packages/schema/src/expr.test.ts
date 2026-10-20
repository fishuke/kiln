import { describe, expect, it } from "vitest";
import { evalBool, ExprError, parseExpr, refsOf } from "./expr";

describe("expression language", () => {
  const ctx = {
    triage: { size: "s", kind: "bug" },
    risk_level: { safe: 0.05, risky: 0.1, destructive: 0.85 },
    remote_exec: 0.1,
  };

  it.each([
    ["triage.size in ['xs','s']", true],
    ["triage.size not in ['xs','s']", false],
    ["risk_level.destructive >= 0.8 or remote_exec >= 0.8", true],
    ["risk_level.risky >= 0.3", false],
    ["not (triage.kind == 'bug')", false],
    ["triage.kind == 'bug' and remote_exec < 0.5", true],
    ["missing.value > 1", false],
    ["true", true],
  ])("%s → %s", (src, expected) => {
    expect(evalBool(src, ctx)).toBe(expected);
  });

  it("lists the references it reads", () => {
    expect(refsOf(parseExpr("a.b > 1 and c in [d]"))).toEqual(["a.b", "c", "d"]);
  });

  it.each(["a >", "(a", "a ? b", "'open", "a b"])("rejects %s", (src) => {
    expect(() => parseExpr(src)).toThrow(ExprError);
  });
});
