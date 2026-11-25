import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { questionProps } from "./context-doc";
import { fragmentsFrom, questionsFrom } from "./context-model";
import { YContextDoc } from "./context-ydoc";

function setup() {
  let n = 0;
  const doc = new Y.Doc();
  return { doc, y: new YContextDoc(doc, "agent", () => `b${(n += 1)}`) };
}
const texts = (y: YContextDoc) => y.read().map((b) => `${b.type}:${b.text}`);

describe("YContextDoc", () => {
  it("inserts at the end, after, before and under a parent, and reads nesting as parent", () => {
    const { y } = setup();
    const a = y.insert({ type: "heading", props: { level: 2 }, text: "Requirements" }, "end");
    const c = y.insert({ type: "requirement", text: "Third" }, { after: a });
    const b = y.insert({ type: "requirement", text: "Second" }, { before: c });
    const child = y.insert({ type: "paragraph", text: "A detail" }, { parent: b });
    y.insert({ type: "paragraph", text: "Another detail" }, { parent: b });
    expect(texts(y)).toEqual(["heading:Requirements", "requirement:Second", "paragraph:A detail", "paragraph:Another detail", "requirement:Third"]);
    expect(y.read().find((x) => x.id === child)?.parent).toBe(b);
    expect(y.read().find((x) => x.id === c)?.parent).toBeUndefined();
    expect(y.read()[0]!.props).toMatchObject({ level: 2, isToggleable: false, textAlignment: "left" });
  });

  it("appends text, updates props, text and type, and removes a block with its children", () => {
    const { y } = setup();
    const id = y.insert({ type: "requirement", props: { by: "agent" } }, "end");
    y.appendText(id, "People can ");
    y.appendText(id, "search.");
    expect(y.read()[0]).toMatchObject({ type: "requirement", text: "People can search.", props: { by: "agent", at: "", route: "" } });
    y.update(id, { props: { route: "/" } });
    y.update(id, { type: "constraint" });
    expect(y.read()[0]).toMatchObject({ id, type: "constraint", text: "People can search.", props: { by: "agent", route: "/" } });
    y.update(id, { text: "" });
    expect(y.read()[0]!.text).toBe("");
    y.appendText(id, "Rewritten.");
    expect(y.read()[0]!.text).toBe("Rewritten.");
    y.insert({ type: "paragraph", text: "child" }, { parent: id });
    y.remove(id);
    expect(y.read()).toEqual([]);
    y.appendText(id, "ignored");
    y.update("nope", { text: "ignored" });
    y.remove("nope");
  });

  it("holds questions and gives fragments and questions like any Context document", () => {
    const { y } = setup();
    y.insert({ type: "heading", props: { level: 1 }, text: "Recipe box" }, "end");
    const q = y.insert({ type: "question", props: questionProps({ id: "sq_1", turnId: "st_1", spec: { kind: "boolean", title: "Offline?" }, status: "open", batch: { id: "sb_1", index: 0, total: 1 } }) }, "end");
    expect(questionsFrom("sa_1", y.read())).toMatchObject([{ id: "sq_1", fragmentId: q, status: "open" }]);
    y.update(q, { props: { status: "answered", answer: JSON.stringify({ type: "value", value: true }), by: "ada@example.com" } });
    expect(fragmentsFrom("sa_1", y.read()).map((f) => f.type)).toEqual(["section", "decision"]);
  });

  it("writes in transactions with its origin, tells listeners, and syncs to another copy of the document", () => {
    const { doc, y } = setup();
    const other = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("update", (u: Uint8Array, origin: unknown) => {
      origins.push(origin);
      Y.applyUpdate(other, u);
    });
    let changes = 0;
    const off = y.onChange(() => (changes += 1));
    const id = y.insert({ type: "risk", text: "It breaks" }, "end");
    y.appendText(id, " often");
    expect(origins).toEqual(["agent", "agent"]);
    expect(changes).toBe(2);
    off();
    expect(new YContextDoc(other).read()).toMatchObject([{ id, type: "risk", text: "It breaks often" }]);
  });

  it("reads a document it didn't write: empty blocks, formatted text and unknown elements", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("context");
    const group = new Y.XmlElement("blockGroup");
    frag.insert(0, [group]);
    const c1 = new Y.XmlElement("blockContainer");
    c1.setAttribute("id", "x1");
    c1.insert(0, [new Y.XmlElement("paragraph")]);
    const c2 = new Y.XmlElement("blockContainer");
    c2.setAttribute("id", "x2");
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "Bold", { bold: {} });
    t.insert(4, " plain");
    p.insert(0, [t]);
    c2.insert(0, [p]);
    group.insert(0, [c1, c2]);
    expect(new YContextDoc(doc).read().map((b) => [b.id, b.text])).toEqual([["x1", ""], ["x2", "Bold plain"]]);
    expect(new YContextDoc(new Y.Doc()).read()).toEqual([]);
  });
});
