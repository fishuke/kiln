/**
 * The Context document on the server: the App's Yjs document, read and written in the shape the
 * page's editor (BlockNote) keeps it in, with no editor and no DOM (ADR-019). This is how the agent
 * peer writes: each call is one small transaction with the given origin, so every connected page
 * sees the text arrive.
 *
 * The shape, per block: a `blockContainer` element with the block's `id`, holding one content
 * element named after the block's type (its attributes are the block's props, its one `XmlText`
 * child is the text) and, when the block has children, a `blockGroup` of their containers. The
 * document's root fragment holds one `blockGroup`.
 * apps/web/src/components/studio/context/ydoc.test.ts checks this file against the real editor.
 */
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { QUESTION_BLOCK, TYPED_FRAGMENTS, type ContextDocWriter, type DocBlock, type DocPlace, type DocProps, type NewDocBlock } from "./context-doc";

/** The name of the Context's fragment in the App's Yjs document. */
export const CONTEXT_FRAGMENT = "context";

const TEXT_DEFAULTS: DocProps = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const FRAGMENT_DEFAULTS: DocProps = { by: "", at: "", route: "", selector: "", source: "" };
const QUESTION_DEFAULTS: DocProps = { questionId: "", spec: "", status: "open", answer: "", by: "", at: "", batch: "", index: 0, total: 1, turn: "" };
const TYPED = new Set<string>(TYPED_FRAGMENTS);

/** The props a block of this type always carries, as the editor's schema declares them. */
export function defaultProps(type: string): DocProps {
  if (TYPED.has(type)) return { ...FRAGMENT_DEFAULTS };
  if (type === QUESTION_BLOCK) return { ...QUESTION_DEFAULTS };
  if (type === "heading") return { ...TEXT_DEFAULTS, level: 1, isToggleable: false };
  if (type === "checkListItem") return { ...TEXT_DEFAULTS, checked: false };
  if (type === "numberedListItem") return { ...TEXT_DEFAULTS };
  return { ...TEXT_DEFAULTS };
}

/** Block types the agent's tools may write. Anything else in the document is a person's, and is only read. */
export const WRITABLE_BLOCKS: readonly string[] = ["paragraph", "heading", "checkListItem", "bulletListItem", QUESTION_BLOCK, ...TYPED_FRAGMENTS];

const isElement = (n: unknown): n is Y.XmlElement => n instanceof Y.XmlElement;

function textOf(content: Y.XmlElement): string {
  let out = "";
  for (const child of content.toArray()) {
    if (child instanceof Y.XmlText) for (const op of child.toDelta() as { insert?: unknown }[]) out += typeof op.insert === "string" ? op.insert : "";
  }
  return out;
}

function contentElement(type: string, props: DocProps, text: string): Y.XmlElement {
  const el = new Y.XmlElement(type);
  for (const [k, v] of Object.entries({ ...defaultProps(type), ...props })) el.setAttribute(k, v as never);
  if (text && type !== QUESTION_BLOCK) {
    const t = new Y.XmlText();
    t.insert(0, text);
    el.insert(0, [t]);
  }
  return el;
}

/** The Context document over a Yjs document. `origin` marks its transactions (the agent, or the person it writes for). */
export class YContextDoc implements ContextDocWriter {
  readonly fragment: Y.XmlFragment;

  constructor(
    readonly doc: Y.Doc,
    private readonly origin: unknown = "agent",
    private readonly newId: () => string = randomUUID,
  ) {
    this.fragment = doc.getXmlFragment(CONTEXT_FRAGMENT);
  }

  /** The root group, made when the document is new. */
  private root(): Y.XmlElement {
    const first = this.fragment.get(0);
    if (isElement(first) && first.nodeName === "blockGroup") return first;
    const group = new Y.XmlElement("blockGroup");
    this.fragment.insert(0, [group]);
    return group;
  }

  private containers(group: Y.XmlElement): Y.XmlElement[] {
    return group.toArray().filter((n): n is Y.XmlElement => isElement(n) && n.nodeName === "blockContainer");
  }

  private parts(container: Y.XmlElement): { content?: Y.XmlElement; children?: Y.XmlElement } {
    const kids = container.toArray().filter(isElement);
    return { content: kids.find((k) => k.nodeName !== "blockGroup"), children: kids.find((k) => k.nodeName === "blockGroup") };
  }

