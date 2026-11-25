import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { fragmentsFrom, freshness, questionsFrom } from "@/lib/studio/context-model";
import { FakeStudioClient } from "@/lib/studio/fake";
import { contentRange, editorWriter, readBlocks } from "./doc-writer";
import { contextSchema, type ContextBlock, type ContextEditor } from "./schema";
import { appendSuggestion, resolveSuggestion, startSuggestion, suggestionIds, suggestionRange, suggestionText } from "./suggestions";

const create = () => BlockNoteEditor.create({ schema: contextSchema }) as unknown as ContextEditor;
const read = (editor: ContextEditor) => readBlocks(editor.document as ContextBlock[]);
const texts = (editor: ContextEditor) =>
  read(editor)
    .filter((b) => b.text)
    .map((b) => `${b.type}:${b.text}`);

describe("editorWriter over the BlockNote editor", () => {
  it("inserts at the end, after, before and under a parent, and reads nesting as parent", () => {
    const editor = create();
    const w = editorWriter(editor);
    const a = w.insert({ type: "heading", props: { level: 2 }, text: "Requirements" }, "end");
    const c = w.insert({ type: "requirement", text: "Third" }, { after: a });
    const b = w.insert({ type: "requirement", text: "Second" }, { before: c });
    const child = w.insert({ type: "paragraph", text: "A detail" }, { parent: b });
    const sibling = w.insert({ type: "paragraph", text: "Another detail" }, { parent: b });
    expect(texts(editor)).toEqual(["heading:Requirements", "requirement:Second", "paragraph:A detail", "paragraph:Another detail", "requirement:Third"]);
    const blocks = read(editor);
    expect(blocks.find((x) => x.id === child)?.parent).toBe(b);
    expect(blocks.find((x) => x.id === sibling)?.parent).toBe(b);
    expect(blocks.find((x) => x.id === c)?.parent).toBeUndefined();
  });

  it("appends text as typing would, updates type, props and text, and removes", () => {
    const editor = create();
    const w = editorWriter(editor);
    const id = w.insert({ type: "requirement", props: { by: "agent" } }, "end");
    w.appendText(id, "People can ");
    w.appendText(id, "search.");
    expect(read(editor).find((b) => b.id === id)).toMatchObject({ type: "requirement", text: "People can search.", props: { by: "agent" } });
    w.update(id, { type: "constraint", props: { route: "/" } });
    expect(read(editor).find((b) => b.id === id)).toMatchObject({ type: "constraint", text: "People can search.", props: { by: "agent", route: "/" } });
    w.update(id, { text: "Replaced." });
    expect(read(editor).find((b) => b.id === id)?.text).toBe("Replaced.");
    // Clearing a block before rewriting it leaves nothing of the old text behind.
    w.update(id, { text: "" });
    expect(read(editor).find((b) => b.id === id)?.text).toBe("");
    w.appendText(id, "Rewritten.");
    expect(read(editor).find((b) => b.id === id)?.text).toBe("Rewritten.");
    w.remove(id);
    expect(read(editor).some((b) => b.id === id)).toBe(false);
    w.appendText(id, "ignored");
    w.update("nope", { text: "ignored" });
  });

  it("tells its listeners about every change", () => {
    const editor = create();
    const w = editorWriter(editor);
    let n = 0;
    const off = w.onChange(() => (n += 1));
    const id = w.insert({ type: "risk", text: "It breaks" }, "end");
    w.appendText(id, " often");
    expect(n).toBeGreaterThanOrEqual(2);
    off();
    const was = n;
    w.remove(id);
    expect(n).toBe(was);
  });
});

