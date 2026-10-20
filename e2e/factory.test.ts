import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestKiln, DecisionJudge, FakeClock, FakeJudge, sampleTree, waitFor, type Run } from "@kiln/engine";
import { FakeProvider } from "@kiln/decide";
import { FakeForge, normalizeGitHub, normalizeSlack } from "@kiln/integrations";
import { describe, expect, it } from "vitest";

const repo = { owner: "acme", name: "web" };

function loadDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else out[relative(dir, f)] = readFileSync(f, "utf8");
    }
  };
  walk(dir);
  return out;
}

describe("M4-T1 gates engine", () => {
  it("nudges and parks an expired spec approval", async () => {
    const clock = new FakeClock();
    const { kiln, chat } = createTestKiln({ clock });
    const { started } = await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: "G1", event: { type: "app_mention", channel: "C1", ts: "1.0", text: "@webapp redesign the billing page\n- show invoices\n- show plan" } })!);
    await waitFor(kiln, started[0]!.id, ["awaiting_spec"]);
    clock.advance(25 * 3_600_000);
    await kiln.tick();
    expect(chat.inThread("C1", "1.0").filter((m) => m.text.startsWith("Reminder:"))).toHaveLength(1);
    clock.advance(48 * 3_600_000);
    await kiln.tick();
    const wi = kiln.workflow.get(started[0]!.id)!;
    expect(wi.state).toBe("blocked");
    expect(wi.blockedReason).toContain("expired without a decision");
  });

  it("applies the expiry action of question, preview, merge and custom gates", async () => {
    const clock = new FakeClock();
    const { kiln } = createTestKiln({ clock });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "T", body: "", source: { provider: "api" }, requester: "a" });
    const q = await kiln.gates.open({ workItem: wi, kind: "question", name: "q", title: "Which color?", def: { kind: "question", approvers: ["requester"], expire: "1h -> reject" } });
    const p = await kiln.gates.open({ workItem: wi, kind: "preview", name: "preview-acceptance", title: "Preview" });
    const m = await kiln.gates.open({ workItem: wi, kind: "merge", name: "merge", title: "Merge" });
    const c = await kiln.gates.open({ workItem: wi, kind: "custom", name: "legal", title: "Legal sign-off", def: { kind: "custom", approvers: ["legal@acme.test"], expire: "2h -> approve", rule: "risk.high < 0.5" } });
    clock.advance(3 * 3_600_000);
    await kiln.tick();
    expect(kiln.gates.get(q.id)!.state).toBe("rejected");
    expect(kiln.gates.get(c.id)!.state).toBe("approved");
    expect(kiln.gates.get(p.id)!.state).toBe("open");
    clock.advance(70 * 3_600_000);
    await kiln.tick();
    expect(kiln.gates.get(p.id)!.state).toBe("expired");
    expect(kiln.gates.get(m.id)!.nudges).toBeGreaterThanOrEqual(1);
    expect(c.assignees).toEqual(["legal@acme.test"]);
  });
});

