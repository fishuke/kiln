import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { arrivedRange, wordsIn } from "./arrive";

const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const doc = (...ps: string[]) => schema.node("doc", null, ps.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])));

describe("arrive", () => {
  it("finds the text a peer added and splits it into words", () => {
    const before = doc("Why");
    const after = doc("Why", "People keep tasks in their heads.");
    const range = arrivedRange(before, after)!;
    expect(wordsIn(after, range).map((w) => after.textBetween(w.from, w.to))).toEqual(["People ", "keep ", "tasks ", "in ", "their ", "heads."]);
  });

  it("finds words appended inside an existing paragraph", () => {
    const before = doc("Todo gives one");
    const after = doc("Todo gives one quick place");
    const range = arrivedRange(before, after)!;
    expect(wordsIn(after, range).map((w) => after.textBetween(w.from, w.to))).toEqual(["quick ", "place"]);
  });

  it("reports nothing when text was only removed or nothing changed", () => {
    expect(arrivedRange(doc("a b c"), doc("a b c"))).toBeUndefined();
    expect(arrivedRange(doc("a b c"), doc("a c"))).toBeUndefined();
  });
});
