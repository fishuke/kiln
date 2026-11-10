import { describe, expect, it, vi } from "vitest";
import { FakeHarness, type FakeScript } from "@kiln/harness";
import { createTestKiln, sampleTree } from "./testing";
import type { Clock } from "./types";

// Each test builds a whole Kiln; on a busy machine that alone can take seconds.
vi.setConfig({ testTimeout: 60_000 });

/** A clock tests move by hand. */
function manualClock(start = "2026-11-10T09:00:00.000Z") {
  let t = new Date(start).getTime();
  const clock: Clock = { now: () => new Date(t) };
  return { clock, advanceMinutes: (m: number) => void (t += m * 60_000) };
}

const until = async (check: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** A script that keeps going until it is stopped. */
const untilStopped: FakeScript = async (ctx) => {
  while (!ctx.signal.cancelled) await new Promise((r) => setTimeout(r, 5));
  return { summary: "stopped" };
};

function setup(script: FakeScript, opts: Parameters<typeof createTestKiln>[0] = {}) {
  const harness = new FakeHarness(script);
  const t = manualClock();
  const { kiln } = createTestKiln({ preview: false, harness: () => harness, clock: t.clock, runWatchdogMs: 5, runStopGraceMs: 50, ...opts });
  const sha = kiln.defs.list()[0]!.appliedSha!;
  const execute = (extra: Partial<Parameters<typeof kiln.runs.execute>[0]> = {}) =>
    kiln.runs.execute({ factory: "webapp", sha, agent: "foreman", prompt: "go", push: false, ...extra });
  return { kiln, harness, execute, ...t };
}

describe("run timeouts (F1)", () => {
  it("stops a run whose agent goes silent for the stall limit", async () => {
    const { kiln, execute, advanceMinutes } = setup(untilStopped, { runStallMinutes: 30 });
    const running = execute();
    await until(() => kiln.runs.list({}).some((r) => kiln.runs.isActive(r.id)));
    advanceMinutes(29);
    await new Promise((r) => setTimeout(r, 30));
    expect(kiln.runs.list({}).some((r) => kiln.runs.isActive(r.id))).toBe(true);
    advanceMinutes(2);
    const run = await running;
    expect(run.status).toBe("error");
    expect(run.error).toMatchObject({ code: "infrastructure_timeout", message: expect.stringMatching(/no activity for 30 minutes/) });
    expect(run.attempt).toBe(1);
  });

  it("keeps a run going while its agent is active, and stops it at the max duration", async () => {
    let advance: (m: number) => void = () => {};
    const { execute, advanceMinutes } = setup(
      async (ctx) => {
        while (!ctx.signal.cancelled) {
          advance(20);
          ctx.emit({ type: "message", text: "still working" });
          await new Promise((r) => setTimeout(r, 15));
        }
        return { summary: "stopped" };
      },
      { runStallMinutes: 30, maxRunMinutes: 120 },
    );
    advance = advanceMinutes;
    const run = await execute();
    expect(run.status).toBe("error");
    expect(run.error).toMatchObject({ code: "infrastructure_timeout", message: expect.stringMatching(/ran longer than 120 minutes/) });
  });

  it("ends a run whose agent ignores the stop", async () => {
    const { kiln, execute, advanceMinutes } = setup(() => new Promise(() => {}), { runStallMinutes: 30 });
    const running = execute();
    await until(() => kiln.runs.list({}).some((r) => kiln.runs.isActive(r.id)));
    advanceMinutes(31);
    const run = await running;
    expect(run.error?.code).toBe("infrastructure_timeout");
    expect(kiln.runs.isActive(run.id)).toBe(false);
  });
});

describe("concurrent local runs (F6)", () => {
  it("queues runs over maxConcurrentRuns and starts them as slots free; a queued run can be cancelled", async () => {
    const release: (() => void)[] = [];
    const { kiln, harness, execute } = setup(() => new Promise<void>((r) => release.push(r)).then(() => ({ summary: "done" })), { maxConcurrentRuns: 1 });
    const ids: string[] = [];
    const first = execute({ onCreated: (r) => ids.push(r.id) });
    await until(() => release.length === 1);
    const second = execute({ onCreated: (r) => ids.push(r.id) });
    const third = execute({ onCreated: (r) => ids.push(r.id) });
    await until(() => ids.length === 3 && kiln.runs.get(ids[2]!)?.status === "queued");
    expect(kiln.runs.get(ids[1]!)?.status).toBe("queued");
    expect(kiln.runs.queued()).toBe(2);
    expect(harness.started).toHaveLength(1);
    await kiln.runs.cancel(ids[2]!, "alice");
    expect((await third).status).toBe("cancelled");
    release.shift()!();
    expect((await first).status).toBe("succeeded");
    await until(() => release.length === 1);
    expect(kiln.runs.get(ids[1]!)?.status).toBe("running");
    release.shift()!();
    expect((await second).status).toBe("succeeded");
    expect(harness.started).toHaveLength(2);
    expect(kiln.runs.events(ids[1]!).some((e) => e.type === "queued" && /free run slot/.test(e.text ?? ""))).toBe(true);
  });
});

describe("cost and budgets (F12)", () => {
  it("keeps the cost the harness reported when the run then fails", async () => {
    const { execute } = setup(async (ctx) => {
      ctx.emit({ type: "cost", usd: 0.25 });
      ctx.emit({ type: "cost", usd: 0.5 });
      throw new Error("the agent process crashed");
    });
    const run = await execute();
    expect(run.status).not.toBe("succeeded");
    expect(run.costUsd).toBeCloseTo(0.5);
  });

  it("does not count the final cost twice", async () => {
    const { execute } = setup(async (ctx) => {
      ctx.emit({ type: "cost", usd: 0.5 });
      return { summary: "done", costUsd: 0.75 };
    });
    const run = await execute();
    expect(run.status).toBe("succeeded");
    expect(run.costUsd).toBeCloseTo(0.75);
  });

  it("stops a run that crosses its factory's monthly budget", async () => {
    const tree = sampleTree();
    tree["factory.yaml"] = tree["factory.yaml"]!.replace("budgets: { perWorkItemUsd: 40 }", "budgets: { perWorkItemUsd: 40, monthlyUsd: 1 }");
    const { execute } = setup(
      async (ctx) => {
        ctx.emit({ type: "cost", usd: 0.6 });
        await new Promise((r) => setTimeout(r, 20));
        ctx.emit({ type: "cost", usd: 1.2 });
        return untilStopped(ctx);
      },
      { tree },
    );
    const run = await execute();
    expect(run.status).toBe("failed");
    expect(run.error?.code).toBe("budget_exceeded");
    expect(run.costUsd).toBeCloseTo(1.2);
  });

  it("stops a run that spends what is left of its work item's budget", async () => {
    const { kiln, execute } = setup(async (ctx) => {
      ctx.emit({ type: "cost", usd: 1 });
      return untilStopped(ctx);
    });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Small", body: "", source: { provider: "api" }, requester: "alice" });
    kiln.store.put("work_items", { ...kiln.workflow.get(wi.id)!, costUsd: 1 });
    const run = await execute({ workItem: kiln.workflow.get(wi.id)!, workItemBudgetUsd: 1.5 });
    expect(run.error).toMatchObject({ code: "budget_exceeded", message: expect.stringMatching(/budget of \$1\.5 for this task reached \(\$2\.00 spent\)/) });
  });
});
