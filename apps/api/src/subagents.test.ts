import { createTestKiln, sampleTree } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

function setup() {
  const steering = new Map<string, string[]>();
  const harness = new FakeHarness(async (ctx) => {
    steering.set(ctx.opts.env!.KILN_RUN_ID!, ctx.steering);
    if (ctx.opts.prompt.startsWith("[hold]")) while (!ctx.signal.cancelled) await new Promise((r) => setTimeout(r, 10));
    return { summary: "done" };
  });
  const tree = sampleTree({ "agents/helper/agent.md": "---\nagentType: CUSTOM\nspawnableBy: [implement]\n---\nHelp.\n" });
  const t = createTestKiln({ harness: () => harness, tree, preview: false });
  const app = createApp(t.kiln);
  return { ...t, app, steering };
}

describe("subagents through the API", () => {
  it("spawns by name with a report, and a run token addresses the child by its name", async () => {
    const { kiln, app, steering } = setup();
    const sha = kiln.defs.require("webapp").appliedSha!;
    const parent = await kiln.runs.startInBackground({ factory: "webapp", sha, agent: "implement", prompt: "[hold] build", push: false });
    await until(() => kiln.runs.isActive(parent.id));
    const token = kiln.secrets.issueRunToken(parent.id, []);
    const call = (path: string, body: unknown, tok = token) =>
      app.request(path, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });

    const spawned = await call(`/api/v1/runs/${parent.id}/spawn`, { agent: "helper", prompt: "[hold] the logo", name: "logo", report: true });
    expect(spawned.status).toBe(201);
    const child = kiln.runs.byName(parent.id, "logo")!;
    expect(child).toMatchObject({ name: "logo", reportToParent: true, parentRunId: parent.id });
    await until(() => kiln.runs.isActive(child.id));

    expect((await call(`/api/v1/runs/logo/followups`, { message: "use the brand colour" })).status).toBe(200);
    await until(() => steering.get(child.id)?.includes("use the brand colour") ?? false);

    // The child asks the person; its parent hears about it.
    const childToken = kiln.secrets.issueRunToken(child.id, []);
    expect((await call(`/api/v1/runs/${child.id}/questions`, { title: "Logo", question: "Text logo or upload one?" }, childToken)).status).toBe(201);
    await until(() => steering.get(parent.id)?.some((s) => s.includes("Reason: needs_input")) ?? false);

    // A name outside the caller's tree is as unknown as a wrong id.
    expect((await call(`/api/v1/runs/nobody/followups`, { message: "hi" })).status).toBe(403);
    await kiln.runs.cancelTree(parent.id, "alice");
  });

  it("rejects a malformed name", async () => {
    const { kiln, app } = setup();
    const sha = kiln.defs.require("webapp").appliedSha!;
    const parent = await kiln.runs.startInBackground({ factory: "webapp", sha, agent: "implement", prompt: "[hold] build", push: false });
    await until(() => kiln.runs.isActive(parent.id));
    const token = kiln.secrets.issueRunToken(parent.id, []);
    const res = await app.request(`/api/v1/runs/${parent.id}/spawn`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ agent: "helper", prompt: "x", name: "Bad Name" }),
    });
    expect(res.status).toBe(400);
    await kiln.runs.cancelTree(parent.id, "alice");
  });
});