describe("the scripted agent writing the real document", () => {
  it("goes from a first prompt to answered questions, a written Context and a built prototype", async () => {
    const queue: (() => void)[] = [];
    const fake = new FakeStudioClient({ schedule: (fn) => void queue.push(fn), stepMs: 10, channel: false });
    const appId = fake.seed("empty")!;
    const editor = create();
    fake.context.attachDocument(appId, editorWriter(editor));
    const run = async () => {
      for (let i = 0; i < 20_000; i += 1) {
        await new Promise((r) => setImmediate(r));
        const next = queue.shift();
        if (!next) return;
        next();
      }
      throw new Error("the fake never settled");
    };

    await fake.context.prompt(appId, "A recipe box where I can search my recipes by ingredient");
    await run();
    const asked = questionsFrom(appId, read(editor));
    expect(asked.map((q) => q.spec.kind)).toEqual(["text", "single", "multi", "scale"]);
    expect(read(editor)[0]).toMatchObject({ type: "heading", text: "Recipe box" });
    expect((await fake.context.snapshot(appId)).agent.state).toBe("waiting");

    await fake.context.answer(appId, asked[0]!.id, { type: "value", value: "My recipes are spread over screenshots and notes." });
    await fake.context.answer(appId, asked[1]!.id, { type: "value", value: "me" });
    await fake.context.answer(appId, asked[2]!.id, { type: "value", value: ["search", "tags"] });
    await fake.context.answer(appId, asked[3]!.id, { type: "delegated" });
    await run();

    const fragments = fragmentsFrom(appId, read(editor));
    const types = new Set(fragments.map((f) => f.type));
    for (const t of ["section", "decision", "assumption", "requirement", "constraint", "flow", "risk", "metric"] as const) expect(types.has(t), t).toBe(true);
    expect(fragments.filter((f) => f.type === "requirement").map((f) => f.content)).toContain("Search matches recipe titles and ingredients as you type.");
    // Every section the agent wrote under still has its heading before its fragments.
    const order = read(editor).filter((b) => b.type === "heading" || b.type === "requirement");
    expect(order.findIndex((b) => b.text === "Requirements")).toBeLessThan(order.findIndex((b) => b.type === "requirement"));
    const s = await fake.context.snapshot(appId);
    expect(s.agent.state).toBe("idle");
    expect(freshness(s.state, s.changes)).toEqual({ kind: "fresh" });

    // An edit by hand puts the prototype behind; Update clears it.
    const target = fragments.find((f) => f.type === "requirement")!;
    editor.updateBlock(target.id, { content: "Search also matches tags." } as never);
    await run();
    const behind = await fake.context.snapshot(appId);
    expect(freshness(behind.state, behind.changes)).toMatchObject({ kind: "behind", count: 1 });
    await fake.context.build(appId);
    await run();
    const after = await fake.context.snapshot(appId);
    expect(freshness(after.state, after.changes)).toEqual({ kind: "fresh" });
  });
});

describe("Ask the agent's suggestions", () => {
  function withSuggestion() {
    const editor = create();
    const w = editorWriter(editor);
    const id = w.insert({ type: "requirement", text: "People should be able to search." }, "end");
    const range = contentRange(editor, id)!;
    startSuggestion(editor, "s1", range);
    appendSuggestion(editor, "s1", "People can ");
    appendSuggestion(editor, "s1", "search.");
    return { editor, id };
  }

  it("marks the old text and streams the new text in after it", () => {
    const { editor, id } = withSuggestion();
    expect(suggestionIds(editor)).toEqual(["s1"]);
    expect(suggestionText(editor, "s1")).toEqual({ from: "People should be able to search.", to: "People can search." });
    const whole = contentRange(editor, id)!;
    expect(suggestionRange(editor, "s1")).toEqual(whole);
    // The new text is a word of its own, so the editor never reads "search.People" as a link.
    expect(read(editor).find((b) => b.id === id)?.text).toBe("People should be able to search. People can search.");
  });

  it("Accept keeps the new text; Reject keeps the old", () => {
    const a = withSuggestion();
    resolveSuggestion(a.editor, "s1", true);
    expect(read(a.editor).find((b) => b.id === a.id)?.text).toBe("People can search.");
    expect(suggestionIds(a.editor)).toEqual([]);

    const r = withSuggestion();
    resolveSuggestion(r.editor, "s1", false);
    expect(read(r.editor).find((b) => b.id === r.id)?.text).toBe("People should be able to search.");
    expect(suggestionIds(r.editor)).toEqual([]);
  });

  it("suggests on part of a block and leaves the rest alone", () => {
    const editor = create();
    const id = editorWriter(editor).insert({ type: "paragraph", text: "Keep this. Change this." }, "end");
    const range = contentRange(editor, id)!;
    startSuggestion(editor, "s2", { from: range.from + 11, to: range.to });
    appendSuggestion(editor, "s2", "Changed.");
    resolveSuggestion(editor, "s2", true);
    expect(read(editor).find((b) => b.id === id)?.text).toBe("Keep this. Changed.");
  });
});
