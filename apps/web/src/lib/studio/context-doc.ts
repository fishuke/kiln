/**
 * The Context document as plain data: what the agent's tools read and write, and what fragments and
 * questions are derived from. The page implements `ContextDocWriter` over the BlockNote editor; the
 * fake's scripted agent and the tests use it without a browser (docs/specs/studio-context.md).
 */
import { QuestionAnswer, QuestionSpec, type Question, type QuestionStatus } from "./types";

/** Block types the Context adds to BlockNote's own; each is a typed fragment with inline text. */
export const TYPED_FRAGMENTS = ["requirement", "decision", "assumption", "constraint", "flow", "risk", "metric"] as const;
export type TypedFragment = (typeof TYPED_FRAGMENTS)[number];
export const QUESTION_BLOCK = "question";

export type DocProps = Record<string, string | number | boolean>;
/** One block of the document, flattened: nesting is `parent`. */
export type DocBlock = { id: string; type: string; props: DocProps; text: string; parent?: string };
export type NewDocBlock = { type: string; props?: DocProps; text?: string };
export type DocPlace = { after: string } | { before: string } | { parent: string } | "end";

export interface ContextDocWriter {
  /** Every block in document order. */
  read(): DocBlock[];
  /** Inserts a block and returns its id. */
  insert(block: NewDocBlock, place: DocPlace): string;
  /** Adds text at the end of a block, as typing would. */
  appendText(id: string, text: string): void;
  update(id: string, patch: { type?: string; props?: DocProps; text?: string }): void;
  remove(id: string): void;
  /** Calls `cb` after any change, by anyone. */
  onChange(cb: () => void): () => void;
}

/** A question block's props: the spec and the answer travel in the document as JSON. */
export function questionProps(q: Pick<Question, "id" | "spec" | "status" | "answer" | "answeredBy" | "answeredAt" | "batch" | "turnId">): DocProps {
  return {
    questionId: q.id,
    spec: JSON.stringify(q.spec),
    status: q.status,
    answer: q.answer ? JSON.stringify(q.answer) : "",
    by: q.answeredBy ?? "",
    at: q.answeredAt ?? "",
    batch: q.batch.id,
    index: q.batch.index,
    total: q.batch.total,
    turn: q.turnId,
  };
}

function json(text: unknown): unknown {
  if (typeof text !== "string" || !text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The question a block holds, or undefined when it isn't a question block or its props don't parse. */
export function questionFromBlock(appId: string, block: Pick<DocBlock, "id" | "type" | "props">): Question | undefined {
  if (block.type !== QUESTION_BLOCK) return undefined;
  const spec = QuestionSpec.safeParse(json(block.props.spec));
  if (!spec.success) return undefined;
  const answer = QuestionAnswer.safeParse(json(block.props.answer));
  const p = block.props;
  return {
    id: String(p.questionId || block.id),
    appId,
    chatId: "main",
    turnId: String(p.turn ?? ""),
    fragmentId: block.id,
    spec: spec.data,
    status: (["open", "answered", "skipped", "delegated"].includes(String(p.status)) ? p.status : "open") as QuestionStatus,
    answer: answer.success ? answer.data : undefined,
    answeredBy: p.by ? String(p.by) : undefined,
    answeredAt: p.at ? String(p.at) : undefined,
    batch: { id: String(p.batch ?? ""), index: Number(p.index ?? 0), total: Number(p.total ?? 1) },
  };
}

/** A document in memory, for the fake's tests and for runs with no browser. */
export class MemoryDoc implements ContextDocWriter {
  private blocks: DocBlock[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  read(): DocBlock[] {
    return this.blocks.map((b) => ({ ...b, props: { ...b.props } }));
  }

  insert(block: NewDocBlock, place: DocPlace): string {
    this.seq += 1;
    const id = `b${this.seq}`;
    const next: DocBlock = { id, type: block.type, props: { ...block.props }, text: block.text ?? "" };
    let at = this.blocks.length;
    if (place !== "end") {
      if ("after" in place) {
        const i = this.blocks.findIndex((b) => b.id === place.after);
        if (i >= 0) {
          at = i + 1;
          next.parent = this.blocks[i]!.parent;
        }
      } else if ("before" in place) {
        const i = this.blocks.findIndex((b) => b.id === place.before);
        if (i >= 0) {
          at = i;
          next.parent = this.blocks[i]!.parent;
        }
      } else {
        const i = this.blocks.findIndex((b) => b.id === place.parent);
        if (i >= 0) {
          at = i + 1;
          while (at < this.blocks.length && this.blocks[at]!.parent === place.parent) at += 1;
          next.parent = place.parent;
        }
      }
    }
    this.blocks.splice(at, 0, next);
    this.emit();
    return id;
  }

  appendText(id: string, text: string): void {
    const b = this.blocks.find((x) => x.id === id);
    if (!b) return;
    b.text += text;
    this.emit();
  }

  update(id: string, patch: { type?: string; props?: DocProps; text?: string }): void {
    const b = this.blocks.find((x) => x.id === id);
    if (!b) return;
    if (patch.type) b.type = patch.type;
    if (patch.props) b.props = { ...b.props, ...patch.props };
    if (patch.text !== undefined) b.text = patch.text;
    this.emit();
  }

  remove(id: string): void {
    this.blocks = this.blocks.filter((b) => b.id !== id && b.parent !== id);
    this.emit();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}