describe("M4-T2 optional pipeline graphs", () => {
  const tree = sampleTree({
    "pipelines/feature.yaml": `stages:
  - { id: triage,  agent: triage }
  - { id: spec,    agent: spec, skip_if: "triage.size in ['xs','s']", gate: spec-approval }
  - { id: build,   agent: implement, fan_out: per_user_story }
  - { id: verify,  agent: verify, requires: [ci_green, criteria_videos], on_fail: build, max_loops: 3 }
  - { id: preview, action: preview.deploy, gate: preview-acceptance }
  - { id: review,  agent: review, advisory: true }
  - { id: handoff, action: handoff }
`,
    "gates/spec-approval.yaml": "kind: approval\napprovers: [requester, role:po]\nnudge: 24h\nexpire: 72h -> park\n",
    "gates/preview-acceptance.yaml": "kind: preview\napprovers: [requester, role:po]\n",
    "factory.yaml": sampleTree()["factory.yaml"]!.replace("budgets:", "defaultPipeline: feature\nbudgets:"),
  });

  it("runs the feature pipeline with the spec stage", async () => {
    const { kiln, forge } = createTestKiln({ tree });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Team invites", body: "- Admins can invite by email\n- Invites expire after 7 days", source: { provider: "api" }, requester: "alice" });
    await kiln.workflow.advance(wi.id);
    expect(kiln.workflow.get(wi.id)!.state).toBe("awaiting_spec");
    await kiln.gates.decide(kiln.gates.inbox("alice")[0]!.id, { decision: "approve", by: "alice", via: "web" });
    const at = await waitFor(kiln, wi.id, ["awaiting_preview", "blocked"]);
    expect(at.state).toBe("awaiting_preview");
    // fan_out: one implement run per user story
    expect(kiln.runs.list({ workItemId: wi.id, agent: "implement" })).toHaveLength(2);
    expect(Object.keys(at.evidence!.criteria).sort()).toEqual(["AC1", "AC2"]);
    expect(forge.comments.some((c) => c.number === at.pr!.number && c.body.includes(at.previewUrl!))).toBe(true);
  });

  it("skips the spec stage for small work", async () => {
    const { kiln } = createTestKiln({ tree });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo in footer", body: "", source: { provider: "api" }, requester: "alice" });
    await kiln.workflow.advance(wi.id);
    const at = kiln.workflow.get(wi.id)!;
    expect(at.state).toBe("awaiting_preview");
    expect(at.spec).toBeUndefined();
    expect(at.conversation.some((c) => c.text.startsWith("Skipping spec"))).toBe(true);
  });

  it("loops verify back to build when CI fails, up to max_loops", async () => {
    const { kiln, forge } = createTestKiln({ tree });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo in nav", body: "", source: { provider: "api" }, requester: "alice" });
    const branch = `kiln/${wi.id.replace(/^wi_/, "")}-fix-typo-in-nav`;
    forge.setChecks(repo, branch, { status: "failure", runs: [{ name: "unit", conclusion: "failure" }] });
    await kiln.workflow.advance(wi.id);
    const at = kiln.workflow.get(wi.id)!;
    expect(at.state).toBe("blocked");
    expect(at.loops.verify).toBe(4);
    expect(kiln.gates.inbox("alice").some((g) => g.name === "verify-stuck")).toBe(true);
  });
});

describe("M4-T3 inbox: Slack and web decide the same way", () => {
  it("a PO approves a spec from Slack and from the web with the same result", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const start = async (ts: string) =>
      (await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: `E${ts}`, event: { type: "app_mention", channel: "C2", ts, user: "pm", text: "@webapp add exports\n- CSV export\n- PDF export" } })!)).started[0]!;
    const a = await start("10.0");
    const b = await start("20.0");
    await waitFor(kiln, a.id, ["awaiting_spec"]);
    await waitFor(kiln, b.id, ["awaiting_spec"]);
    await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: "R1", event: { type: "message", channel: "C2", thread_ts: "10.0", ts: "10.5", user: "po@acme.test", text: "approve" } })!);
    const webGate = kiln.gates.list({ workItemId: b.id, state: "open" }).find((g) => g.kind === "spec")!;
    await kiln.gates.decide(webGate.id, { decision: "approve", by: "po@acme.test", via: "web" });
    const ga = kiln.gates.list({ workItemId: a.id }).find((g) => g.kind === "spec")!;
    const gb = kiln.gates.get(webGate.id)!;
    expect([ga.state, ga.decidedBy, ga.decidedVia]).toEqual(["approved", "po@acme.test", "slack"]);
    expect([gb.state, gb.decidedBy, gb.decidedVia]).toEqual(["approved", "po@acme.test", "web"]);
    const [wa, wb] = [await waitFor(kiln, a.id, ["handed_off", "blocked"]), await waitFor(kiln, b.id, ["handed_off", "blocked"])];
    expect(wa.state).toBe(wb.state);
    expect(wa.state).toBe("handed_off");
  });
});

