import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, StepMap } from "@tiptap/pm/transform";
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

/**
 * Each word fades in over `duration`, `step` after the one before (about 11 words a second, close
 * to reading pace); a block without text of its own (a question card) fades up and counts as
 * `block` words. What arrives while earlier words are still appearing waits its turn;
 * when more than `backlog` is waiting, new text starts sooner so the page never lags far behind.
 */
export const ARRIVE = { duration: 750, step: 90, block: 6, backlog: 6000, max: 4000 };

export type Arrived = { from: number; to: number };

/** Where `after` differs from `before`: from `from`, `before` had up to `a` and `after` has up to `b`. */
export function changed(before: PMNode, after: PMNode): { from: number; a: number; b: number } | undefined {
  const from = before.content.findDiffStart(after.content);
  if (from == null) return undefined;
  const end = before.content.findDiffEnd(after.content) ?? { a: before.content.size, b: after.content.size };
  // The two ends can overlap the start when the change repeats text at its edge; move both back.
  const over = Math.max(0, from - Math.min(end.a, end.b));
  return { from, a: end.a + over, b: end.b + over };
}

/** The range of `after` that differs from `before`, or undefined when nothing was added. */
export function arrivedRange(before: PMNode, after: PMNode): Arrived | undefined {
  const c = changed(before, after);
  return c && c.b > c.from ? { from: c.from, to: c.b } : undefined;
}

/** A word, or a whole block with no text of its own (a question card), that arrived. */
export type Piece = Arrived & { block?: boolean };

/** The words (and text-less blocks) in [from, to) as document ranges, in reading order. */
export function wordsIn(doc: PMNode, { from, to }: Arrived): Piece[] {
  const out: Piece[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.isLeaf) {
      if (pos >= from && pos + node.nodeSize <= to) out.push({ from: pos, to: pos + node.nodeSize, block: true });
      return false;
    }
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

/** When each piece of a batch starts, in ms from now, given how much is still waiting (`waiting` ms). */
export function schedule(pieces: number | Piece[], waiting: number): { delays: number[]; length: number } {
  const list: Piece[] = typeof pieces === "number" ? Array.from({ length: pieces }, () => ({ from: 0, to: 0 })) : pieces;
  let at = Math.min(Math.max(0, waiting), ARRIVE.backlog);
  const delays = list.map((p) => {
    const d = Math.round(at);
    at += (p.block ? ARRIVE.block : 1) * ARRIVE.step;
    return d;
  });
  return { delays, length: at };
}

/** A piece that starts fading in at `start` (a Date.now() time). */
const word = (p: Piece, start: number, now: number) => {
  const style = `animation-delay:${Math.round(start - now)}ms`;
  return p.block
    ? Decoration.node(p.from, p.to, { class: "ctx-arrive-block", style }, { start, block: true })
    : Decoration.inline(p.from, p.to, { class: "ctx-arrive", style }, { start });
};

/** The plugin; `enabled` is read on each change, so it can follow "loaded" and reduced motion. */
export function arrivePlugin(enabled: () => boolean): Plugin<DecorationSet> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the last word queued so far starts (a Date.now() time). */
  let queueEnd = 0;
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, set: DecorationSet, before: EditorState, after: EditorState) {
        if (tr.getMeta(key) === CLEAR) return DecorationSet.empty;
        const remote = (tr.getMeta(Y_SYNC) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
        if (!remote || !tr.docChanged) return set.map(tr.mapping, tr.doc);
        // A remote change replaces the whole document, which would drop every word still waiting to
        // appear; map them through the part that really changed instead.
        const c = changed(before.doc, after.doc);
        if (!c) return set;
        const now = Date.now();
        // The editor redraws a paragraph whose text changed, which restarts its words' animations;
        // each word keeps its start time, so its delay is worked out again (negative once it began).
        const kept = set
          .map(new Mapping([new StepMap([c.from, c.a - c.from, c.b - c.from])]), tr.doc)
          .find()
          .flatMap((d) => {
            const { start, block } = d.spec as { start: number; block?: boolean };
            return start + ARRIVE.duration < now ? [] : [word({ from: d.from, to: d.to, block }, start, now)];
          });
        const words = enabled() && c.b > c.from ? wordsIn(after.doc, { from: c.from, to: c.b }) : [];
        if (words.length > ARRIVE.max) words.length = 0;
        const { delays, length } = schedule(words, queueEnd - now);
        if (words.length) queueEnd = now + length;
        return DecorationSet.create(after.doc, [...kept, ...words.map((w, i) => word(w, now + delays[i]!, now))]);
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
        }, Math.max(0, queueEnd - Date.now()) + ARRIVE.duration + 100);
      },
      destroy: () => clearTimeout(timer),
    }),
  });
}
