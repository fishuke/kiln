import { describe, expect, it } from "vitest";
import { MemoryDoc, questionFromBlock, questionProps, QUESTION_BLOCK } from "./context-doc";
import { Fragment, Member, Proposal, Question, QuestionAnswer, QuestionSpec } from "./context-types";

const options = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }));

describe("QuestionSpec", () => {
  it("takes each kind the page renders", () => {
    const specs = [
      { kind: "single", title: "Who is it for?", options: options(3) },
      { kind: "multi", title: "What is in?", options: options(4), min: 1, max: 3 },
      { kind: "boolean", title: "Offline?", yes: "Yes", no: "No" },
      { kind: "scale", title: "How strict?", min: 1, max: 5, minLabel: "Loose", maxLabel: "Strict" },
      { kind: "rank", title: "Order these", options: options(3) },
      { kind: "text", title: "Name it" },
      { kind: "sketch", title: "Which layout?", options: options(2).map((o) => ({ ...o, layout: "grid" })) },
    ];
    for (const s of specs) expect(QuestionSpec.safeParse(s).success, s.kind).toBe(true);
  });

  it("refuses more than four options, fewer than two, an unknown kind, markup in place of a layout, and no title", () => {
    expect(QuestionSpec.safeParse({ kind: "single", title: "Pick", options: options(5) }).success).toBe(false);
    expect(QuestionSpec.safeParse({ kind: "single", title: "Pick", options: options(1) }).success).toBe(false);
    expect(QuestionSpec.safeParse({ kind: "html", title: "Pick", html: "<b>x</b>" }).success).toBe(false);
    expect(QuestionSpec.safeParse({ kind: "sketch", title: "Layout", options: options(2).map((o) => ({ ...o, layout: "<svg/>" })) }).success).toBe(false);
    expect(QuestionSpec.safeParse({ kind: "text", title: "" }).success).toBe(false);
  });
});

describe("the other Context shapes", () => {
  it("parse what the server stores", () => {
    expect(QuestionAnswer.parse({ type: "value", value: ["a", "b"] })).toEqual({ type: "value", value: ["a", "b"] });
    expect(QuestionAnswer.safeParse({ type: "value" }).success).toBe(false);
    expect(Member.safeParse({ appId: "sa_1", user: "ada@example.com", name: "Ada", permission: "admin", role: "design", invitedBy: "x" }).success).toBe(false);
    expect(Member.parse({ appId: "sa_1", user: "ada@example.com", name: "Ada", permission: "viewer", role: "design", invitedBy: "x" }).permission).toBe("viewer");
    expect(Proposal.safeParse({ id: "sp_1", appId: "sa_1", by: "sam", kind: "rewrite", summary: "x", patch: {}, status: "open", at: "2026-11-23T10:00:00Z" }).success).toBe(false);
    expect(Fragment.safeParse({ id: "b1", appId: "sa_1", type: "requirement", ownerRole: "marketing", reviewerRoles: [], content: "x", version: 1, provenance: [] }).success).toBe(false);
  });
});

describe("a question in the document", () => {
  it("survives the round trip through a block's props", () => {
    const q = Question.parse({
      id: "sq_1",
      appId: "sa_1",
      chatId: "main",
      turnId: "st_1",
      fragmentId: "b1",
      spec: { kind: "single", title: "Who is it for?", options: options(2) },
      status: "answered",
      answer: { type: "value", value: "o1" },
      answeredBy: "ada@example.com",
      answeredAt: "2026-11-23T10:00:00.000Z",
      batch: { id: "sb_1", index: 0, total: 2 },
    });
    const doc = new MemoryDoc();
    const id = doc.insert({ type: QUESTION_BLOCK, props: questionProps(q) }, "end");
    const block = doc.read().find((b) => b.id === id)!;
    expect(questionFromBlock("sa_1", block)).toEqual({ ...q, fragmentId: id });
    expect(questionFromBlock("sa_1", { ...block, props: { ...block.props, spec: "{not json" } })).toBeUndefined();
    expect(questionFromBlock("sa_1", { ...block, type: "paragraph" })).toBeUndefined();
  });
});

describe("MemoryDoc", () => {
  it("places blocks after, before and under another, and removes a block with its children", () => {
    const doc = new MemoryDoc();
    const a = doc.insert({ type: "heading", text: "A" }, "end");
    const c = doc.insert({ type: "paragraph", text: "C" }, { after: a });
    const b = doc.insert({ type: "paragraph", text: "B" }, { before: c });
    const child = doc.insert({ type: "paragraph", text: "B1" }, { parent: b });
    expect(doc.read().map((x) => x.text)).toEqual(["A", "B", "B1", "C"]);
    expect(doc.read().find((x) => x.id === child)?.parent).toBe(b);
    let changes = 0;
    doc.onChange(() => (changes += 1));
    doc.appendText(c, "!");
    doc.update(c, { type: "requirement", props: { ownerRole: "qa" } });
    doc.remove(b);
    expect(doc.read().map((x) => `${x.type}:${x.text}`)).toEqual(["heading:A", "requirement:C!"]);
    expect(changes).toBe(3);
  });
});
