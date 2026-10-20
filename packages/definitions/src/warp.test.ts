import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTree } from "./tree";
import { formatErrors, validateTree } from "./validate";
import { importWarp } from "./warp";

const examples = fileURLToPath(new URL("../fixtures/warp/", import.meta.url));
const names = readdirSync(examples).filter((n) => /^\d\d-/.test(n));

describe("kiln import --from-warp", () => {
  it("found Warp's public example trees", () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it.each(names)("converts and validates %s", (name) => {
    const { tree } = importWarp(loadTree(`${examples}${name}`));
    const result = validateTree(tree);
    expect(result.ok ? "" : formatErrors(result.errors)).toBe("");
  });

  it("converts the Kiln repo's own Warp factory/", () => {
    const tree = loadTree(fileURLToPath(new URL("../../../factory/", import.meta.url)));
    const { tree: kiln, warnings } = importWarp(tree);
    const result = validateTree(kiln);
    expect(result.ok ? "" : formatErrors(result.errors)).toBe("");
    expect(warnings).toContain("routers/auto.yaml: added a complexity router to stand in for Warp's auto model");
  });
});
