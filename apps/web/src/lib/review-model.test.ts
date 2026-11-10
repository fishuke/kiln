import { describe, expect, it } from "vitest";
import { buildReviewModel, checkLines, pickProof, type ProofMedia } from "./review-model";

const img = (name: string): ProofMedia => ({ kind: "image", name, url: `/files/${name}` });
const vid = (name: string): ProofMedia => ({ kind: "video", name, url: `/files/${name}` });

describe("pickProof", () => {
  it("pairs a before image with its after twin and keeps one named video", () => {
    const p = pickProof([img("AC2-New.png"), vid("video.webm"), img("before_p11_Policy.png"), img("after_main_Policy.png"), img("after_p11_Policy.png"), vid("AC1-printed.webm")]);
    expect(p.before?.name).toBe("before_p11_Policy.png");
    expect(p.after?.name).toBe("after_p11_Policy.png");
    expect(p.image).toBeUndefined();
    expect(p.video?.name).toBe("AC1-printed.webm");
    expect(p.more.map((m) => m.name)).toEqual(["AC2-New.png", "video.webm", "after_main_Policy.png"]);
  });

  it("falls back to the first before and the first after when names do not line up", () => {
    const p = pickProof([img("AC1-before-New.png"), img("AC1-after-Mutation.png")]);
    expect([p.before?.name, p.after?.name]).toEqual(["AC1-before-New.png", "AC1-after-Mutation.png"]);
  });

  it("shows one image and a generic video when that is all there is", () => {
    const p = pickProof([img("shot.png"), img("other.png"), vid("video.webm")]);
    expect(p.image?.name).toBe("shot.png");
    expect(p.video?.name).toBe("video.webm");
    expect(p.more.map((m) => m.name)).toEqual(["other.png"]);
  });

  it("drops duplicates and survives no media", () => {
    expect(pickProof([img("a.png"), img("a.png")]).more).toEqual([]);
    expect(pickProof([])).toEqual({ before: undefined, after: undefined, image: undefined, video: undefined, more: [] });
  });
});

describe("checkLines", () => {
  it("reads a map, a list, or just the flag", () => {
    expect(checkLines({ testsPassed: true, tests: { unit: "221 tests, 0 failures" } })).toEqual([{ ok: true, text: "unit: 221 tests, 0 failures" }]);
    expect(checkLines({ testsPassed: false, tests: ["mvn verify: 1 failure"] })).toEqual([{ ok: false, text: "mvn verify: 1 failure" }]);
    expect(checkLines({ testsPassed: true })).toEqual([{ ok: true, text: "Tests pass" }]);
    expect(checkLines(undefined)).toEqual([]);
  });
});

describe("buildReviewModel", () => {
  const run = (id: string, agent: string, startedAt: string, finishedAt: string, extra: object = {}) => ({ id, agent, stage: agent, status: "succeeded", startedAt, finishedAt, costUsd: 1, ...extra });
  const wi = {
    id: "wi_1",
    title: "FNLF-1: address missing",
    state: "handed_off",
    costUsd: 8.72,
    createdAt: "2026-11-09T15:06:00Z",
    pr: { repo: "o/r", number: 2, url: "https://forge.test/o/r/pull/2", additions: 259, deletions: 2, changedFiles: 26 },
    triage: { summary: "Templates skip addresses without a house number." },
    review: { verdict: "accepted", findings: ["Customers will see every location."] },
    runs: [
      run("r3", "verify", "2026-11-09T15:42:00Z", "2026-11-09T16:01:00Z", {
        result: { testsPassed: true, tests: { main: "221 tests, 0 failures" }, notes: "Not run through a full stack." },
        artifacts: [{ kind: "image", name: "before_x.png", url: "u1", key: "runs/r3/before_x.png" }, { kind: "image", name: "after_x.png", url: "u2", key: "runs/r3/after_x.png" }, { kind: "report", name: "log.txt", url: "u3" }],
      }),
      run("r1", "triage", "2026-11-09T15:06:00Z", "2026-11-09T15:08:00Z"),
      run("r2", "verify", "2026-11-09T15:16:00Z", "2026-11-09T15:32:00Z", { artifacts: [{ kind: "image", name: "old.png", url: "u0" }] }),
      run("r4", "review", "2026-11-09T16:01:00Z", "2026-11-09T16:10:00Z"),
    ],
  };

  it("takes proof from the latest run with media and lists steps in time order", () => {
    const m = buildReviewModel(wi);
    expect(m.proof.before?.url).toBe("/files/runs/r3/before_x.png");
    expect(m.proof.after?.name).toBe("after_x.png");
    expect(m.steps.map((s) => `${s.agent} ${s.minutes}`)).toEqual(["triage 2", "verify 16", "verify 19", "review 9"]);
    expect(m.checks).toEqual([{ ok: true, text: "main: 221 tests, 0 failures" }, { ok: true, text: "Review agent accepted" }]);
    expect(m.limits).toBe("Not run through a full stack.");
    expect(m.wrong).toBe("Templates skip addresses without a house number.");
    expect(m.minutes).toBe(64);
    expect(m.costUsd).toBe(8.72);
  });

  it("keeps an earlier run's video when the latest proof has none", () => {
    const m = buildReviewModel({ ...wi, runs: [...wi.runs, run("r0", "verify", "2026-11-09T15:10:00Z", "2026-11-09T15:12:00Z", { artifacts: [{ kind: "video", name: "AC1-printed.webm", url: "v", key: "runs/r0/AC1-printed.webm" }] })] });
    expect(m.proof.before?.name).toBe("before_x.png");
    expect(m.proof.video?.url).toBe("/files/runs/r0/AC1-printed.webm");
  });

  it("works for a task with no runs yet", () => {
    const m = buildReviewModel({ id: "wi_2", title: "t", state: "received", createdAt: "2026-11-09T15:06:00Z", runs: [] });
    expect(m.checks).toEqual([]);
    expect(m.steps).toEqual([]);
    expect(m.proof.more).toEqual([]);
  });
});
