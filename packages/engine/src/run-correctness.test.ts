import { FakeHarness, type FakeScriptContext, type HarnessAdapter } from "@kiln/harness";
import { describe, expect, it } from "vitest";
import { fakeAgentScript } from "./fake-agents";
import { createTestKiln, sampleTree, waitFor } from "./testing";
import { C, type ForemanEvent, type Run } from "./types";

type TestKiln = ReturnType<typeof createTestKiln>["kiln"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 60_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await sleep(10);
  }
}

/** The fake agents, but the implement agent holds until it is stopped. */
function holdingImplement() {
  return new FakeHarness(async (ctx: FakeScriptContext) => {
    if (ctx.opts.env?.KILN_AGENT_TYPE !== "IMPLEMENT") return fakeAgentScript(ctx);
    while (!ctx.signal.cancelled) await sleep(10);
    return { summary: "stopped" };
  });
}

async function liveImplementRun(kiln: TestKiln, workItemId: string): Promise<Run> {
  let run: Run | undefined;
  await until(() => {
    run = kiln.runs.list({ workItemId }).find((r) => r.agent === "implement" && kiln.runs.isActive(r.id));
    return Boolean(run);
  });
  return run!;
}

describe("a person stopping a run of a pipeline task (F4)", { timeout: 150_000 }, () => {
  for (const how of ["cancel", "interrupt"] as const) {
    it(`parks the task instead of starting the agent again (${how})`, async () => {
      const harness = holdingImplement();
      const { kiln } = createTestKiln({ harness: () => harness, preview: false });
      const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
      void kiln.workflow.advance(wi.id);
      const run = await liveImplementRun(kiln, wi.id);
      await kiln.runs[how](run.id, "alice");
      const parked = await waitFor(kiln, wi.id, ["blocked"], 60_000);
      await sleep(100);
      expect(parked.blockedReason).toMatch(/stopped/);
      expect(kiln.runs.list({ workItemId: wi.id }).filter((r) => r.agent === "implement")).toHaveLength(1);
      expect(kiln.gates.list({ workItemId: wi.id, state: "open" })).toEqual([]);
      expect(Object.keys(kiln.workflow.get(wi.id)!.loops).filter((k) => k.endsWith("-errors"))).toEqual([]);
    });
  }

  it("cancelling the task cancels it without opening a could-not-finish gate", async () => {
    const harness = holdingImplement();
    const { kiln } = createTestKiln({ harness: () => harness, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    await liveImplementRun(kiln, wi.id);
    await kiln.workflow.cancel(wi.id, "alice");
    await sleep(200);
    expect(kiln.workflow.get(wi.id)!.state).toBe("cancelled");
    expect(kiln.gates.list({ workItemId: wi.id }).filter((g) => g.kind === "question")).toEqual([]);
  });
});

/** Fails with a retryable network error on the first start, then runs the script. */
function flakyOnce(then: (ctx: FakeScriptContext) => Promise<{ summary: string }>) {
  let starts = 0;
  const inner = new FakeHarness(then);
  const harness: HarnessAdapter = {
    type: "fake",
    start: async (opts) => {
      starts += 1;
      if (starts === 1) throw new Error("ECONNRESET talking to the model");
      return inner.start(opts);
    },
  };
  return { harness, starts: () => starts };
}

describe("a run waiting to retry (F5)", { timeout: 90_000 }, () => {
  it("stops when cancelled instead of starting again", async () => {
    const flaky = flakyOnce(async () => ({ summary: "ran again" }));
    const { kiln } = createTestKiln({ harness: () => flaky.harness, retryDelaysMs: [60_000] });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const done = kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "build it", push: false });
    let id = "";
    await until(() => {
      id = kiln.runs.list().find((r) => kiln.runs.events(r.id).some((e) => e.type === "retry"))?.id ?? "";
      return Boolean(id);
    });
    await kiln.runs.cancel(id, "alice");
    const run = await Promise.race([done, sleep(30_000).then(() => undefined)]);
    expect(run?.status).toBe("cancelled");
    expect(flaky.starts()).toBe(1);
    expect(kiln.runs.events(id).filter((e) => e.type === "finished")).toHaveLength(1);
  });

  it("takes a follow-up into the next attempt instead of continuing in a parallel run", async () => {
    const flaky = flakyOnce(async (ctx) => ({ summary: `heard: ${(await ctx.nextSteer(2000)) ?? "nothing"}` }));
    const { kiln } = createTestKiln({ harness: () => flaky.harness, retryDelaysMs: [300] });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const done = kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "build it", push: false });
    let id = "";
    await until(() => {
      id = kiln.runs.list().find((r) => kiln.runs.events(r.id).some((e) => e.type === "retry"))?.id ?? "";
      return Boolean(id);
    });
    const r = await kiln.runs.followup(id, { message: "use the brand colour", by: "alice" });
    expect(r.delivered).toBe("steered");
    expect((await done).summary).toBe("heard: use the brand colour");
    expect(kiln.runs.list()).toHaveLength(1);
  });
});

