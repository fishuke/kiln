import { describe, expect, it } from "vitest";
import { parseActions } from "./agent-foreman";
import { createTestKiln, sampleTree, waitFor } from "./testing";
import { C, type ForemanEvent } from "./types";

const agentTree = (extra = "") => sampleTree({ "factory.yaml": sampleTree()["factory.yaml"]!.replace("budgets:", `foreman: { mode: agent${extra} }\nbudgets:`) });

async function settle(kiln: ReturnType<typeof createTestKiln>["kiln"], id: string) {
  // Turns and runs chain through events; wait until nothing is queued or running.
  for (let i = 0; i < 400; i++) {
    const queued = kiln.store.list<ForemanEvent>(C.foremanEvents, (e) => e.workItemId === id).length;
    const live = kiln.runs.list({ workItemId: id }).some((r) => r.status === "running");
    if (!queued && !live) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("agent foreman", { timeout: 60_000 }, () => {
  it("plans, dispatches, narrates and hands off, one turn per event", async () => {
    const { kiln } = createTestKiln({ tree: agentTree(), preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Remember banned users", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const done = await waitFor(kiln, wi.id, ["handed_off"], 45_000);
    const runs = kiln.runs.list({ workItemId: wi.id }).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(runs.filter((r) => r.stage !== "foreman").map((r) => r.agent)).toEqual(["triage", "implement", "review"]);
    expect(runs.filter((r) => r.stage === "foreman")).toHaveLength(4);
    expect(done.pr).toBeDefined();
    expect(done.tasks?.every((t) => t.status === "done")).toBe(true);
    expect(done.conversation.filter((m) => m.role === "foreman").map((m) => m.text)).toContain("On it: Remember banned users.");
    // Subagents report to the foreman, not to the requester.
    expect(done.conversation.some((m) => m.role === "agent")).toBe(false);
    expect(kiln.runs.list({ workItemId: wi.id }).find((r) => r.agent === "implement")!.title).toBe("Implement Remember banned users");
    const merge = kiln.gates.list({ workItemId: wi.id, state: "open" });
    expect(merge.map((g) => g.kind)).toEqual(["merge"]);
    expect(merge[0]!.question).toContain("Review focus: the remembered-list storage.");
    expect(done.conversation.filter((m) => m.role === "system").map((m) => m.text)).toContain("Completed Triage the request (1/4)");
  });

  it("asks a person, waits at no cost, and continues with the answer", async () => {
    const { kiln } = createTestKiln({ tree: agentTree(), preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Remember lists [ask]", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    for (let i = 0; i < 200 && !kiln.gates.list({ workItemId: wi.id, state: "open" }).length; i++) await new Promise((r) => setTimeout(r, 25));
    await settle(kiln, wi.id);
    const turns = kiln.workflow.get(wi.id)!.foreman!.turns;
    const gate = kiln.gates.list({ workItemId: wi.id, state: "open" })[0]!;
    expect(gate.questions?.[0]?.options).toEqual(["Per server", "Global"]);
    await new Promise((r) => setTimeout(r, 200));
    expect(kiln.workflow.get(wi.id)!.foreman!.turns).toBe(turns);
    await kiln.workflow.message(wi.id, { by: "a@acme.test", text: "Per server" });
    const done = await waitFor(kiln, wi.id, ["handed_off"]);
    expect(done.foreman!.turns).toBeGreaterThan(turns);
  });

  it("sends a person's message to the agent that has the context", async () => {
    const { kiln } = createTestKiln({ tree: agentTree(), preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    await waitFor(kiln, wi.id, ["handed_off"]);
    await kiln.workflow.message(wi.id, { by: "a@acme.test", text: "also add a test for the mobile layout" });
    await waitFor(kiln, wi.id, ["building", "reviewing"]);
    await settle(kiln, wi.id);
    const implement = kiln.runs
      .list({ workItemId: wi.id })
      .filter((r) => r.agent === "implement")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(implement).toHaveLength(2);
    expect(implement[1]!.continuationOf).toBe(implement[0]!.id);
    expect(implement[1]!.startState.prompt).toContain("also add a test for the mobile layout");
  });

  it("picks up after a restart instead of stopping", async () => {
    const { kiln } = createTestKiln({ tree: agentTree(), preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Saved carts", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    kiln.store.put(C.workItems, { ...kiln.workflow.get(wi.id)!, state: "building", plan: { mode: "agent", cursor: 0, stages: [] }, foreman: { turns: 3, idleTurns: 0, failedTurns: 0 } });
    expect(kiln.workflow.recoverInterrupted()).toEqual([]);
    const done = await waitFor(kiln, wi.id, ["handed_off"]);
    expect(done.conversation.map((m) => m.text)).toContain("Picking up where I left off.");
  });

  it("stops with a clear reason at the turn limit", async () => {
    const { kiln } = createTestKiln({ tree: agentTree(", maxTurns: 2"), preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Big change", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const stuck = await waitFor(kiln, wi.id, ["blocked"]);
    expect(stuck.blockedReason).toMatch(/2 turns/);
    expect(kiln.gates.list({ workItemId: wi.id, state: "open" }).map((g) => g.name)).toEqual(["foreman-stuck"]);
  });
});

describe("parseActions", () => {
  it("accepts the documented actions and names what is wrong", () => {
    expect(parseActions({ say: "hi", tasks: [{ title: "Triage" }], dispatch: [{ agent: "triage", brief: "look" }] })).toMatchObject({ ok: true, actions: { tasks: [{ title: "Triage", status: "todo" }] } });
    const bad = parseActions({ dispatch: [{ agent: "triage" }] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/dispatch\.0\.brief/);
  });
});
