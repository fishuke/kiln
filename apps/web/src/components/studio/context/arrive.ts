import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Text a peer writes (the agent, or a teammate) fades in word by word instead of appearing at
 * once. y-prosemirror applies a remote change by replacing the whole document, so the arrived
 * range comes from diffing the documents before and after, not from the transaction's steps.
 * Our own typing never animates.
 */

/** The meta y-prosemirror sets on a transaction that carries a change from the shared document. */
const Y_SYNC = "y-sync$";
const key = new PluginKey<DecorationSet>("ctx-arrive");
const CLEAR = "clear";

/** One word's fade, then the next word starts a little later; a long passage stays under SPAN ms. */
export const ARRIVE = { duration: 420, step: 28, span: 1400, max: 4000 };

export type Arrived = { from: number; to: number };

/** The range of `after` that differs from `before`, or undefined when nothing was added. */
export function arrivedRange(before: PMNode, after: PMNode): Arrived | undefined {
  const from = before.content.findDiffStart(after.content);
  if (from == null) return undefined;
  const end = before.content.findDiffEnd(after.content);
  if (!end) return undefined;
  // The two ends can overlap when the change repeats text at its edge; the added part is never negative.
  const to = Math.max(end.b, from);
  return to > from ? { from, to } : undefined;
}

/** The words in [from, to) as document ranges, in reading order. */
export function wordsIn(doc: PMNode, { from, to }: Arrived): Arrived[] {
  const out: Arrived[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;
    const t = node.text;
    // The diff's end can stop inside a word ("one" → "one place" shares the final "e"): finish that word.
    const start = Math.max(from, pos);
    let end = Math.min(to, pos + t.length);
    while (end < pos + t.length && /\S/.test(t[end - pos]!)) end++;
    const text = node.text.slice(start - pos, end - pos);
    for (const m of text.matchAll(/\S+\s*/g)) out.push({ from: start + m.index, to: start + m.index + m[0].length });
  });
  return out;
}

function decorate(doc: PMNode, range: Arrived): { set: DecorationSet; ms: number } | undefined {
  const words = wordsIn(doc, range);
  if (!words.length || words.length > ARRIVE.max) return undefined;
  const step = Math.min(ARRIVE.step, ARRIVE.span / words.length);
  const decos = words.map((w, i) => Decoration.inline(w.from, w.to, { class: "ctx-arrive", style: `animation-delay:${Math.round(i * step)}ms` }));
  return { set: DecorationSet.create(doc, decos), ms: Math.round(words.length * step) + ARRIVE.duration };
}

/** The plugin; `enabled` is read on each change, so it can follow "loaded" and reduced motion. */
export function arrivePlugin(enabled: () => boolean): Plugin<DecorationSet> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, set: DecorationSet, before: EditorState, after: EditorState) {
        if (tr.getMeta(key) === CLEAR) return DecorationSet.empty;
        const mapped = set.map(tr.mapping, tr.doc);
        const remote = (tr.getMeta(Y_SYNC) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
        if (!remote || !tr.docChanged || !enabled()) return mapped;
        const range = arrivedRange(before.doc, after.doc);
        const fresh = range && decorate(after.doc, range);
        if (!fresh) return mapped;
        return mapped.add(after.doc, fresh.set.find());
      },
    },
    props: { decorations: (state) => key.getState(state) },
    view: () => ({
      update(view, prev) {
        const set = key.getState(view.state);
        if (!set || set === key.getState(prev) || set === DecorationSet.empty) return;
        // Once the last word has faded in, the decorations go, so the text is plain text again.
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!view.isDestroyed && key.getState(view.state) !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(key, CLEAR));
        }, ARRIVE.span + ARRIVE.duration + 100);
      },
      destroy: () => clearTimeout(timer),
    }),
  });
}