  /** A block's container, the group it is in and its place there. */
  private find(id: string, group: Y.XmlElement = this.rootIfAny()!): { container: Y.XmlElement; group: Y.XmlElement; index: number } | undefined {
    if (!group) return undefined;
    const all = group.toArray();
    for (let index = 0; index < all.length; index += 1) {
      const c = all[index];
      if (!isElement(c) || c.nodeName !== "blockContainer") continue;
      if (c.getAttribute("id") === id) return { container: c, group, index };
      const inner = this.parts(c).children;
      const hit = inner && this.find(id, inner);
      if (hit) return hit;
    }
    return undefined;
  }

  private rootIfAny(): Y.XmlElement | undefined {
    const first = this.fragment.get(0);
    return isElement(first) && first.nodeName === "blockGroup" ? first : undefined;
  }

  read(): DocBlock[] {
    const out: DocBlock[] = [];
    const walk = (group: Y.XmlElement, parent?: string) => {
      for (const c of this.containers(group)) {
        const { content, children } = this.parts(c);
        const id = String(c.getAttribute("id") ?? "");
        if (content && id) out.push({ id, type: content.nodeName, props: content.getAttributes() as DocProps, text: textOf(content), ...(parent ? { parent } : {}) });
        if (children) walk(children, id);
      }
    };
    const root = this.rootIfAny();
    if (root) walk(root);
    return out;
  }

  insert(block: NewDocBlock, place: DocPlace): string {
    const id = this.newId();
    this.doc.transact(() => {
      const container = new Y.XmlElement("blockContainer");
      container.setAttribute("id", id);
      container.insert(0, [contentElement(block.type, block.props ?? {}, block.text ?? "")]);
      const root = this.root();
      if (place !== "end" && "parent" in place) {
        const parent = this.find(place.parent);
        if (parent) {
          let group = this.parts(parent.container).children;
          if (!group) {
            group = new Y.XmlElement("blockGroup");
            parent.container.insert(parent.container.length, [group]);
          }
          group.insert(group.length, [container]);
          return;
        }
      }
      const before = place !== "end" && "before" in place;
      const ref = place === "end" ? undefined : "after" in place ? this.find(place.after) : "before" in place ? this.find(place.before) : undefined;
      if (ref) ref.group.insert(before ? ref.index : ref.index + 1, [container]);
      else root.insert(root.length, [container]);
    }, this.origin);
    return id;
  }

  appendText(id: string, text: string): void {
    const hit = this.find(id);
    const content = hit && this.parts(hit.container).content;
    if (!content || !text) return;
    this.doc.transact(() => {
      const last = content.toArray().findLast((n): n is Y.XmlText => n instanceof Y.XmlText);
      if (last) return last.insert(last.length, text, {});
      const t = new Y.XmlText();
      t.insert(0, text);
      content.insert(content.length, [t]);
    }, this.origin);
  }

  update(id: string, patch: { type?: string; props?: DocProps; text?: string }): void {
    const hit = this.find(id);
    const content = hit && this.parts(hit.container).content;
    if (!hit || !content) return;
    this.doc.transact(() => {
      if (patch.type && patch.type !== content.nodeName) {
        // A block's type is its element's name, which can't change: put a new element in its place.
        const kept = Object.fromEntries(Object.entries(content.getAttributes() as DocProps).filter(([k]) => k in defaultProps(patch.type!)));
        const next = contentElement(patch.type, { ...kept, ...patch.props }, patch.text ?? textOf(content));
        const at = hit.container.toArray().indexOf(content);
        hit.container.delete(at, 1);
        hit.container.insert(at, [next]);
        return;
      }
      for (const [k, v] of Object.entries(patch.props ?? {})) content.setAttribute(k, v as never);
      if (patch.text !== undefined) {
        content.delete(0, content.length);
        if (patch.text) {
          const t = new Y.XmlText();
          t.insert(0, patch.text);
          content.insert(0, [t]);
        }
      }
    }, this.origin);
  }

  remove(id: string): void {
    const hit = this.find(id);
    if (hit) this.doc.transact(() => hit.group.delete(hit.index, 1), this.origin);
  }

  onChange(cb: () => void): () => void {
    const handler = () => cb();
    this.fragment.observeDeep(handler);
    return () => this.fragment.unobserveDeep(handler);
  }
}
