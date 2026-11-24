import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { FakeSandboxProvider } from "@kiln/sandbox/testing";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { AppDefinitions } from "./app-definitions";
import { fragmentsFrom, freshness, questionsFrom } from "./context-model";
import { CONTEXT_NOTES, ContextService, type ContextEvent, type ContextPerson } from "./context-service";
import { YContextDoc } from "./context-ydoc";
import { studioEngineHooks, studioRuns } from "./engine-port";
import { Studio } from "./studio";

const open: { studio: Studio; ctx: ContextService }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.ctx.shutdown();
    await o.studio.shutdown();
  }
});

type Script = (prompt: string, tool: (name: string, input?: unknown) => Promise<unknown>) => Promise<void>;

/** A Studio with a Context service, and an agent whose turns are `script`: it calls the Context tools as a run would. */
async function make(script: Script = async () => undefined) {
  let studio!: Studio;
  let ctx!: ContextService;
  let appId = "";
  const prompts: string[] = [];
  const harness = new FakeHarness(async ({ opts, emit }) => {
    prompts.push(opts.prompt);
    // As the API does for a run's token: the turn is the run's, the person is who prompted it.
    const chat = studio.getApp(appId)!.chats.at(-1)!;
    const turn = studio.getChat(chat.id)!.turns.at(-1)!;
    const who = people[turn.by] ?? ada;
    await script(opts.prompt, async (name, input) => {
      const r = await ctx.tool(appId, who, name, input, { id: turn.id });
      emit({ type: "message", text: JSON.stringify(r) });
      return r;
    });
    emit({ type: "message", text: "done" });
  });
  let t = Date.parse("2026-11-24T10:00:00Z");
  const clock = { now: () => new Date((t += 1000)) };
  const { kiln } = createTestKiln({ harness: () => harness, ...studioEngineHooks(() => studio) });
  studio = new Studio({
    store: kiln.store,
    objects: kiln.objects,
    bus: kiln.bus,
    clock,
    sandboxes: new FakeSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-studio-context-"))),
    definitions: new AppDefinitions({ store: kiln.store, clock }),
    runs: studioRuns(kiln.runs),
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 60", egress: [] } },
    image: "kiln-runner-studio:test",
    previewUrl: (target) => `https://${target}.preview.test`,
  });
  const timers: (() => void)[] = [];
  const service = () => new ContextService({ store: kiln.store, objects: kiln.objects, bus: kiln.bus, clock, studio, schedule: (fn) => (timers.push(fn), () => undefined) });
  ctx = service();
  open.push({ studio, ctx });
  const team = kiln.teams.ensureDefaultTeam().id;
  const ada: ContextPerson = { user: "ada@x.test", name: "Ada", team, mayWrite: true };
  const sam: ContextPerson = { user: "sam@x.test", name: "Sam", team, mayWrite: false };
  const people: Record<string, ContextPerson> = { [ada.user]: ada, [sam.user]: sam };
  const app = await studio.createApp({ team, by: ada.user, name: "Recipe box", source: { kind: "template", template: "test" } });
  await studio.ready(app.id);
  appId = app.id;
  /** Waits for the thread's turn to end. */
  const idle = async () => {
    const chat = studio.getApp(appId)!.chats.at(-1);
    if (chat) await studio.idle(chat.id);
  };
  const blocks = async () => new YContextDoc(docOf(await ctx.syncState(appId, ada))).read();
  return { studio, ctx, kiln, appId, ada, sam, prompts, idle, blocks, service, restart: () => (ctx = service()) };
}

function docOf(state: { update: Uint8Array }): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state.update);
  return doc;
}

/** A page's edit as the bytes it would send: what changed in `edit` on a copy of the server's document. */
async function pageUpdate(t: Awaited<ReturnType<typeof make>>, edit: (y: YContextDoc) => void): Promise<Uint8Array> {
  const doc = docOf(await t.ctx.syncState(t.appId, t.ada));
  const before = Y.encodeStateVector(doc);
  edit(new YContextDoc(doc, "page"));
  return Y.encodeStateAsUpdate(doc, before);
}

