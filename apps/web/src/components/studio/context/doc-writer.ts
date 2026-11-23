import type { ContextDocWriter, DocBlock, DocPlace, DocProps, NewDocBlock } from "@/lib/studio/context-doc";
import type { ContextBlock, ContextEditor } from "./schema";

type Inline = { type: string; text?: string; content?: unknown };

/** The plain text of a block's inline content. */
export function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Inline[]).map((c) => (c.type === "text" ? (c.text ?? "") : inlineText(c.content))).join("");
}

/** Every block of the document in order, flattened: nesting becomes `parent`. */
export function readBlocks(blocks: ContextBlock[], parent?: string, out: DocBlock[] = []): DocBlock[] {
  for (const b of blocks) {
    out.push({ id: b.id, type: b.type, props: b.props as DocProps, text: inlineText(b.content), ...(parent ? { parent } : {}) });
    if (b.children.length) readBlocks(b.children as ContextBlock[], b.id, out);
  }
  return out;
}

/** Where a block's text starts and ends in the ProseMirror document. */
export function contentRange(editor: ContextEditor, id: string): { from: number; to: number } | undefined {
  let found: { from: number; to: number } | undefined;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.id !== id || !node.firstChild) return true;
    found = { from: pos + 2, to: pos + 1 + node.firstChild.nodeSize - 1 };
    return false;
  });
  return found;
}

/**
 * The document the fake's agent writes, over the open editor. Its writes stay out of the person's
 * undo history, so ⌘Z never takes back what the agent wrote. (With the Phase 2 server the agent is
 * its own Yjs peer and this goes away.)
 */
export function editorWriter(editor: ContextEditor): ContextDocWriter {
  const quiet = <T>(fn: () => T): T =>
    editor.transact((tr) => {
      tr.setMeta("addToHistory", false);
      return fn();
    });
  const partial = (b: NewDocBlock) => ({ type: b.type, props: b.props ?? {}, ...(b.text ? { content: b.text } : {}) }) as never;
  return {
    read: () => readBlocks(editor.document),
    insert(block: NewDocBlock, place: DocPlace): string {
      return quiet(() => {
        const doc = editor.document;
        if (place !== "end" && "parent" in place) {
          const parent = editor.getBlock(place.parent);
          const last = parent?.children.at(-1);
          if (last) return editor.insertBlocks([partial(block)], last.id, "after")[0]!.id as string;
          if (parent) return (editor.updateBlock(parent.id, { children: [partial(block)] } as never).children.at(-1)?.id ?? "") as string;
        }
        const ref = place !== "end" && "after" in place ? place.after : place !== "end" && "before" in place ? place.before : doc.at(-1)!.id;
        const where = place !== "end" && "before" in place ? "before" : "after";
        return editor.insertBlocks([partial(block)], editor.getBlock(ref) ? ref : doc.at(-1)!.id, where)[0]!.id as string;
      });
    },
    appendText(id: string, text: string): void {
      const range = contentRange(editor, id);
      if (!range) return;
      editor.transact((tr) => {
        tr.setMeta("addToHistory", false);
        tr.insertText(text, range.to);
      });
    },
    update(id: string, patch: { type?: string; props?: DocProps; text?: string }): void {
      if (!editor.getBlock(id)) return;
      quiet(() => editor.updateBlock(id, { ...(patch.type ? { type: patch.type } : {}), ...(patch.props ? { props: patch.props } : {}), ...(patch.text !== undefined ? { content: patch.text } : {}) } as never));
    },
    remove(id: string): void {
      if (editor.getBlock(id)) quiet(() => editor.removeBlocks([id]));
    },
    onChange: (cb: () => void) => editor.onChange(() => cb()),
  };
}