describe("config repos on GitHub (the kiln-config layout)", () => {
  it("connects a Warp-exported config repo and applies merges to its default branch", async () => {
    const { kiln, forge } = createTestKiln();
    const exported = loadDir(fileURLToPath(new URL("../packages/definitions/fixtures/warp/08-kiln-config/", import.meta.url)));
    exported["factory.yaml"] = exported["factory.yaml"]!.replace("name: klin", "name: web").replace("owner: fishuke", "owner: acme");
    forge.createRepo({ owner: "acme", name: "kiln-config" }, exported);
    const r = await kiln.defs.connectRepo({ owner: "acme", name: "kiln-config" }, "alice");
    expect(r.ok ? r.factory : r.errors).toBe("kiln");
    const before = kiln.defs.require("kiln").appliedSha;
    // a person merges a change in the config repo
    const work = new FakeForge(forge.root);
    void work;
    await kiln.commitFiles({ owner: "acme", name: "kiln-config" }, "kiln/edit", { "skills/release/SKILL.md": "---\nname: release\ndescription: How we release\n---\nTag and ship.\n" }, "add release skill");
    const pr = await forge.openPullRequest({ repo: { owner: "acme", name: "kiln-config" }, head: "kiln/edit", title: "Add release skill", body: "" });
    await forge.merge({ owner: "acme", name: "kiln-config" }, pr.number, "alice");
    await kiln.automations.handle(normalizeGitHub("push", { ref: "refs/heads/main", after: "abc", repository: { full_name: "acme/kiln-config" } })!);
    const after = kiln.defs.require("kiln");
    expect(after.appliedSha).not.toBe(before);
    expect(kiln.defs.resolved(after.appliedSha!).parsed.skills.release).toBeDefined();
    expect(after.definitionRepo).toEqual({ owner: "acme", name: "kiln-config", ref: "main", dir: "" });
  });
});

describe("M5-T1 scorer service", () => {
  it("samples about 25% of runs and labels match a labeled set", async () => {
    const labeled: Record<string, string> = {};
    const judge = new DecisionJudge(
      new FakeProvider([(req) => ({ label: { meets: req.state.summary === "good" ? 0.95 : 0.05, misses: req.state.summary === "good" ? 0.05 : 0.95 } })]),
    );
    const { kiln } = createTestKiln({ judge, autoScore: false });
    const sha = kiln.defs.require("webapp").appliedSha!;
    let scored = 0;
    for (let i = 0; i < 200; i++) {
      const summary = i % 3 === 0 ? "bad" : "good";
      const run: Run = { id: `run_fixture_${i}`, kind: "work", factory: "webapp", agent: "implement", agentType: "IMPLEMENT", harness: "claude-code", definitionSha: sha, startState: { prompt: "", instructions: "", skills: [], repos: [] }, traceId: "t", status: "succeeded", summary, costUsd: 0, eventCount: 0, steering: [], startedAt: new Date().toISOString() };
      kiln.store.put("runs", run);
      labeled[run.id] = summary === "good" ? "meets" : "misses";
      const scores = await kiln.scoring.scoreRun(run.id);
      scored += scores.length;
      for (const s of scores) expect(s.label).toBe(labeled[run.id]);
    }
    expect(scored / 200).toBeGreaterThan(0.17);
    expect(scored / 200).toBeLessThan(0.33);
  });
});

