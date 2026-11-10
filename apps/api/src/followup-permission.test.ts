import { issueToken } from "@kiln/auth";
import { createTestKiln, sampleTree } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 3000 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

function setup(permission?: "ANYONE_WITH_ACCESS" | "RUN_CREATOR") {
  const harness = new FakeHarness(async (ctx) => {
    if (ctx.opts.prompt.startsWith("[hold]")) while (!ctx.signal.cancelled) await new Promise((r) => setTimeout(r, 10));
    return { summary: "done" };
  });
  const tree = sampleTree();
  if (permission) tree["factory.yaml"] = `${tree["factory.yaml"]}followUpPermission: ${permission}\n`;
  const t = createTestKiln({ harness: () => harness, tree, preview: false });
  const app = createApp(t.kiln);
  const tok = (subject: string, scope = "send") => issueToken(t.kiln.store, { name: subject, subject, grants: [{ scope: scope as never, factory: "*" }, { scope: "read", factory: "*" }] }).token;
  const call = (path: string, token: string, body: unknown = {}) =>
    app.request(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const start = async (by: string) => {
    const sha = t.kiln.defs.require("webapp").appliedSha!;
    const run = await t.kiln.runs.startInBackground({ factory: "webapp", sha, agent: "implement", prompt: "[hold] build", push: false, creator: by });
    await until(() => t.kiln.runs.isActive(run.id));
    return run;
  };
  return { ...t, tok, call, start };
}

describe("who can send follow-ups", () => {
  it("anyone with access to the run by default", async () => {
    const { kiln, tok, call, start } = setup();
    const run = await start("alice@acme.test");
    expect((await call(`/api/v1/runs/${run.id}/followups`, tok("bob@acme.test"), { message: "also the footer" })).status).toBe(200);
    expect((await call(`/api/v1/runs/${run.id}/steer`, tok("bob@acme.test"), { text: "and the header" })).status).toBe(200);
    await kiln.runs.cancel(run.id, "alice@acme.test");
  });

  it("only the person who started the run when set to RUN_CREATOR; admins stay allowed", async () => {
    const { kiln, tok, call, start } = setup("RUN_CREATOR");
    const run = await start("alice@acme.test");
    const bob = tok("bob@acme.test");
    for (const [path, body] of [
      ["followups", { message: "also the footer" }],
      ["steer", { text: "and the header" }],
      ["interrupt", {}],
    ] as const) {
      const res = await call(`/api/v1/runs/${run.id}/${path}`, bob, body);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/only the person who started/);
    }
    expect(kiln.runs.isActive(run.id)).toBe(true);
    expect((await call(`/api/v1/runs/${run.id}/followups`, tok("alice@acme.test"), { message: "also the footer" })).status).toBe(200);
    expect((await call(`/api/v1/runs/${run.id}/steer`, tok("root@acme.test", "admin"), { text: "admin note" })).status).toBe(200);
    await kiln.runs.cancel(run.id, "alice@acme.test");
  });

  it("a task message from someone else is kept but does not steer the task", async () => {
    const { kiln } = setup("RUN_CREATOR");
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix nav", body: "- fix it", requester: "alice@acme.test", source: { provider: "web" } as never });
    const queue = vi.spyOn(kiln.workflow, "queue" as never);
    kiln.store.put("work_items", { ...kiln.workflow.get(wi.id)!, state: "blocked" });
    const resume = vi.spyOn(kiln.workflow, "resume" as never).mockResolvedValue(undefined as never);
    await kiln.workflow.message(wi.id, { by: "bob@acme.test", text: "do it differently" });
    expect(kiln.workflow.get(wi.id)!.conversation.some((m) => m.text === "do it differently")).toBe(true);
    expect(resume).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    await kiln.workflow.message(wi.id, { by: "alice@acme.test", text: "go on" });
    expect(resume.mock.calls.length + queue.mock.calls.length).toBeGreaterThan(0);
  });

  it("follows continuations back to the original starter", async () => {
    const { kiln, start } = setup("RUN_CREATOR");
    const run = await start("alice@acme.test");
    await kiln.runs.cancel(run.id, "alice@acme.test");
    await until(() => !kiln.runs.isActive(run.id));
    // An admin continued it; the continuation still belongs to the person who started the first run.
    const next = (await kiln.runs.followup(run.id, { message: "[hold] again", by: "root@acme.test" })).run;
    expect(next.creator).toBe("root@acme.test");
    expect(kiln.runs.mayFollowUp(next, "alice@acme.test")).toBe(true);
    expect(kiln.runs.mayFollowUp(next, "bob@acme.test")).toBe(false);
    await kiln.runs.cancel(next.id, "alice@acme.test");
  });
});
