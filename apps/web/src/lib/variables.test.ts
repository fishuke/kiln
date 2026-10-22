import { describe, expect, it } from "vitest";
import { rowProblem, toVariableInputs } from "./variables";

describe("project variable rows", () => {
  it("keeps a saved secret by sending it without a value", () => {
    expect(
      toVariableInputs([
        { key: " API_URL ", value: "https://x", secret: false, stored: false },
        { key: "TOKEN", value: "", secret: true, stored: true },
        { key: "NEW_TOKEN", value: "abc", secret: true, stored: false },
        { key: "ROTATED", value: "new", secret: true, stored: true },
      ]),
    ).toEqual([
      { key: "API_URL", value: "https://x", secret: false },
      { key: "TOKEN", secret: true },
      { key: "NEW_TOKEN", value: "abc", secret: true },
      { key: "ROTATED", value: "new", secret: true },
    ]);
  });

  it("explains what is wrong with a set of rows", () => {
    const row = (key: string, extra: Partial<{ value: string; secret: boolean; stored: boolean }> = {}) => ({
      key,
      value: "v",
      secret: false,
      stored: false,
      ...extra,
    });
    expect(rowProblem([row("A"), row("B")])).toBeUndefined();
    expect(rowProblem([row("bad-key")])).toBe("bad-key: use letters, digits and underscores");
    expect(rowProblem([row("KILN_URL")])).toBe("KILN_URL: KILN_ is reserved");
    expect(rowProblem([row("A"), row("A")])).toBe("A is listed twice");
    expect(rowProblem([row("S", { secret: true, value: "" })])).toBe("S needs a value");
    expect(rowProblem([row("S", { secret: true, value: "", stored: true })])).toBeUndefined();
  });
});
