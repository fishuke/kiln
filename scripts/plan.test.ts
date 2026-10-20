import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plan = readFileSync(new URL("../docs/plan/PLAN.md", import.meta.url), "utf8");
const status = readFileSync(new URL("../docs/plan/STATUS.md", import.meta.url), "utf8");

describe("plan and status", () => {
  const ids = [...plan.matchAll(/^[-*] \[[ x]\] \*\*(M\d-T\d)/gm)].map((m) => m[1]!);

  it("PLAN.md lists 49 tasks", () => {
    expect(ids).toHaveLength(49);
  });

  it("STATUS.md has one row per task, in order", () => {
    const rows = [...status.matchAll(/^\| (M\d-T\d) \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(ids);
  });
});
