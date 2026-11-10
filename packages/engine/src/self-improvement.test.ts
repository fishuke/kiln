import { FakeHarness } from "@kiln/harness";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SCORERS, scorerFile } from "./defaults/scorers";
import { fakeAgentScript } from "./fake-agents";
import type { Improver, ImproverInput } from "./improvement";
import { FakeJudge, sampled } from "./scoring";
import { createTestKiln, sampleTree } from "./testing";
import { C, FakeClock, type Run } from "./types";

type K = ReturnType<typeof createTestKiln>["kiln"];

class CountingImprover implements Improver {
  readonly name = "counting";
  calls: ImproverInput[] = [];
  gate?: Promise<void>;
  async propose(input: ImproverInput) {
    this.calls.push(input);
    if (this.gate) await this.gate;
    return { target: "definition" as const, changes: {}, rationale: "nothing to change" };
  }
}

async function failedRun(kiln: K): Promise<Run> {
  const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "Add a footer", push: false });
  await kiln.scoring.scoreRun(run.id);
  return run;
}

const actions = (kiln: K) => kiln.store.list<{ id: string; action: string }>(C.audit).map((a) => a.action);

describe("self-improvement loop", () => {
  it("does not propose again for failures it already tried (F3)", async () => {
    const improver = new CountingImprover();
    const { kiln } = createTestKiln({ improver, autoScore: false, scoreAllRuns: true, judge: new FakeJudge(() => "misses") });
    for (let i = 0; i < 3; i++) await failedRun(kiln);
    expect(await kiln.improvement.check("webapp")).toEqual([]);
    expect(improver.calls).toHaveLength(1);
    expect(kiln.scoring.failures("webapp")).toEqual([]);
    expect(kiln.scoring.list({ factory: "webapp" }).every((s) => s.improvementAttempt?.outcome === "empty")).toBe(true);

    await kiln.improvement.check("webapp", { runNow: true });
    expect(improver.calls).toHaveLength(1);

    const fresh = await failedRun(kiln);
    await kiln.improvement.check("webapp", { runNow: true });
    expect(improver.calls).toHaveLength(2);
    expect(improver.calls[1]!.failures.map((f) => f.run.id)).toEqual([fresh.id]);
  }, 60_000);

  it("runs outside the tick, one pass per factory, on a stored hourly schedule (F3)", async () => {
    const improver = new CountingImprover();
    let release!: () => void;
    improver.gate = new Promise<void>((r) => (release = r));
    const clock = new FakeClock();
    const opts = { improver, clock, autoScore: false, scoreAllRuns: true, judge: new FakeJudge(() => "misses") };
    const { kiln } = createTestKiln(opts);
    for (let i = 0; i < 3; i++) await failedRun(kiln);

    // The tick returns while the improver is still working.
    await kiln.tick({ selfImprovement: true });
    await vi.waitFor(() => expect(improver.calls).toHaveLength(1));
    expect(kiln.store.get<{ id: string; lastCheckAt: string }>(C.selfImprovementChecks, "webapp")?.lastCheckAt).toBe(clock.now().toISOString());
    // An hour later the first pass is still busy: no second pass for the same factory.
    clock.advance(3_600_000);
    await kiln.tick({ selfImprovement: true });
    expect(improver.calls).toHaveLength(1);
    release();
    await kiln.improvement.idle();

    for (let i = 0; i < 3; i++) await failedRun(kiln);
    await kiln.tick({ selfImprovement: true });
    await kiln.improvement.idle();
    expect(improver.calls).toHaveLength(2);

    // A restart half an hour later keeps the schedule: the check time is in the store.
    for (let i = 0; i < 3; i++) await failedRun(kiln);
    clock.advance(1_800_000);
    const restarted = createTestKiln({ ...opts, store: kiln.store }).kiln;
    await restarted.tick({ selfImprovement: true });
    await restarted.improvement.idle();
    expect(improver.calls).toHaveLength(2);
  }, 60_000);

  it("counts a replay that did not finish as a failed replay", async () => {
    let starts = 0;
    const fake = new FakeHarness(fakeAgentScript);
    const { kiln } = createTestKiln({
      autoScore: false,
      scoreAllRuns: true,
      replayLimit: 1,
      judge: new FakeJudge(({ run }) => (run.kind === "replay" ? "meets" : "misses")),
      harness: () => ({
        type: "fake",
        start: async (opts) => {
          starts += 1;
          if (starts > 3) throw new Error("something odd");
          return fake.start(opts);
        },
      }),
    });
    for (let i = 0; i < 3; i++) await failedRun(kiln);
    const [p] = await kiln.improvement.check("webapp");
    expect(p!.replay.length).toBeGreaterThan(0);
    expect(p!.replay.every((r) => !r.before && !r.after)).toBe(true);
  }, 60_000);
});