describe("follow-ups on a finished run (F11)", { timeout: 90_000 }, () => {
  it("start one continuation and steer it, however many arrive", async () => {
    const harness = new FakeHarness(async (ctx) => {
      if (!ctx.opts.prompt.includes("## Follow-up")) return { summary: "first" };
      const heard: string[] = [];
      for (let m = await ctx.nextSteer(500); m; m = await ctx.nextSteer(500)) heard.push(m);
      return { summary: `heard ${heard.length}` };
    });
    const { kiln } = createTestKiln({ harness: () => harness });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const first = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "build it", push: false });
    const replies = await Promise.all(["a", "b", "c"].map((m) => kiln.runs.followup(first.id, { message: m, by: "alice" })));
    expect(replies.map((x) => x.delivered).sort()).toEqual(["continued", "steered", "steered"]);
    expect(new Set(replies.map((x) => x.run.id)).size).toBe(1);
    // A later one also reaches the continuation while it is going.
    expect((await kiln.runs.followup(first.id, { message: "d", by: "alice" })).delivered).toBe("steered");
    const continuations = kiln.runs.list().filter((x) => x.continuationOf === first.id);
    expect(continuations).toHaveLength(1);
    await until(() => kiln.runs.get(continuations[0]!.id)!.status === "succeeded");
    expect(kiln.runs.get(continuations[0]!.id)!.summary).toBe("heard 3");
  });
});

describe("blueprint loop guard (F2)", { timeout: 150_000 }, () => {
  it("parks a blueprint that cycles after five visits of a stage", async () => {
    const tree = sampleTree({
      "factory.yaml": sampleTree()["factory.yaml"]!.replace(
        "budgets:",
        "blueprint:\n  entry: draft\n  stages:\n    draft: { prompt: Write the change. }\n    check: { prompt: Review the change. }\n  edges:\n    to-check: { from: draft, to: check, when: the change is written }\n    back: { from: check, to: draft, when: always }\n  staffing: { foreman: foreman, draft: implement, check: review }\nbudgets:",
      ),
    });
    const { kiln } = createTestKiln({ tree, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const parked = await waitFor(kiln, wi.id, ["blocked", "failed", "handed_off"], 120_000);
    expect(parked.blockedReason).toMatch(/blueprint stage draft ran 5 times/);
    expect(kiln.runs.list({ workItemId: wi.id }).filter((r) => r.stage === "draft")).toHaveLength(5);
  });
});

describe("a failed agent foreman turn (F7)", { timeout: 150_000 }, () => {
  it("counts each finished run once", async () => {
    let turns = 0;
    const harness = new FakeHarness(async (ctx) => {
      if (ctx.opts.env?.KILN_AGENT_TYPE === "FOREMAN" && ctx.opts.prompt.includes("## Events since your last turn") && ++turns === 2) {
        await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd ? `${ctx.opts.cwd}/` : ""}.kiln/result.json`, JSON.stringify({ dispatch: 42 }));
        return { summary: "garbled", costUsd: 0 };
      }
      return fakeAgentScript(ctx);
    });
    const tree = sampleTree({ "factory.yaml": sampleTree()["factory.yaml"]!.replace("budgets:", "foreman: { mode: agent }\nbudgets:") });
    const { kiln } = createTestKiln({ harness: () => harness, tree, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Remember banned users", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const done = await waitFor(kiln, wi.id, ["handed_off", "blocked"], 120_000);
    expect(turns).toBeGreaterThan(2);
    const runs = kiln.runs.list({ workItemId: wi.id });
    const spent = runs.reduce((s, r) => s + r.costUsd, 0);
    expect(done.costUsd).toBeCloseTo(spent, 6);
    expect(kiln.store.list<ForemanEvent>(C.foremanEvents, (e) => e.workItemId === wi.id)).toEqual([]);
  });
});
