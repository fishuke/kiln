import { describe, expect, it } from "vitest";
import { commentTarget, parsePatch } from "./diff";

const patch = "@@ -1,3 +1,3 @@ export function a() {\n # web\n-old line\n+new line\n keep\n@@ -10,0 +11,1 @@\n+added";

describe("parsePatch", () => {
  it("numbers old and new lines per hunk", () => {
    const lines = parsePatch(patch);
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text])).toEqual([
      ["hunk", undefined, undefined, "@@ -1,3 +1,3 @@ export function a() {"],
      ["ctx", 1, 1, "# web"],
      ["del", 2, undefined, "old line"],
      ["add", undefined, 2, "new line"],
      ["ctx", 3, 3, "keep"],
      ["hunk", undefined, undefined, "@@ -10,0 +11,1 @@"],
      ["add", undefined, 11, "added"],
    ]);
  });

  it("skips the no-newline marker and an empty patch", () => {
    expect(parsePatch("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b").map((l) => l.kind)).toEqual(["hunk", "del", "add"]);
    expect(parsePatch(undefined)).toEqual([]);
  });
});

describe("commentTarget", () => {
  it("comments on the new side, or the old side for removed lines", () => {
    const [, ctx, del, add] = parsePatch(patch);
    expect(commentTarget(ctx!)).toEqual({ line: 1, side: "RIGHT" });
    expect(commentTarget(del!)).toEqual({ line: 2, side: "LEFT" });
    expect(commentTarget(add!)).toEqual({ line: 2, side: "RIGHT" });
    expect(commentTarget(parsePatch(patch)[0]!)).toBeUndefined();
  });
});