describe("what gets scored (F9)", () => {
  it("skips runs that did not finish their work", async () => {
    const { kiln } = createTestKiln({ autoScore: false, scoreAllRuns: true, judge: new FakeJudge(() => "misses") });
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "x", push: false });
    for (const status of ["cancelled", "error", "blocked", "paused"] as const) {
      kiln.store.put(C.runs, { ...run, status });
      expect(await kiln.scoring.scoreRun(run.id)).toEqual([]);
    }
    expect(actions(kiln).filter((a) => a === "score.skipped")).toHaveLength(4);
    kiln.store.put(C.runs, { ...run, status: "failed" });
    expect(await kiln.scoring.scoreRun(run.id)).toHaveLength(1);
  });

  it("audits a judge error and still runs the other scorers", async () => {
    const extra = {
      "scorers/second/scorer.md": "---\nname: second\nagents: [implement]\nlabels:\n  - { value: meets, score: 1 }\n  - { value: misses, score: 0 }\npassingScore: 1\nsamplingRate: 100\nmodel: claude-haiku-5-5\n---\nSecond.\n",
    };
    const judge = new FakeJudge(({ scorer }) => {
      if (scorer.name === "criteria") throw new Error("judge is down");
      return "meets";
    });
    const { kiln } = createTestKiln({ tree: sampleTree(extra), autoScore: false, scoreAllRuns: true, judge });
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "x", push: false });
    const scores = await kiln.scoring.scoreRun(run.id);
    expect(scores.map((s) => s.scorer)).toEqual(["second"]);
    expect(actions(kiln)).toContain("score.failed");
  });
});

describe("replays (F20)", () => {
  it("do not attach to the live work item", async () => {
    const { kiln } = createTestKiln({ autoScore: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "x", push: false, workItem: wi });
    const replay = await kiln.runs.replay(run.id);
    expect(replay).toMatchObject({ kind: "replay", replayOf: run.id });
    expect(replay.workItemId).toBeUndefined();
    expect(kiln.runs.list({ workItemId: wi.id }).map((r) => r.id)).toEqual([run.id]);
  });
});

describe("default scorers feed self-improvement", () => {
  it("samples a finished run, records the verdict and counts a failure toward a proposal", async () => {
    const doc = DEFAULT_SCORERS.find((d) => d.slug === "task-compliance")!;
    const tree = sampleTree({ "scorers/task-compliance/scorer.md": scorerFile(doc, ["implement"], "claude-haiku-5-5") });
    delete tree["scorers/criteria/scorer.md"];
    const { kiln } = createTestKiln({ tree, autoScore: false, judge: new FakeJudge(() => "noncompliant") });
    const base = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "Add a footer", push: false });
    const ids = Array.from({ length: 200 }, (_, i) => `run_sample_${i}`);
    const hit = ids.find((id) => sampled(id, "task-compliance", 10))!;
    const miss = ids.find((id) => !sampled(id, "task-compliance", 10))!;
    for (const id of [hit, miss]) kiln.store.put(C.runs, { ...base, id });

    expect(await kiln.scoring.scoreRun(miss)).toEqual([]);
    const [score] = await kiln.scoring.scoreRun(hit);
    expect(score).toMatchObject({ runId: hit, label: "noncompliant", score: 0.2, passed: false, selfImprovement: true });
    expect(kiln.scoring.failures("webapp").map((s) => s.runId)).toEqual([hit]);

    const [p] = await kiln.improvement.check("webapp", { runNow: true });
    expect(p!.failures).toEqual([expect.objectContaining({ runId: hit, label: "noncompliant" })]);
  }, 60_000);
});