describe("M5-T2 self-improvement with replay before the PR", () => {
  it("turns seeded failures into a definition PR with regressions and a replay table", async () => {
    const judge = new FakeJudge(({ run }) => (run.startState.instructions.includes("Lessons from reviewed failures") ? "meets" : { label: "misses", rationale: "criteria not covered by tests" }));
    const { kiln, forge } = createTestKiln({ judge, autoScore: false });
    forge.createRepo({ owner: "acme", name: "web-config" }, {
      ...sampleTree(),
      "policies/guard.yaml": "protectedPaths: [policies/**, gates/**]\ntwoApprovalPaths: [agents/implement/**]\n",
    });
    expect((await kiln.defs.connectRepo({ owner: "acme", name: "web-config" }, "alice")).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      const wi = await kiln.workflow.create({ factory: "webapp", title: `Task ${i}`, body: "", source: { provider: "api" }, requester: "a" });
      const run = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: `# Task ${i}`, workItem: wi, branch: `kiln/t${i}` });
      await kiln.scoring.scoreRun(run.id, { force: true });
    }
    expect(kiln.scoring.failures("webapp")).toHaveLength(3);
    const [p] = await kiln.improvement.check("webapp");
    expect(p).toBeDefined();
    expect(p!.passRateBefore).toBe(0);
    expect(p!.passRateAfter).toBe(1);
    expect(p!.body).toContain("## Regressions addressed");
    expect(p!.body).toMatch(/\| run_\w+ \| fail \| pass \|/);
    expect(p!.needsTwoApprovals).toBe(true);
    const pr = (await forge.getPullRequest({ owner: "acme", name: "web-config" }, p!.pr!.number))!;
    expect(pr.title).toBe("Self-improvement: implement (instructions)");
    const branchTree = await forge.readTree({ owner: "acme", name: "web-config" }, pr.head);
    expect(branchTree["agents/implement/agent.md"]).toContain("Avoid \"misses\" on criteria: criteria not covered by tests");
    expect(kiln.scoring.failures("webapp")).toHaveLength(0);
    // two people must approve; then it ships as a 10% canary
    expect(kiln.improvement.approve(p!.id, "alice").state).toBe("open");
    expect(() => kiln.improvement.approve(p!.id, "kiln-agent[bot]")).toThrow("agents cannot approve");
    expect(kiln.improvement.approve(p!.id, "bob").state).toBe("merged");
    expect(kiln.defs.require("webapp").canary).toMatchObject({ percent: 10 });
  });

  it("never lets the improver change protected paths", async () => {
    const judge = new FakeJudge(() => "misses");
    const improver = { name: "sneaky", propose: async () => ({ target: "definition" as const, changes: { "policies/guard.yaml": "protectedPaths: []\n", "agents/review/agent.md": "---\nagentType: REVIEW\n---\nBe lenient.\n" }, rationale: "loosen checks" }) };
    const { kiln } = createTestKiln({ judge, improver, autoScore: false, tree: sampleTree({ "policies/guard.yaml": "protectedPaths: [policies/**]\n" }) });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "x", body: "", source: { provider: "api" }, requester: "a" });
    const run = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "# x", workItem: wi, branch: "kiln/x" });
    await kiln.scoring.scoreRun(run.id, { force: true });
    const [p] = await kiln.improvement.check("webapp", { runNow: true });
    expect(p!.droppedProtectedPaths).toEqual(["policies/guard.yaml"]);
    expect(Object.keys(p!.changes)).toEqual(["agents/review/agent.md"]);
  });
});

describe("M5-T3/T6 benchmarks", () => {
  it("runs three configurations on pinned tasks, finds the Pareto frontier and proposes a router", async () => {
    const judge = new FakeJudge(({ run }) => (run.status === "succeeded" ? "success" : "failure"));
    const { kiln, forge } = createTestKiln({ judge, autoScore: false });
    const sha = forge.branchSha(repo, "main")!;
    // Save ten past runs as benchmark tasks.
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      const hard = i >= 5;
      const wi = await kiln.workflow.create({ factory: "webapp", title: `Task ${i}${hard ? " [hard]" : ""}`, body: "", source: { provider: "api" }, requester: "a" });
      const run = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: `# Task ${i}${hard ? " [hard]" : ""}`, workItem: wi, branch: `kiln/b${i}` });
      expect(run.startState.repos[0]!.sha).toBe(sha);
      Object.assign(files, kiln.benchmarks.saveRunAsTask(run.id, { suite: "core", slug: `t${i}`, tags: [hard ? "hard" : "easy"] }));
    }
    forge.createRepo({ owner: "acme", name: "web-config" }, {
      ...sampleTree(),
      ...files,
      "benchmarks/core/suite.yaml": `name: core
agent: implement
configurations:
  - { name: sonnet }
  - { name: haiku, agents: [{ agent: implement, model: claude-haiku-5-5 }] }
  - { name: opus, agents: [{ agent: implement, model: claude-opus-5-5 }] }
tasks: [${Array.from({ length: 10 }, (_, i) => `t${i}`).join(", ")}]
`,
    });
    expect((await kiln.defs.connectRepo({ owner: "acme", name: "web-config" }, "alice")).ok).toBe(true);
    const { summary, results } = await kiln.benchmarks.run("webapp", "core");
    expect(results).toHaveLength(30);
    const row = (n: string) => summary.find((s) => s.configuration === n)!;
    expect(row("haiku").successRate).toBe(0.5);
    expect(row("sonnet").successRate).toBe(1);
    expect(row("opus").pareto).toBe(false); // as good as sonnet, but costs more
    expect(row("sonnet").pareto && row("haiku").pareto).toBe(true);
    const router = await kiln.benchmarks.proposeRouter("webapp", "core", "alice");
    expect(router!.rules).toEqual([{ tag: "easy", model: "claude-haiku-5-5" }]);
    expect((router as { prUrl: string }).prUrl).toMatch(/acme\/web-config\/pull\/\d+/);
  }, 120_000);
});

