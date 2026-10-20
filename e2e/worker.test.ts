import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import { issueToken } from "@kiln/auth";
import { KilnWorker, WorkerConfig } from "@kiln/cli";
import { createTestKiln, fakeAgentScript, sampleTree, waitFor } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider } from "@kiln/sandbox";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";

function setup() {
  const tree = sampleTree({
    "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nworkerHost: build-farm\n---\nImplement the change with tests.\n",
  });
  const t = createTestKiln({ tree, preview: false });
  const app = createApp(t.kiln);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch;
  const key = issueToken(t.kiln.store, { name: "farm", subject: "worker@acme.test", grants: [{ scope: "worker", factory: "*" }] }).token;
  const worker = (overrides: Partial<WorkerConfig> = {}) =>
    new KilnWorker(WorkerConfig.parse({ workerId: "build-farm", apiUrl: "http://kiln.test", apiKey: key, backend: "direct", heartbeatMs: 200, claimWaitSeconds: 1, idleOnCompleteMs: 0, logLevel: "error", ...overrides }), {
      fetch: fetchImpl,
      provider: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-worker-"))),
      harness: () => new FakeHarness(fakeAgentScript),
    });
  return { ...t, app, fetchImpl, worker };
}

describe("self-hosted workers", () => {
  it("queues runs until a worker connects, then the worker runs them, pushes the branch and streams events", async () => {
    const { kiln, forge, worker } = setup();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    // No worker yet: the implement run waits in the queue.
    for (let i = 0; i < 300 && !kiln.workers.queued().length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(kiln.workers.queued()[0]).toMatchObject({ workerHost: "build-farm" });
    const queuedRun = kiln.runs.get(kiln.workers.queued()[0]!.runId)!;
    expect(queuedRun.status).toBe("queued");

    const w = worker();
    const running = w.start();
    const done = await waitFor(kiln, wi.id, ["handed_off"], 30_000);
    await w.stop();
    await running;

    const run = kiln.runs.list({ workItemId: wi.id }).find((r) => r.agent === "implement")!;
    expect(run).toMatchObject({ status: "succeeded", workerHost: "build-farm" });
    expect(run.workerId).toMatch(/^wkr_/);
    expect(kiln.runs.events(run.id).map((e) => e.type)).toEqual(expect.arrayContaining(["queued", "claimed", "started", "message", "pushed", "finished"]));
    expect(done.pr).toBeDefined();
    expect(forge.branchSha({ owner: "acme", name: "web" }, done.branch!)).toMatch(/^[0-9a-f]{40}$/);
    expect(w.metrics()).toMatch(/kiln_worker_tasks_completed_total\{result="succeeded"\} 1/);
    expect(kiln.workers.connected()).toHaveLength(0);
  }, 60_000);

  it("a one-shot worker exits after one run; runs nobody claims time out", async () => {
    const { kiln, worker } = setup();
    const sha = kiln.defs.require("webapp").appliedSha!;
    const first = kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "Add a footer link", push: false });
    await worker({ oneShot: true }).start();
    expect((await first).status).toBe("succeeded");

    kiln.options.workerQueueTimeoutMs = 50;
    const orphan = kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "nobody home", push: false, maxAttempts: 1 });
    await new Promise((r) => setTimeout(r, 100));
    kiln.workers.tick();
    expect(await orphan).toMatchObject({ status: "error", error: { code: "infrastructure_timeout" } });
  }, 60_000);

  it("the SDK lists connected workers", async () => {
    const { kiln, fetchImpl, worker } = setup();
    const w = worker();
    const running = w.start();
    for (let i = 0; i < 100 && !kiln.workers.connected().length; i++) await new Promise((r) => setTimeout(r, 20));
    const admin = new KilnClient({ baseUrl: "http://kiln.test", token: issueToken(kiln.store, { name: "a", subject: "a@acme.test", grants: [{ scope: "admin", factory: "*" }] }).token, fetch: fetchImpl });
    expect((await admin.workers()).workers).toEqual([expect.objectContaining({ workerId: "build-farm", backend: "direct", maxConcurrent: 0 })]);
    await w.stop();
    await running;
  }, 30_000);
});
