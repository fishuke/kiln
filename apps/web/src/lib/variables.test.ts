import { describe, expect, it } from "vitest";
import { mergePasted, rowProblem, toVariableInputs } from "./variables";

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

  it("merges a pasted .env into the rows", () => {
    const row = (key: string, value = "", secret = false) => ({ key, value, secret, stored: secret });
    const empty = row("");
    const rows = [row("API_URL", "old"), row("TOKEN", "", true), empty];
    expect(
      mergePasted(rows, empty, [
        { name: "API_URL", value: "new" },
        { name: "TOKEN", value: "t" },
        { name: "DEBUG", value: "1" },
        { name: "DEBUG", value: "2" },
      ], (k, v) => row(k, v)),
    ).toEqual([row("API_URL", "new"), { ...row("TOKEN", "", true), value: "t" }, row("DEBUG", "2")]);
    const filled = row("KEEP", "x");
    expect(mergePasted([filled], filled, [{ name: "A", value: "1" }], (k, v) => row(k, v))).toEqual([filled, row("A", "1")]);
  });
});