describe("M5-T4 canary apply", () => {
  it("routes a share of new work items to the candidate and splits metrics by definition", async () => {
    const { kiln } = createTestKiln();
    const base = kiln.defs.require("webapp").appliedSha!;
    const r = kiln.defs.apply(sampleTree({ "agents/review/agent.md": "---\nagentType: REVIEW\n---\nReview harder.\n" }), { author: "a", canaryPercent: 50 });
    expect(r.ok).toBe(true);
    for (let i = 0; i < 40; i++) await kiln.workflow.create({ factory: "webapp", title: `t${i}`, body: "", source: { provider: "api" }, requester: "a" });
    const split = kiln.metrics.factory("webapp").byDefinition;
    expect(split.map((s) => s.sha).sort()).toEqual([base, r.ok ? r.sha : ""].sort());
    expect(Math.min(...split.map((s) => s.workItems))).toBeGreaterThan(8);
  });
});

describe("M5-T5 dashboard metrics", () => {
  it("computes PR activity, autonomy, cycle time and cost from fixtures", () => {
    const { kiln } = createTestKiln();
    const sha = kiln.defs.require("webapp").appliedSha!;
    const now = Date.now();
    const iso = (h: number) => new Date(now - h * 3_600_000).toISOString();
    const wi = (id: string, extra: object) =>
      kiln.store.put("work_items", { id, factory: "webapp", title: id, body: "", source: { provider: "api" }, requester: "a", state: "handed_off", definitionSha: sha, loops: {}, conversation: [], humanTouches: 1, costUsd: 0, createdAt: iso(10), updatedAt: iso(1), ...extra });
    wi("w1", { state: "complete", completion: { by: "merge", ref: "x" }, pr: { repo: "acme/web", number: 1, url: "u" }, completedAt: iso(6) });
    wi("w2", { state: "complete", completion: { by: "merge", ref: "y" }, pr: { repo: "acme/web", number: 2, url: "u" }, completedAt: iso(2), humanTouches: 4 });
    wi("w3", { pr: { repo: "acme/web", number: 3, url: "u" } });
    const run = (id: string, wiId: string, agent: string, cost: number) => kiln.store.put("runs", { id, kind: "work", factory: "webapp", workItemId: wiId, agent, agentType: "X", harness: "fake", definitionSha: sha, startState: { prompt: "", instructions: "", skills: [], repos: [] }, traceId: "t", status: "succeeded", costUsd: cost, eventCount: 0, steering: [], startedAt: iso(5) });
    run("r1", "w1", "implement", 2);
    run("r2", "w2", "implement", 4);
    run("r3", "w3", "review", 1);
    const m = kiln.metrics.factory("webapp");
    expect(m).toMatchObject({ prsOpened: 3, prsMerged: 2, autonomy: 0.5, autonomousMerged: 1, humanTouchesPerPr: 2, cycleTimeHoursMedian: 6, costUsd: 7, costPerMergedPrUsd: 3.5 });
    expect(m.byAgent.find((a) => a.agent === "implement")).toMatchObject({ runs: 2, costUsd: 6, costPerMergedPrUsd: 3 });
  });
});

