import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { questionProps } from "@/lib/studio/context-doc";
// The server's writer of the same document. A test only: the page itself never imports packages/studio.
import { YContextDoc } from "../../../../../../packages/studio/src/context-ydoc";
import { editorWriter, readBlocks } from "./doc-writer";
import { contextSchema, type ContextBlock, type ContextEditor } from "./schema";

const create = () => BlockNoteEditor.create({ schema: contextSchema }) as unknown as ContextEditor;
const question = questionProps({ id: "sq_1", turnId: "st_1", spec: { kind: "boolean", title: "Offline?" }, status: "open", batch: { id: "sb_1", index: 0, total: 1 } });

/** The same writes, through any writer of the Context document. */
function write(w: Pick<YContextDoc, "insert" | "appendText" | "update">) {
  const h = w.insert({ type: "heading", props: { level: 2 }, text: "Requirements" }, "end");
  const r = w.insert({ type: "requirement", props: { ownerRole: "design", by: "agent" } }, { after: h });
  w.appendText(r, "People can ");
  w.appendText(r, "search.");
  w.insert({ type: "paragraph", text: "A detail" }, { parent: r });
  for (const type of ["decision", "assumption", "constraint", "flow", "risk", "metric"]) w.insert({ type, text: `A ${type}` }, "end");
  const q = w.insert({ type: "question", props: question }, "end");
  w.update(q, { props: { status: "answered", answer: JSON.stringify({ type: "value", value: true }) } });
  const p = w.insert({ type: "paragraph", text: "Becomes a constraint" }, "end");
  w.update(p, { type: "constraint", props: { ownerRole: "qa" } });
}
const shape = (blocks: { type: string; text: string; props: unknown; parent?: string }[]) => blocks.filter((b) => b.text || b.type === "question").map((b) => ({ type: b.type, text: b.text, props: b.props, nested: Boolean(b.parent) }));

type PM = { type: string; attrs?: Record<string, unknown>; text?: string; marks?: unknown; content?: PM[] };
/** A ProseMirror document as its content nodes in order, with nesting depth, without block ids and the editor's empty paragraphs. */
function nodes(doc: PM): { type: string; attrs: unknown; text: string; depth: number }[] {
  const out: { type: string; attrs: unknown; text: string; depth: number }[] = [];
  const walk = (n: PM, depth: number) => {
    if (n.type === "blockContainer") {
      const [content, group] = n.content ?? [];
      const text = (content?.content ?? []).map((t) => t.text ?? "").join("");
      if (content && (text || content.type === "question")) out.push({ type: content.type, attrs: content.attrs, text, depth });
      if (group) walk(group, depth + 1);
    } else for (const c of n.content ?? []) walk(c, depth);
  };
  walk(doc, 0);
  return out;
}

describe("the server's Context document and the editor's", () => {
  it("what the server writes is a valid document for the editor, node for node", () => {
    const doc = new Y.Doc();
    write(new YContextDoc(doc));
    const fromServer = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment("context"), create().pmSchema);
    fromServer.check();
    const viaEditor = create();
    write(editorWriter(viaEditor));
    expect(nodes(fromServer.toJSON() as PM)).toEqual(nodes(viaEditor.prosemirrorState.doc.toJSON() as PM));
  });

  it("what the editor writes, the server reads the same way", () => {
    const editor = create();
    write(editorWriter(editor));
    const doc = new Y.Doc();
    prosemirrorToYXmlFragment(editor.prosemirrorState.doc, doc.getXmlFragment("context"));
    expect(shape(new YContextDoc(doc).read())).toEqual(shape(readBlocks(editor.document as ContextBlock[])));
  });
});