const ASK = {
  questions: [
    { kind: "single", title: "Who is this for first?", options: [{ id: "me", label: "Just me", recommended: true }, { id: "team", label: "A small group" }] },
    { kind: "boolean", title: "Should it work offline?" },
  ],
};

describe("the Context service", () => {
  it("gives a new App an empty Context, with its creator as owner and a teammate by what they may do", async () => {
    const t = await make();
    const s = await t.ctx.snapshot(t.appId, t.ada);
    expect(s).toMatchObject({ state: { appId: t.appId, version: 0 }, me: { user: "ada@x.test", permission: "owner" }, agent: { state: "idle" }, turns: [], proposals: [] });
    expect((await t.ctx.snapshot(t.appId, t.sam)).me).toMatchObject({ user: "sam@x.test", permission: "viewer" });
    expect(t.ctx.member(t.appId, { ...t.sam, mayWrite: true }).permission).toBe("editor");
    await expect(t.ctx.snapshot(t.appId, { ...t.ada, team: "another-team" })).rejects.toMatchObject({ code: "not_found" });
    expect(await t.blocks()).toEqual([]);
  });

  it("applies an editor's document update, tells the other pages, and refuses a viewer's at the gate", async () => {
    const t = await make();
    const heard: ContextEvent[] = [];
    await t.ctx.subscribe(t.appId, t.sam, (e) => heard.push(e));
    const update = await pageUpdate(t, (y) => y.insert({ type: "paragraph", text: "People lose their recipes." }, "end"));
    await t.ctx.applyUpdate(t.appId, t.ada, update, "page-1");
    expect((await t.blocks()).map((b) => b.text)).toEqual(["People lose their recipes."]);
    expect(heard).toMatchObject([{ type: "update", from: "page-1" }]);

    const theirs = await pageUpdate(t, (y) => y.insert({ type: "paragraph", text: "A viewer wrote this." }, "end"));
    await expect(t.ctx.applyUpdate(t.appId, t.sam, theirs)).rejects.toMatchObject({ code: "forbidden" });
    expect((await t.blocks()).map((b) => b.text)).toEqual(["People lose their recipes."]);
    await expect(t.ctx.applyUpdate(t.appId, t.ada, new Uint8Array([1, 2, 3, 250]))).rejects.toMatchObject({ code: "invalid" });
  });

  it("settles the document into a version with who changed what, and saves it so a restart loses nothing", async () => {
    const t = await make();
    await t.ctx.applyUpdate(t.appId, t.ada, await pageUpdate(t, (y) => y.insert({ type: "requirement", text: "Search by ingredient." }, "end")));
    await t.ctx.flush();
    const s = await t.ctx.snapshot(t.appId, t.ada);
    expect(s.state.version).toBe(1);
    expect(s.changes).toMatchObject([{ version: 1, type: "requirement", change: "added", by: "ada@x.test", title: "Search by ingredient." }]);
    const again = t.restart();
    expect((await again.snapshot(t.appId, t.ada)).state.version).toBe(1);
    expect(new YContextDoc(docOf(await again.syncState(t.appId, t.ada))).read().map((b) => b.text)).toEqual(["Search by ingredient."]);
    await again.shutdown();
  });

  it("runs a prompt on one thread with the Context's notes leading it, and no mode from the page", async () => {
    const t = await make(async (_p, tool) => {
      await tool("context_read");
    });
    const r = await t.ctx.prompt(t.appId, t.ada, "A recipe box I can search by ingredient");
    expect(r).toMatchObject({ steered: false, turn: { by: "ada@x.test", kind: "prompt", prompt: "A recipe box I can search by ingredient" } });
    await t.idle();
    expect(t.prompts[0]).toBe(`${CONTEXT_NOTES}\n\nA recipe box I can search by ingredient`);
    const s = await t.ctx.snapshot(t.appId, t.ada);
    expect(s.turns).toMatchObject([{ status: "succeeded", prompt: "A recipe box I can search by ingredient" }]);
    await t.ctx.prompt(t.appId, t.ada, "Add tags");
    await t.idle();
    expect(t.studio.getApp(t.appId)!.chats).toHaveLength(1);
    expect((await t.ctx.snapshot(t.appId, t.ada)).turns).toHaveLength(2);
  });

  it("lets the agent write on an editor's turn: fragments under sections, a link to the prototype, and built", async () => {
    const t = await make(async (prompt, tool) => {
      if (!prompt.endsWith("recipes")) return;
      await tool("context_read");
      await tool("context_write", { type: "section", content: "Recipe box" });
      const w = (await tool("context_write", { type: "requirement", content: "Search matches titles and ingredients as you type.", section: "Requirements", ownerRole: "design", reviewerRoles: ["qa"] })) as { data: { id: string } };
      await tool("context_write", { type: "constraint", content: "Works on a 390 px wide phone.", section: "Constraints" });
      await tool("context_write", { type: "requirement", content: "Recipes carry tags.", section: "Requirements" });
      await tool("link_preview", { fragment: w.data.id, route: "/" });
      await tool("mark_built");
    });
    await t.ctx.prompt(t.appId, t.ada, "recipes");
    await t.idle();
    const blocks = await t.blocks();
    expect(blocks.map((b) => `${b.type}:${b.text}`)).toEqual([
      "heading:Recipe box",
      "heading:Requirements",
      "requirement:Search matches titles and ingredients as you type.",
      "requirement:Recipes carry tags.",
      "heading:Constraints",
      "constraint:Works on a 390 px wide phone.",
    ]);
    expect(blocks[2]!.props).toMatchObject({ by: "agent", ownerRole: "design", reviewerRoles: "qa", route: "/" });
    const s = await t.ctx.snapshot(t.appId, t.ada);
    expect(s.changes.every((c) => c.by === "agent")).toBe(true);
    expect(freshness(s.state, s.changes)).toEqual({ kind: "fresh" });

    // An edit by hand puts the prototype behind.
    await t.ctx.applyUpdate(t.appId, t.ada, await pageUpdate(t, (y) => y.update(blocks[3]!.id, { text: "Recipes carry tags that combine." })));
    await t.ctx.flush();
    const behind = await t.ctx.snapshot(t.appId, t.ada);
    expect(freshness(behind.state, behind.changes)).toMatchObject({ kind: "behind", count: 1, fragments: [{ change: "edited" }] });
    expect(behind.changes.at(-1)).toMatchObject({ by: "ada@x.test" });
  });

  it("asks typed questions, waits without a running turn, and starts the next turn from the answers", async () => {
    const t = await make(async (prompt, tool) => {
      if (prompt.endsWith("recipes")) await tool("ask", ASK);
    });
    await t.ctx.prompt(t.appId, t.ada, "recipes");
    await t.idle();
    const asked = questionsFrom(t.appId, await t.blocks());
    expect(asked.map((q) => [q.spec.kind, q.status, q.batch.total])).toEqual([["single", "open", 2], ["boolean", "open", 2]]);
    expect((await t.blocks())[0]).toMatchObject({ type: "heading", text: "Decisions" });
    const waiting = await t.ctx.snapshot(t.appId, t.ada);
    expect(waiting.agent.state).toBe("waiting");
    expect(waiting.turns.at(-1)!.status).toBe("needs_you");

    await expect(t.ctx.answer(t.appId, t.ada, asked[0]!.id, { type: "value", value: "nobody" })).rejects.toMatchObject({ code: "invalid" });
    await t.ctx.answer(t.appId, t.ada, asked[0]!.id, { type: "value", value: "team" });
    expect(t.prompts).toHaveLength(1);
    await t.ctx.answer(t.appId, t.ada, asked[1]!.id, { type: "delegated" });
    await t.idle();
    expect(t.prompts).toHaveLength(2);
    expect(t.prompts[1]).toContain("- Who is this for first? → A small group");
    expect(t.prompts[1]).toContain("- Should it work offline? → Yes (you were asked to decide");
    const after = questionsFrom(t.appId, await t.blocks());
    expect(after.map((q) => [q.status, q.answeredBy])).toEqual([["answered", "ada@x.test"], ["delegated", "ada@x.test"]]);
    expect(fragmentsFrom(t.appId, await t.blocks()).map((f) => f.type)).toEqual(["section", "decision", "assumption"]);

    // Changing an answer after its batch went to the agent tells the agent.
    await t.ctx.reopen(t.appId, t.ada, asked[0]!.id);
    await t.ctx.answer(t.appId, t.ada, asked[0]!.id, { type: "value", value: "me" });
    await t.idle();
    expect(t.prompts[2]).toContain('the answer to "Who is this for first?" changed');
  });

  it("keeps open questions across a restart, and Continue lets the agent assume the rest", async () => {
    const t = await make(async (prompt, tool) => {
      if (prompt.endsWith("recipes")) await tool("ask", ASK);
    });
    await t.ctx.prompt(t.appId, t.ada, "recipes");
    await t.idle();
    await t.ctx.flush();
    const again = t.restart();
    const open = questionsFrom(t.appId, new YContextDoc(docOf(await again.syncState(t.appId, t.ada))).read());
    expect(open.map((q) => q.status)).toEqual(["open", "open"]);
    await again.continueQuestions(t.appId, t.ada);
    await t.idle();
    expect(t.prompts[1]).toContain("Answers: 2 questions answered.");
    expect(questionsFrom(t.appId, new YContextDoc(docOf(await again.syncState(t.appId, t.ada))).read()).map((q) => q.status)).toEqual(["delegated", "delegated"]);
    await again.shutdown();
  });

  it("turns everything a viewer's turn would write into proposals, and an editor decides them", async () => {
    const t = await make(async (prompt, tool) => {
      if (prompt.endsWith("export")) {
        await tool("context_write", { type: "requirement", content: "Recipes export as PDF.", section: "Requirements" });
        await tool("ask", ASK);
        await tool("mark_built");
      }
    });
    await t.ctx.prompt(t.appId, t.sam, "export");
    await t.idle();
    expect(await t.blocks()).toEqual([]);
    const s = await t.ctx.snapshot(t.appId, t.sam);
    expect(s.proposals).toMatchObject([{ kind: "add", by: "sam@x.test", status: "open", summary: "Add a requirement: Recipes export as PDF." }]);
    expect(s.state.builtVersion).toBeUndefined();
    expect(t.studio.getChat(t.studio.getApp(t.appId)!.chats[0]!.id)!.turns[0]).toMatchObject({ mode: "chat", by: "sam@x.test" });

    await expect(t.ctx.decideProposal(t.appId, t.sam, s.proposals[0]!.id, "accept")).rejects.toMatchObject({ code: "forbidden" });
    await expect(t.ctx.build(t.appId, t.sam)).rejects.toMatchObject({ code: "forbidden" });
    await expect(t.ctx.reopen(t.appId, t.sam, "sq_x")).rejects.toMatchObject({ code: "forbidden" });
    expect(await t.ctx.decideProposal(t.appId, t.ada, s.proposals[0]!.id, "accept")).toMatchObject({ status: "accepted", decidedBy: "ada@x.test" });
    expect((await t.blocks()).map((b) => `${b.type}:${b.text}`)).toEqual(["heading:Requirements", "requirement:Recipes export as PDF."]);
    expect((await t.blocks())[1]!.props).toMatchObject({ by: "sam@x.test" });
    await expect(t.ctx.decideProposal(t.appId, t.ada, s.proposals[0]!.id, "reject")).rejects.toMatchObject({ code: "conflict" });
  });

  it("makes a viewer's answer and edit proposals too", async () => {
    const t = await make(async (prompt, tool) => {
      if (prompt.endsWith("recipes")) await tool("ask", ASK);
    });
    await t.ctx.prompt(t.appId, t.ada, "recipes");
    await t.idle();
    const [q] = questionsFrom(t.appId, await t.blocks());
    const r = await t.ctx.answer(t.appId, t.sam, q!.id, { type: "value", value: "team" });
    expect(r.proposal).toMatchObject({ kind: "answer", summary: 'Answer "Who is this for first?" with: A small group' });
    expect(questionsFrom(t.appId, await t.blocks())[0]!.status).toBe("open");
    await t.ctx.decideProposal(t.appId, t.ada, r.proposal!.id, "accept");
    expect(questionsFrom(t.appId, await t.blocks())[0]).toMatchObject({ status: "answered", answeredBy: "sam@x.test" });
  });

  it("reads the Context as Markdown with fragment ids, refuses unknown tools and bad input, and writes the Brief", async () => {
    const t = await make();
    await t.ctx.applyUpdate(
      t.appId,
      t.ada,
      await pageUpdate(t, (y) => {
        y.insert({ type: "heading", props: { level: 1 }, text: "Recipe box" }, "end");
        y.insert({ type: "paragraph", text: "One place for recipes." }, "end");
        y.insert({ type: "requirement", text: "Search by ingredient." }, "end");
      }),
    );
    await t.ctx.flush();
    const read = (await t.ctx.tool(t.appId, t.ada, "context_read", {})) as { ok: true; data: { context: string; version: number } };
    const ids = (await t.blocks()).map((b) => b.id);
    expect(read.data).toMatchObject({ version: 1, context: `# Recipe box <!-- ${ids[0]} -->\nOne place for recipes. <!-- ${ids[1]} -->\n- [requirement] Search by ingredient. <!-- ${ids[2]} -->` });
    expect(await t.ctx.tool(t.appId, t.ada, "context_delete_everything", {})).toEqual({ ok: false, error: "Unknown tool: context_delete_everything" });
    expect(await t.ctx.tool(t.appId, t.ada, "context_write", { type: "poem", content: "x" })).toMatchObject({ ok: false });
    expect(await t.ctx.tool(t.appId, t.ada, "context_remove", { id: "nope" })).toEqual({ ok: false, error: "No fragment nope" });
    expect(await t.ctx.tool(t.appId, t.ada, "ask", { questions: [{ kind: "single", title: "Pick", options: [{ id: "a", label: "A" }] }] })).toMatchObject({ ok: false });
    const brief = await t.ctx.brief(t.appId, t.ada);
    expect(brief).toMatchObject({ version: 1 });
    expect(brief.lines[0]).toBe("Recipe box: One place for recipes.");
    expect(brief.lines).toHaveLength(5);
  });

  it("shares presence between pages and drops a page's when it leaves", async () => {
    const t = await make();
    const heard: ContextEvent[] = [];
    await t.ctx.subscribe(t.appId, t.ada, (e) => heard.push(e));
    const page = new Y.Doc();
    const { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } = await import("y-protocols/awareness");
    const a = new Awareness(page);
    a.setLocalStateField("user", { name: "Sam", color: "#2563eb" });
    await t.ctx.applyAwareness(t.appId, t.sam, encodeAwarenessUpdate(a, [page.clientID]), "page-2");
    expect(heard).toMatchObject([{ type: "awareness", from: "page-2" }]);
    const fresh = new Awareness(new Y.Doc());
    applyAwarenessUpdate(fresh, (await t.ctx.syncState(t.appId, t.ada)).awareness, "server");
    expect([...fresh.getStates().values()].map((s) => (s as { user?: { name: string } }).user?.name).filter(Boolean)).toEqual(["Sam"]);
    await t.ctx.leave(t.appId, [page.clientID]);
    const after = new Awareness(new Y.Doc());
    applyAwarenessUpdate(after, (await t.ctx.syncState(t.appId, t.ada)).awareness, "server");
    expect([...after.getStates().values()].filter((s) => (s as { user?: unknown }).user)).toEqual([]);
    for (const x of [a, fresh, after]) x.destroy();
  });
});
