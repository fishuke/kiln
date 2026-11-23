import type { ContextEditor } from "./schema";

const ADD = "suggestAdd";
const DEL = "suggestDel";

type Node = ContextEditor["prosemirrorState"]["doc"];
type Range = { from: number; to: number };

function ranges(doc: Node, type: string, id: string): Range[] {
  const out: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.some((m) => m.type.name === type && m.attrs.stringValue === id)) return;
    const last = out.at(-1);
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else out.push({ from: pos, to: pos + node.nodeSize });
  });
  return out;
}

/** The ids of every suggestion in the document. */
export function suggestionIds(editor: ContextEditor): string[] {
  const ids = new Set<string>();
  editor.prosemirrorState.doc.descendants((node) => {
    for (const m of node.marks) if (m.type.name === ADD || m.type.name === DEL) ids.add(String(m.attrs.stringValue));
  });
  return [...ids];
}

/**
 * Marks the text the agent was asked about as "would be removed". Like the text that streams in
 * after it, this stays out of undo history: ⌘Z after Accept or Reject brings the suggestion back.
 */
export function startSuggestion(editor: ContextEditor, id: string, range: Range): void {
  editor.transact((tr) => {
    tr.setMeta("addToHistory", false);
    tr.addMark(range.from, range.to, editor.pmSchema.marks[DEL]!.create({ stringValue: id }));
  });
}

/** Where a suggestion is in the document: from the start of what it removes to the end of what it adds. */
export function suggestionRange(editor: ContextEditor, id: string): Range | undefined {
  const doc = editor.prosemirrorState.doc;
  const all = [...ranges(doc, DEL, id), ...ranges(doc, ADD, id)];
  if (!all.length) return undefined;
  return { from: Math.min(...all.map((r) => r.from)), to: Math.max(...all.map((r) => r.to)) };
}

/** Streams the agent's text in right after what it replaces, marked as "would be added". */
export function appendSuggestion(editor: ContextEditor, id: string, text: string): void {
  editor.transact((tr) => {
    const at = ranges(tr.doc, ADD, id).at(-1)?.to ?? ranges(tr.doc, DEL, id).at(-1)?.to;
    if (at === undefined) return;
    tr.setMeta("addToHistory", false);
    tr.insert(at, editor.pmSchema.text(text, [editor.pmSchema.marks[ADD]!.create({ stringValue: id })]));
  });
}

/** Accept keeps the new text and drops the old; Reject does the opposite. One undo step either way. */
export function resolveSuggestion(editor: ContextEditor, id: string, accept: boolean): void {
  editor.transact((tr) => {
    const drop = accept ? DEL : ADD;
    const keep = accept ? ADD : DEL;
    for (const r of ranges(tr.doc, keep, id)) tr.removeMark(r.from, r.to, editor.pmSchema.marks[keep]!);
    for (const r of ranges(tr.doc, drop, id).reverse()) tr.delete(r.from, r.to);
  });
}

/** The text a suggestion would remove and the text it would add. */
export function suggestionText(editor: ContextEditor, id: string): { from: string; to: string } {
  const doc = editor.prosemirrorState.doc;
  const read = (type: string) =>
    ranges(doc, type, id)
      .map((r) => doc.textBetween(r.from, r.to))
      .join("");
  return { from: read(DEL), to: read(ADD) };
}