describe("M6 planning and portfolio", () => {
  it("rolls up three factories in the portfolio", async () => {
    const { kiln, forge } = createTestKiln({ preview: false });
    for (const [alias, r] of [["api", "acme/api"], ["mobile", "acme/mobile"]] as const) {
      forge.createRepo({ owner: "acme", name: r.split("/")[1]! });
      expect(kiln.defs.apply(sampleTree({}, alias, alias, r), { author: "a" }).ok).toBe(true);
    }
    const project = kiln.planning.createProject({ name: "Customer portal", owner: "pm@acme.test", factories: ["webapp", "api", "mobile"] });
    for (const f of ["webapp", "api", "mobile"]) {
      const wi = await kiln.workflow.create({ factory: f, title: "Fix typo", body: "", source: { provider: "api" }, requester: "a", projectId: project.id });
      await kiln.workflow.advance(wi.id);
    }
    const p = kiln.planning.portfolio().projects[0]!;
    expect(p.factories).toHaveLength(3);
    expect(p.totals.prsOpened).toBe(3);
    expect(p.totals.pendingDecisions).toBe(3);
    expect(p.totals.costUsd).toBeGreaterThan(0);
  });

  it("turns a PRD into a linked epic with well-formed issues in the tracker", async () => {
    const { kiln, tracker } = createTestKiln({ tree: sampleTree({ "agents/planner/agent.md": "---\nagentType: PLAN\n---\nPlan roadmaps.\n" }) });
    const project = kiln.planning.createProject({ name: "Billing", owner: "pm@acme.test", factories: ["webapp"] });
    const prd = `## Self-serve billing
### Show the current plan on the billing page
  - AC: the plan name and price are visible
### Let admins change plans
  - only admins see the change button
  - the new price applies from the next invoice
### Download invoices as PDF
### Email receipts after payment
### Show failed payments with a retry button
  - a failed payment shows a red banner
`;
    const roadmap = await kiln.planning.plan(project.id, { goal: "Self-serve billing", prd, by: "pm@acme.test" });
    expect(roadmap.epics).toHaveLength(1);
    const epic = tracker.issues.find((i) => i.labels.includes("epic"))!;
    const children = tracker.issues.filter((i) => i.parentId === epic.id);
    expect(children.length).toBeGreaterThanOrEqual(5);
    for (const c of children) {
      expect(c.body).toMatch(/## Acceptance criteria\n- \[ \] AC1: /);
      expect(c.labels).toEqual(["factory:webapp"]);
    }
    expect(kiln.runs.list({ kind: "planner" })).toHaveLength(1);
  });

  it("lists pending decisions with deep links in the weekly digest", async () => {
    const { kiln } = createTestKiln();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "x", body: "", source: { provider: "api" }, requester: "pm@acme.test" });
    const g = await kiln.gates.open({ workItem: wi, kind: "spec", name: "spec-approval", title: "Approve the spec for x" });
    const digest = kiln.planning.digest().find((d) => d.person === "pm@acme.test")!;
    expect(digest.items[0]).toMatchObject({ gateId: g.id, link: `http://localhost:3000/inbox/${g.id}` });
    expect(digest.text).toContain(`http://localhost:3000/inbox/${g.id}`);
  });

  it("M6-T4 a convention taught in one run is applied in a later run", async () => {
    const { kiln, forge } = createTestKiln({ preview: false });
    const first = await kiln.workflow.create({ factory: "webapp", title: "Add a logo", body: "remember: Use named exports", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(first.id);
    const mem = kiln.memories.list("webapp", "proposed")[0]!;
    expect(mem.title).toBe("Use named exports");
    await kiln.memories.accept(mem.id, "lead@acme.test");
    expect(kiln.defs.tree(kiln.defs.require("webapp").appliedSha!)!["memories/use-named-exports.md"]).toContain("Use named exports");
    const second = await kiln.workflow.create({ factory: "webapp", title: "Fix typo in exports page", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(second.id);
    const w = kiln.workflow.get(second.id)!;
    const file = (await forge.readTree(repo, w.branch!))["src/kiln/fix-typo-in-exports-page.ts"];
    expect(file).toContain("// convention: Use named exports");
  });

  it("M6-T5 publishes a skill from one factory and installs it in another", async () => {
    const { kiln, forge } = createTestKiln();
    forge.createRepo({ owner: "acme", name: "api" });
    const apiTree = sampleTree({}, "api", "api", "acme/api");
    delete apiTree["skills/house-style/SKILL.md"];
    kiln.defs.apply(apiTree, { author: "a" });
    const listing = kiln.skills.publish("webapp", "house-style", "platform@acme.test");
    const r = await kiln.skills.install(listing.id, "api", "lead@acme.test");
    expect(r.sha).toBeDefined();
    expect(kiln.defs.resolved(kiln.defs.require("api").appliedSha!).parsed.skills["house-style"]).toBeDefined();
    const row = kiln.skills.catalog().find((s) => s.name === "house-style")!;
    expect(row.factories.sort()).toEqual(["api", "webapp"]);
  });
});
