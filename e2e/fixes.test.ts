import { createHmac } from "node:crypto";
import { createTestKiln, FakeJudge, sampleTree, waitFor } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { normalizeGitHub, normalizeSlack, verifySentry, verifyStripe } from "@kiln/integrations";
import { describe, expect, it } from "vitest";

describe("regressions found while writing the docs", () => {
  it("automation filters on repos match GitHub events", async () => {
    const tree = sampleTree({ "automations/ready-label/automation.md": "---\ntriggers:\n  - provider: github\n    event: issue_labeled\n    filter: { labels: [kiln-ready], repos: [acme/web] }\n---\n" });
    const { kiln } = createTestKiln({ tree, preview: false });
    const ev = (repo: string) => normalizeGitHub("issues", { action: "labeled", label: { name: "kiln-ready" }, repository: { full_name: repo }, issue: { number: 1, title: "T", labels: [{ name: "kiln-ready" }] } })!;
    expect((await kiln.automations.handle(ev("acme/web"))).started).toHaveLength(1);
    expect((await kiln.automations.handle(ev("acme/other"))).started).toHaveLength(0);
  });

  it("an advisory review without on_fail posts findings and hands off instead of parking", async () => {
    const tree = sampleTree({
      "pipelines/p.yaml": "stages:\n  - { id: build, agent: implement }\n  - { id: review, agent: review, advisory: true }\n  - { id: handoff, action: handoff }\n",
      "factory.yaml": sampleTree()["factory.yaml"]!.replace("budgets:", "defaultPipeline: p\nbudgets:"),
    });
    const { kiln, forge } = createTestKiln({ tree, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix footer [needs-changes]", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    const after = kiln.workflow.get(wi.id)!;
    expect(after.state).toBe("handed_off");
    expect(forge.comments.some((c) => c.number === after.pr!.number && c.body.startsWith("Advisory review findings:"))).toBe(true);
  });

  it("stage changes trigger factory automations", async () => {
    const tree = sampleTree({
      "agents/notifier/agent.md": "---\ndescription: notes\n---\nWrite release notes.\n",
      "automations/on-handoff/automation.md": "---\nagent: notifier\ntriggers:\n  - provider: factory\n    event: work_item_stage_changed\n    filter: { stages: [handed_off] }\n---\nDraft release notes for the hand-off.\n",
    });
    const { kiln } = createTestKiln({ tree, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    await new Promise((r) => setTimeout(r, 300));
    const notes = kiln.workflow.list().find((w) => w.source.automation === "stage:on-handoff");
    expect(notes).toBeDefined();
  });

  it("a Slack thread reply steers the running agent", async () => {
    const harness = new FakeHarness(async (ctx) => ({ summary: `next action uses ${await ctx.nextSteer(5000)}` }));
    const { kiln } = createTestKiln({ harness: () => harness, preview: false });
    const { started } = await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: "S1", event: { type: "app_mention", channel: "C", ts: "7.0", text: "@webapp fix typo" } })!);
    let runId: string | undefined;
    for (let i = 0; i < 200 && !runId; i++) {
      await new Promise((r) => setTimeout(r, 20));
      runId = kiln.runs.list({ workItemId: started[0]!.id }).find((r) => kiln.runs.isActive(r.id))?.id;
    }
    await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: "S2", event: { type: "message", channel: "C", thread_ts: "7.0", ts: "7.1", user: "U", text: "use the shared footer" } })!);
    await waitFor(kiln, started[0]!.id, ["handed_off", "blocked"]);
    expect(kiln.runs.get(runId!)!.steering).toEqual(["use the shared footer"]);
  });

  it("enforces the monthly budget", async () => {
    const tree = sampleTree({ "factory.yaml": sampleTree()["factory.yaml"]!.replace("budgets: { perWorkItemUsd: 40 }", "budgets: { perWorkItemUsd: 40, monthlyUsd: 1 }") });
    const { kiln } = createTestKiln({ tree, preview: false });
    const a = await kiln.workflow.create({ factory: "webapp", title: "Fix typo one", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(a.id);
    const b = await kiln.workflow.create({ factory: "webapp", title: "Fix typo two", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(b.id);
    expect(kiln.workflow.get(b.id)!.blockedReason).toMatch(/^monthly budget of \$1 for webapp reached/);
  });

  it("a merged self-improvement PR in a config repo ships as a canary", async () => {
    const judge = new FakeJudge(({ run }) => (run.startState.instructions.includes("Lessons from reviewed failures") ? "meets" : "misses"));
    const { kiln, forge } = createTestKiln({ judge, autoScore: false });
    forge.createRepo({ owner: "acme", name: "cfg" }, sampleTree());
    await kiln.defs.connectRepo({ owner: "acme", name: "cfg" }, "a");
    const wi = await kiln.workflow.create({ factory: "webapp", title: "x", body: "", source: { provider: "api" }, requester: "a" });
    const run = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "# x", workItem: wi, branch: "kiln/x" });
    await kiln.scoring.scoreRun(run.id, { force: true });
    const [p] = await kiln.improvement.check("webapp", { runNow: true });
    await forge.merge({ owner: "acme", name: "cfg" }, p!.pr!.number, "lead");
    await kiln.automations.handle(normalizeGitHub("push", { ref: "refs/heads/main", repository: { full_name: "acme/cfg" } })!);
    expect(kiln.defs.require("webapp").canary).toMatchObject({ percent: 10, sha: p!.candidateSha });
    expect(kiln.improvement.get(p!.id)!.state).toBe("merged");
  });

  it("verifies Stripe and Sentry signatures with their own schemes", () => {
    const body = '{"id":"evt"}';
    const t = String(Math.floor(Date.now() / 1000));
    const stripe = `t=${t},v1=${createHmac("sha256", "whsec").update(`${t}.${body}`).digest("hex")}`;
    expect(verifyStripe("whsec", body, stripe)).toBe(true);
    expect(verifyStripe("whsec", body, `t=${t},v1=00`)).toBe(false);
    expect(verifySentry("s", body, createHmac("sha256", "s").update(body).digest("hex"))).toBe(true);
  });
});
