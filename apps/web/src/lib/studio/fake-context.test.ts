import { describe, expect, it } from "vitest";
import { MemoryDoc } from "./context-doc";
import { fragmentsFrom, freshness, questionsFrom } from "./context-model";
import { FakeStudioClient } from "./fake";

/** A fake on a manual clock: `run` plays every scheduled step, letting promises settle in between. */
function setup(seed: "empty" | "demo" = "empty") {
  const queue: (() => void)[] = [];
  const fake = new FakeStudioClient({ schedule: (fn) => void queue.push(fn), stepMs: 10, channel: false });
  const appId = fake.seed(seed)!;
  const doc = new MemoryDoc();
  fake.context.attachDocument(appId, doc);
  const run = async () => {
    for (let i = 0; i < 20_000; i += 1) {
      await new Promise((r) => setImmediate(r));
      const next = queue.shift();
      if (!next) return;
      next();
    }
    throw new Error("the fake never settled");
  };
  const questions = () => questionsFrom(appId, doc.read());
  const fragments = () => fragmentsFrom(appId, doc.read());
  const snap = () => fake.context.snapshot(appId);
  return { fake, ctx: fake.context, appId, doc, run, questions, fragments, snap };
}

describe("the scripted agent on the Context", () => {
  it("asks three questions of different kinds after the first prompt and waits", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box where I can search my recipes by ingredient");
    await t.run();
    const qs = t.questions();
    expect(qs).toHaveLength(3);
    expect(new Set(qs.map((q) => q.spec.kind)).size).toBe(3);
    expect(qs.every((q) => q.status === "open")).toBe(true);
    const s = await t.snap();
    expect(s.agent.state).toBe("waiting");
    expect(s.turns.at(-1)).toMatchObject({ kind: "prompt", status: "needs_you" });
    expect(t.fragments().some((f) => f.type === "section")).toBe(true);
    expect(freshness(s.state, s.changes)).toEqual({ kind: "never" });
  });

  it("records each answer as a decision, writes the Context and builds once the batch is answered", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box where I can search my recipes by ingredient");
    await t.run();
    const [a, b, c] = t.questions();
    await t.ctx.answer(t.appId, a!.id, { type: "value", value: (a!.spec as { options: { id: string }[] }).options[0]!.id });
    await t.run();
    expect(t.questions()[0]).toMatchObject({ status: "answered", answeredBy: "you@example.com" });
    expect((await t.snap()).agent.state).toBe("waiting");
    expect(t.fragments().filter((f) => f.type === "requirement")).toHaveLength(0);

    await t.ctx.answer(t.appId, b!.id, { type: "delegated" });
    await t.ctx.answer(t.appId, c!.id, { type: "skipped" });
    await t.run();
    expect(t.questions().map((q) => q.status)).toEqual(["answered", "delegated", "skipped"]);
    const types = new Set(t.fragments().map((f) => f.type));
    for (const type of ["decision", "assumption", "requirement", "constraint", "flow", "risk", "metric"] as const) expect(types.has(type)).toBe(true);
    const s = await t.snap();
    expect(s.agent.state).toBe("idle");
    expect(s.state.builtVersion).toBe(s.state.version);
    expect(freshness(s.state, s.changes)).toEqual({ kind: "fresh" });
    expect((await t.ctx.preview(t.appId)).url).toContain("n=");
  });

  it("refuses an answer that does not fit the question", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box");
    await t.run();
    await expect(t.ctx.answer(t.appId, t.questions()[0]!.id, { type: "value", value: "nope" })).rejects.toThrow("Pick one of the options");
  });

  it("goes stale after a later edit and clears when the prototype is updated", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box");
    await t.run();
    await t.ctx.continueQuestions(t.appId);
    await t.run();
    expect(t.questions().every((q) => q.status === "delegated")).toBe(true);
    const requirement = t.fragments().find((f) => f.type === "requirement")!;
    t.doc.update(requirement.id, { text: "Recipes can be searched by ingredient and by tag" });
    await t.run();
    let s = await t.snap();
    expect(freshness(s.state, s.changes)).toMatchObject({ kind: "behind", count: 1, fragments: [{ id: requirement.id, change: "edited" }] });
    await t.ctx.build(t.appId);
    await t.run();
    s = await t.snap();
    expect(freshness(s.state, s.changes)).toEqual({ kind: "fresh" });
    expect(s.turns.at(-1)).toMatchObject({ kind: "build", status: "succeeded" });
  });

  it("lets an answer be changed, and rewrites what was built on it", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box");
    await t.run();
    await t.ctx.continueQuestions(t.appId);
    await t.run();
    const q = t.questions()[0]!;
    const before = t.fragments().find((f) => f.type === "requirement")!.content;
    await t.ctx.reopen(t.appId, q.id);
    expect(t.questions()[0]!.status).toBe("open");
    await t.ctx.answer(t.appId, q.id, { type: "other", text: "My cooking club" });
    await t.run();
    expect(t.questions()[0]).toMatchObject({ status: "answered", answer: { type: "other", text: "My cooking club" } });
    expect(t.fragments().find((f) => f.type === "requirement")!.content).not.toBe(before);
    const s = await t.snap();
    expect(freshness(s.state, s.changes).kind).toBe("behind");
  });

  it("turns a viewer's prompt and answer into proposals an editor decides", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box");
    await t.run();
    const blocks = t.doc.read().length;
    const viewer = t.ctx.identities().find((m) => m.permission === "viewer")!;
    t.ctx.setIdentity(viewer.user);
    expect((await t.snap()).me.permission).toBe("viewer");

    const first = await t.ctx.answer(t.appId, t.questions()[0]!.id, { type: "delegated" });
    expect(first.proposal).toMatchObject({ kind: "answer", status: "open", by: viewer.user });
    expect(t.questions()[0]!.status).toBe("open");

    await t.ctx.prompt(t.appId, "Add a way to export recipes as a PDF");
    await t.run();
    expect(t.doc.read()).toHaveLength(blocks);
    const open = (await t.snap()).proposals.filter((p) => p.status === "open");
    expect(open.map((p) => p.kind).sort()).toEqual(["add", "answer"]);
    await expect(t.ctx.decideProposal(t.appId, open[0]!.id, "accept")).rejects.toThrow("an editor decides");
    await expect(t.ctx.reopen(t.appId, t.questions()[0]!.id)).rejects.toThrow("Viewers");

    t.ctx.setIdentity("you@example.com");
    const add = open.find((p) => p.kind === "add")!;
    await t.ctx.decideProposal(t.appId, add.id, "accept");
    expect(t.fragments().filter((f) => f.type === "requirement").map((f) => f.content)).toEqual(["Add a way to export recipes as a PDF."]);
    const answer = open.find((p) => p.kind === "answer")!;
    await t.ctx.decideProposal(t.appId, answer.id, "reject", "Let me pick");
    expect(t.questions()[0]!.status).toBe("open");
    expect((await t.snap()).proposals.map((p) => p.status).sort()).toEqual(["accepted", "rejected"]);
  });

  it("streams a rewrite for Ask the agent without touching the document", async () => {
    const t = setup();
    const chunks: string[] = [];
    const done = t.ctx.askAgent(t.appId, { text: "Users should be able to find a recipe", instruction: "Make it shorter" }, (c) => chunks.push(c));
    await t.run();
    const { text } = await done;
    expect(chunks.join("")).toBe(text);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("Users should be able to find a recipe");
    expect(t.doc.read()).toHaveLength(0);
  });

  it("stops a run", async () => {
    const t = setup();
    await t.ctx.prompt(t.appId, "A recipe box");
    await t.ctx.stop(t.appId);
    await t.run();
    const s = await t.snap();
    expect(s.agent.state).toBe("idle");
    expect(s.turns.at(-1)!.status).toBe("cancelled");
    expect(t.questions()).toHaveLength(0);
  });

  it("seeds a written Context whose Brief a newcomer can read", async () => {
    const t = setup("demo");
    await t.run();
    expect(t.fragments().length).toBeGreaterThan(8);
    const s = await t.snap();
    expect(freshness(s.state, s.changes)).toEqual({ kind: "fresh" });
    expect(s.members.map((m) => m.permission).sort()).toEqual(["editor", "owner", "viewer"]);
    const brief = await t.ctx.brief(t.appId);
    expect(brief.lines).toHaveLength(5);
    expect(brief.version).toBe(s.state.version);
  });
});
