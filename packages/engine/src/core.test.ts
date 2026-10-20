import { FakeProvider, heuristicRule, type FakeRule } from "@kiln/decide";
import { FakeHarness, type HarnessAdapter } from "@kiln/harness";
import { FakeForge } from "@kiln/integrations";
import { LocalSandboxProvider, type SandboxProvider } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import { classifyError, KilnError } from "./errors";
import { fakeAgents, fakeAgentScript } from "./fake-agents";
import { validateFiles } from "./factory-files";
import { runState, taskStage } from "./run-state";
import { parseTicketRef } from "./tasks";
import { createTestKiln, sampleTree, waitFor } from "./testing";

const fake = new FakeHarness(fakeAgentScript);

describe("errors and retries", () => {
  it("classifies errors into FAILED and ERROR codes", () => {
    expect(classifyError(new Error("monthly budget of $10 for x reached"))).toMatchObject({ code: "budget_exceeded", retryable: false });
    expect(classifyError(new Error("socket hang up"))).toMatchObject({ code: "resource_unavailable", retryable: true });
    expect(classifyError(new Error("git clone https://x failed: nope"))).toMatchObject({ code: "environment_setup_failed" });
    expect(classifyError(new KilnError("integration_not_configured", "no slack"))).toMatchObject({ code: "integration_not_configured", retryable: false });
    expect(classifyError(new Error("something odd"))).toMatchObject({ code: "internal_error", retryable: true });
  });

  it("retries a retryable platform error on the same run and reports the final state", async () => {
    let starts = 0;
    const flaky: HarnessAdapter = {
      type: "fake",
      start: async (opts) => {
        starts += 1;
        if (starts < 3) throw new Error("ECONNRESET talking to the model");
        return fake.start(opts);
      },
    };
    const { kiln } = createTestKiln({ harness: () => flaky });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const run = await kiln.runs.execute({ factory: "webapp", sha, agent: "foreman", prompt: "route this", push: false });
    expect(run).toMatchObject({ status: "succeeded", attempt: 3 });
    expect(kiln.runs.events(run.id).filter((e) => e.type === "retry")).toHaveLength(2);
    expect(kiln.runs.list().filter((r) => r.agent === "foreman")).toHaveLength(1);
  });

  it("does not retry user-side errors; they end FAILED with a code", async () => {
    const broken: HarnessAdapter = { type: "fake", start: async () => Promise.reject(new KilnError("insufficient_credits", "the provider quota is used up")) };
    const { kiln } = createTestKiln({ harness: () => broken });
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "foreman", prompt: "x", push: false });
    expect(run).toMatchObject({ status: "failed", attempt: 1, error: { code: "insufficient_credits", retryable: false } });
    expect(runState(run)).toBe("FAILED");
  });
});

describe("default runner image", () => {
  it("uses KILN_RUNNER_IMAGE for agents without a runner, on the configured backend", async () => {
    const images: string[] = [];
    const local = new LocalSandboxProvider();
    const recording: SandboxProvider = { name: "docker", create: (spec) => (images.push(spec.runner.image), local.create({ ...spec, runner: { ...spec.runner, backend: "local" } })), resume: (ref, spec, store) => local.resume(ref, spec, store) };
    const { kiln } = createTestKiln({ sandboxes: { local, docker: recording }, defaultBackend: "docker", defaultImage: "ghcr.io/acme/kiln-runner:1" });
    await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "foreman", prompt: "route this", push: false });
    expect(images).toEqual(["ghcr.io/acme/kiln-runner:1"]);
  });

  it("lets every run reach Kiln itself (the command guard and the Kiln MCP server) through the egress allowlist", async () => {
    const egress: string[][] = [];
    const local = new LocalSandboxProvider();
    const recording: SandboxProvider = { name: "docker", create: (spec) => (egress.push(spec.runner.egress ?? []), local.create({ ...spec, runner: { ...spec.runner, backend: "local" } })), resume: (ref, spec, store) => local.resume(ref, spec, store) };
    const { kiln } = createTestKiln({ sandboxes: { local, docker: recording }, defaultBackend: "docker", publicUrl: "https://kiln-api.acme.test" });
    await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "foreman", prompt: "route this", push: false });
    expect(egress[0]).toContain("kiln-api.acme.test");
  });

  it("runs a declared runner without an image on KILN_RUNNER_IMAGE; an explicit image still wins (#13)", async () => {
    const run = async (runnerYaml: string) => {
      const images: string[] = [];
      const local = new LocalSandboxProvider();
      const recording: SandboxProvider = { name: "docker", create: (spec) => (images.push(spec.runner.image), local.create({ ...spec, runner: { ...spec.runner, backend: "local" } })), resume: (ref, spec, store) => local.resume(ref, spec, store) };
      const tree = sampleTree({ "runners/plain.yaml": runnerYaml, "agents/plain/agent.md": "---\nagentType: CUSTOM\nrunner: plain\n---\nDo it.\n" });
      const { kiln } = createTestKiln({ tree, sandboxes: { local, docker: recording }, defaultBackend: "docker", defaultImage: "ghcr.io/acme/kiln-runner:1" });
      await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "plain", prompt: "go", push: false });
      return images;
    };
    expect(await run("backend: docker\nsetupCommands: []\n")).toEqual(["ghcr.io/acme/kiln-runner:1"]);
    expect(await run("image: ghcr.io/acme/custom:2\nbackend: docker\n")).toEqual(["ghcr.io/acme/custom:2"]);
  });
});

describe("runs: sources, metadata, follow-ups, interrupts and subagent trees", () => {
  it("records source, title, creator, root and metadata, and rejects bad metadata", async () => {
    const { kiln } = createTestKiln();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Footer", body: "", source: { provider: "slack", channel: "C1" }, requester: "po@acme.test" });
    const run = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "foreman", prompt: "go", workItem: wi, push: false, metadata: { ticket: "ENG-1" } });
    expect(run).toMatchObject({ source: "SLACK", title: "Footer", creator: "po@acme.test", executor: "agent:foreman", rootRunId: run.id, metadata: { ticket: "ENG-1" }, idleTimeoutMinutes: 10 });
    const second = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "foreman", prompt: "again", workItem: wi, push: false });
    expect(second.rootRunId).toBe(run.id);
    await expect(kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "foreman", prompt: "x", metadata: { "bad key!": "v" } })).rejects.toThrow(/metadata key/);
    expect(kiln.runQuery.list({ metadata: { ticket: "ENG-1" } }).runs.map((r) => r.id)).toEqual([run.id]);
    expect(kiln.runQuery.list({ source: ["SLACK"], limit: 1 }).pageInfo.hasNextPage).toBe(true);
  });

  it("a follow-up on a finished run continues it; interrupt blocks a live one; cancel cascades to subagents", async () => {
    const tree = sampleTree({ "agents/helper/agent.md": "---\nagentType: CUSTOM\nspawnableBy: [implement]\n---\nHelp.\n" });
    const children: string[] = [];
    let kiln!: ReturnType<typeof createTestKiln>["kiln"];
    const harness = new FakeHarness(async (ctx) => {
      if (ctx.opts.prompt.includes("[hold]")) {
        if (ctx.opts.env?.KILN_AGENT_TYPE === "IMPLEMENT") children.push((await kiln.runs.spawn(ctx.opts.env.KILN_RUN_ID!, { agent: "helper", prompt: "[hold] help", wait: false })).id);
        while (!ctx.signal.cancelled) await new Promise((r) => setTimeout(r, 10));
        return { summary: "stopped" };
      }
      return { summary: `done: ${ctx.opts.prompt.split("\n").at(-1)}` };
    });
    ({ kiln } = createTestKiln({ harness: () => harness, tree }));
    const sha = kiln.defs.require("webapp").appliedSha!;
    const first = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "build it", push: false });
    const r = await kiln.runs.followup(first.id, { message: "also add a test", by: "alice" });
    expect(r.delivered).toBe("continued");
    expect(r.run).toMatchObject({ continuationOf: first.id, creator: "alice" });
    expect(r.run.startState.prompt).toContain("## Follow-up from alice");

    const parent = await kiln.runs.startInBackground({ factory: "webapp", sha, agent: "implement", prompt: "[hold] build", push: false });
    for (let i = 0; i < 200 && !children.length; i++) await new Promise((res) => setTimeout(res, 10));
    expect(children).toHaveLength(1);
    const child = kiln.runs.get(children[0]!)!;
    expect(child).toMatchObject({ parentRunId: parent.id, rootRunId: parent.id, source: "ORCHESTRATION", creator: "agent:implement", idleTimeoutMinutes: 60 });
    expect(kiln.runQuery.list({ ancestorRunId: parent.id }).runs.map((x) => x.id)).toEqual([child.id]);
    const cancelled = await kiln.runs.cancelTree(parent.id, "alice");
    expect(cancelled.sort()).toEqual([parent.id, child.id].sort());
    const finished = (id: string) => ["cancelled", "succeeded", "failed", "error"].includes(kiln.runs.get(id)!.status);
    for (let i = 0; i < 500 && !(finished(parent.id) && finished(child.id)); i++) await new Promise((res) => setTimeout(res, 10));
    expect(kiln.runs.get(parent.id)!.status).toBe("cancelled");
    expect(kiln.runs.get(child.id)!.status).toBe("cancelled");

    const live = await kiln.runs.startInBackground({ factory: "webapp", sha, agent: "foreman", prompt: "[hold] wait", push: false });
    for (let i = 0; i < 200 && !kiln.runs.isActive(live.id); i++) await new Promise((res) => setTimeout(res, 10));
    await kiln.runs.interrupt(live.id, "alice");
    for (let i = 0; i < 200 && kiln.runs.isActive(live.id); i++) await new Promise((res) => setTimeout(res, 10));
    expect(runState(kiln.runs.get(live.id)!)).toBe("BLOCKED");
    const timeline = kiln.runQuery.timeline(parent.id).map((e) => e.type);
    expect(timeline).toEqual(expect.arrayContaining(["created", "started", "spawn", "subagent.started", "subagent.finished", "finished"]));
    expect(kiln.runQuery.conversation(first.id).messages[1]).toMatchObject({ role: "user", text: "build it" });
    expect(kiln.runQuery.transcript(first.id)).toContain("## Prompt");
  });
});

describe("tasks", () => {
  it("maps states to stages, dispatches with a ticket, lists, patches, soft-deletes and finds by run", async () => {
    const { kiln } = createTestKiln({ preview: false });
    expect(parseTicketRef("linear:PAY-123", "https://linear.app/x/PAY-123")).toEqual({ source: { provider: "linear", issueId: "PAY-123", url: "https://linear.app/x/PAY-123" }, trackerKey: "PAY-123" });
    expect(taskStage({ state: "awaiting_spec" })).toBe("SPEC");
    expect(taskStage({ state: "blocked", stage: "review" })).toBe("REVIEW");
    const d = await kiln.tasks.dispatch("webapp", { prompt: "Fix typo in the footer", ticketRef: "linear:ENG-7", by: "po@acme.test" });
    expect(d).toMatchObject({ factory: "webapp", foremanAgent: "foreman", ticketRef: "linear:ENG-7" });
    const wi = await waitFor(kiln, d.taskId, ["handed_off"]);
    const task = kiln.tasks.get(wi.id);
    expect(task).toMatchObject({ stage: "REVIEW", ticketSource: "linear", ticketId: "ENG-7", author: "po@acme.test" });
    expect(task.outputs.map((o) => o.type)).toContain("PULL_REQUEST");
    expect(kiln.tasks.byRun(kiln.runs.list({ workItemId: wi.id })[0]!.id)?.id).toBe(wi.id);
    expect(kiln.tasks.list({ factory: "webapp", stage: ["REVIEW"] }).tasks.map((t) => t.id)).toEqual([wi.id]);
    expect(kiln.tasks.list({ q: "footer" }).tasks).toHaveLength(1);
    const moved = await kiln.tasks.patch(wi.id, { stage: "IMPLEMENT", title: "Fix the footer typo" }, "po@acme.test");
    expect(moved).toMatchObject({ stage: "IMPLEMENT", title: "Fix the footer typo" });
    const done = await kiln.tasks.patch(wi.id, { stage: "COMPLETE" }, "po@acme.test");
    expect(done).toMatchObject({ stage: "COMPLETE", state: "complete" });
    await kiln.tasks.remove(wi.id, "po@acme.test");
    expect(kiln.tasks.list({ factory: "webapp" }).tasks).toHaveLength(0);
    expect(() => kiln.tasks.get(wi.id)).toThrow(/unknown task/);
  });

  it("plan mode always stops for an approved plan first", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const d = await kiln.tasks.dispatch("webapp", { prompt: "Fix typo in nav", mode: "plan", by: "po@acme.test" });
    await waitFor(kiln, d.taskId, ["awaiting_spec"]);
    expect(kiln.gates.list({ workItemId: d.taskId, state: "open" })[0]!.kind).toBe("spec");

    const noSpec = sampleTree();
    delete noSpec["agents/spec/agent.md"];
    const second = createTestKiln({ preview: false, tree: noSpec }).kiln;
    const d2 = await second.tasks.dispatch("webapp", { prompt: "Rework the cart", mode: "plan", by: "po@acme.test" });
    await waitFor(second, d2.taskId, ["awaiting_spec"]);
    const gate = second.gates.list({ workItemId: d2.taskId, state: "open" })[0]!;
    expect(gate.title).toMatch(/^Approve the plan/);
    const planRun = second.runs.get(gate.runId!)!;
    expect(planRun).toMatchObject({ mode: "plan" });
    expect(planRun.startState.instructions).toContain("## Plan mode");
  });

  it("runs a factory blueprint: stages, edges and staffing", async () => {
    const tree = sampleTree({
      "factory.yaml": sampleTree()["factory.yaml"]!.replace(
        "budgets:",
        "blueprint:\n  entry: draft\n  stages:\n    draft: { prompt: Write the change., outputs: The branch. }\n    check: { prompt: Review the change. }\n  edges:\n    to-check: { from: draft, to: check, when: the change is written }\n  staffing: { foreman: foreman, draft: implement, check: review }\nbudgets:",
      ),
    });
    const { kiln } = createTestKiln({ tree, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const done = await waitFor(kiln, wi.id, ["handed_off"]);
    expect(done.pr).toBeDefined();
    expect(kiln.runs.list({ workItemId: wi.id }).map((r) => `${r.agent}:${r.stage}`).sort()).toEqual(["implement:draft", "review:check"]);
  });
});

describe("inbox and definition changes", () => {
  it("lists items per person with read and resolved state, and clears answered ones", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Team invites", body: "- Admins invite by email\n- Invites expire\n- Large redesign", source: { provider: "api" }, requester: "po@acme.test" });
    await kiln.workflow.advance(wi.id);
    const mine = kiln.inbox.list({ user: "po@acme.test" });
    const item = mine.items.find((i) => i.taskId === wi.id)!;
    expect(item).toMatchObject({ kind: "spec_review", isRead: false, stage: "SPEC" });
    expect(kiln.inbox.list({ user: "someone@acme.test" }).items).toHaveLength(0);
    expect(kiln.inbox.list({ user: "someone@acme.test", scope: "team" }).items.length).toBeGreaterThan(0);
    expect(kiln.inbox.markRead("po@acme.test", [item.id, "nope"])).toEqual([{ id: item.id, ok: true }, { id: "nope", ok: false }]);
    expect(kiln.inbox.list({ user: "po@acme.test", read: false }).items.find((i) => i.id === item.id)).toBeUndefined();
    kiln.inbox.resolve("po@acme.test", [item.id]);
    expect(kiln.inbox.list({ user: "po@acme.test" }).items.find((i) => i.id === item.id)).toBeUndefined();
    kiln.inbox.undoResolve("po@acme.test", [item.id]);
    expect(kiln.inbox.list({ user: "po@acme.test" }).items.find((i) => i.id === item.id)).toBeDefined();
    await kiln.gates.decide(item.gateId!, { decision: "approve", by: "po@acme.test", via: "test" });
    expect(kiln.inbox.list({ user: "po@acme.test" }).items.find((i) => i.id === item.id)).toBeUndefined();
  });

  it("agents propose definition changes; people approve and merge or request changes", async () => {
    const { kiln } = createTestKiln();
    expect(() => kiln.definitionChanges.propose({ factory: "webapp", title: "bad", files: { "agents/x/agent.md": "---\nagentType: NOPE\n---\n" }, by: "agent:foreman" })).toThrow(/invalid/);
    const ch = kiln.definitionChanges.propose({ factory: "webapp", title: "Add docs agent", files: { "agents/docs/agent.md": "---\nagentType: CUSTOM\n---\nWrite docs.\n" }, by: "agent:foreman" });
    expect(ch.diff.added).toEqual(["agent/docs"]);
    const item = kiln.inbox.list({ user: "admin@acme.test" }).items.find((i) => i.changeId === ch.id)!;
    expect(item).toMatchObject({ kind: "spec_review", actions: ["approve_and_merge", "request_changes", "comment"] });
    await expect(kiln.definitionChanges.approve(ch.id, "agent:foreman")).rejects.toThrow(/agents cannot approve/);
    const merged = await kiln.definitionChanges.approve(ch.id, "lead@acme.test");
    expect(merged.state).toBe("merged");
    expect(kiln.defs.current("webapp").agents.docs).toBeDefined();
    const second = kiln.definitionChanges.propose({ factory: "webapp", title: "Tweak", files: { "agents/docs/agent.md": "---\nagentType: CUSTOM\n---\nWrite better docs.\n" }, by: "agent:foreman" });
    const rc = await kiln.definitionChanges.requestChanges(second.id, "lead@acme.test", "Name the docs folder");
    expect(rc).toMatchObject({ state: "changes_requested", comments: [{ text: "Name the docs folder" }] });
  });
});

describe("definition editing", () => {
  it("edits agents, settings and files on a managed factory and refuses unsafe changes", async () => {
    const { kiln } = createTestKiln();
    const r = await kiln.editor.upsertAgent("webapp", "docs", { prompt: "Write docs.", description: "Docs", model: "claude-haiku-5-5", workerHost: "farm", idleTimeoutMinutes: 15, networkPolicy: { allowedHosts: ["docs.acme.test"] } }, "lead");
    expect(r.ok && r.mode).toBe("applied");
    expect(kiln.defs.current("webapp").agents.docs).toMatchObject({ workerHost: "farm", idleTimeoutMinutes: 15, harness: { type: "claude-code", model: "claude-haiku-5-5" }, networkPolicy: { allowedHosts: ["docs.acme.test"] } });
    await kiln.editor.upsertAgent("webapp", "docs", { description: null, workerHost: null }, "lead");
    expect(kiln.defs.current("webapp").agents.docs!.workerHost).toBeUndefined();
    await expect(kiln.editor.deleteAgent("webapp", "foreman", "lead")).rejects.toThrow(/foreman cannot be deleted/);
    await expect(kiln.editor.upsertAgent("webapp", "bad", { prompt: "x", runner: "missing" }, "lead")).rejects.toThrow(/runner missing/);
    await kiln.editor.updateSettings("webapp", { alias: "Web App", description: "The storefront", credentialStrategy: "CREATOR", addRepositories: [{ owner: "acme", name: "ui", deferred: true }] }, "lead");
    const f = kiln.defs.current("webapp").factory;
    expect(f).toMatchObject({ alias: "Web App", description: "The storefront", credentialStrategy: "CREATOR" });
    expect(f.repositories.map((x) => `${x.owner}/${x.name}`)).toEqual(["acme/web", "acme/ui"]);
    expect(kiln.defs.current("webapp").agents.implement!.credentialStrategy).toBe("CREATOR");
    await kiln.editor.updateSelfImprovement("webapp", { failedRunThreshold: 5, reviewers: { type: "none" }, scorers: { criteria: false } }, "lead");
    expect(kiln.improvement.settings("webapp")).toMatchObject({ failedRunThreshold: 5, reviewers: { type: "none" }, scorers: [{ slug: "criteria", selfImprovement: false }] });
    const w = await kiln.editor.write("webapp", { "skills/house-style/SKILL.md": null }, { message: "drop skill", by: "lead" });
    expect(w.ok).toBe(true);
    expect(kiln.defs.current("webapp").parsed.skills["house-style"]).toBeUndefined();
  });

  it("opens a pull request on the config repo for repo-backed factories, and migrates managed ones", async () => {
    const { kiln, forge } = createTestKiln();
    forge.createRepo({ owner: "acme", name: "web-config" }, sampleTree({}, "Config", "configured", "acme/web"));
    const c = await kiln.defs.connectRepo({ owner: "acme", name: "web-config" }, "lead");
    expect(c.ok).toBe(true);
    const r = await kiln.editor.upsertAgent("configured", "docs", { prompt: "Write docs." }, "lead");
    expect(r.ok && r.mode).toBe("pull_request");
    expect(forge.pulls.at(-1)).toMatchObject({ repo: "acme/web-config", labels: ["kiln:definition"] });
    expect(kiln.defs.current("configured").agents.docs).toBeUndefined();

    forge.createRepo({ owner: "acme", name: "webapp-defs" }, { "README.md": "defs\n" });
    const m = await kiln.editor.migrateToRepo("webapp", { owner: "acme", name: "webapp-defs" }, "lead");
    expect(m.prUrl).toContain("acme/webapp-defs");
    expect(await kiln.editor.completeMigration("webapp")).toBe(false);
    const pr = forge.pulls.find((p) => p.url === m.prUrl)!;
    await forge.merge({ owner: "acme", name: "webapp-defs" }, pr.number, "lead");
    expect(await kiln.editor.completeMigration("webapp")).toBe(true);
    expect(kiln.defs.require("webapp").definitionRepo).toMatchObject({ owner: "acme", name: "webapp-defs" });
  });
});

describe("factory wizard", () => {
  it("creates a full factory: agents, skills, scorers, automations; and refuses alias clashes", async () => {
    const { kiln } = createTestKiln();
    const r = await kiln.wizard.create(
      { name: "Shop Front", repos: [{ owner: "acme", name: "web" }], communications: { slack: true }, tracker: { type: "linear" }, costPreset: "efficient", agents: { review: false }, automationTemplates: ["autofix-ci-failures", "linear-duplicate-check", "auto-review-prs"] },
      "lead@acme.test",
    );
    expect(r.factory?.id).toBe("shop-front");
    const resolved = kiln.defs.current("shop-front");
    expect(Object.keys(resolved.agents).sort()).toEqual(["foreman", "implement", "spec", "triage"]);
    expect(resolved.agents.triage!.harness.model).toBe("claude-haiku-5-5");
    expect(resolved.agents.foreman!.instructions).toContain("factory:shop-front");
    expect(Object.keys(resolved.parsed.skills).sort()).toEqual(["code-review", "github", "linear", "slack", "ui-verification"]);
    expect(Object.keys(resolved.parsed.scorers).sort()).toEqual(["code-quality", "efficiency", "procedure-compliance", "task-compliance", "task-correctness", "verbosity"]);
    expect(resolved.parsed.scorers["task-compliance"]!.frontmatter.agents).not.toContain("review");
    expect(resolved.automations["auto-review-prs"]!.agent).toBe("foreman");
    // No pinned image: the server's runner image (which carries the harness CLIs) applies (#13).
    expect(resolved.parsed.runners.default!.image).toBeUndefined();
    expect(Object.keys(resolved.automations)).toEqual(expect.arrayContaining(["github-issue-labeled", "linear-agent-sessions", "slack-app-mentions", "autofix-ci-failures", "linear-duplicate-check"]));
    await expect(kiln.wizard.create({ name: "Other", alias: "Shop-Front", repos: [{ owner: "acme", name: "web" }] }, "x")).rejects.toThrow(/already used/);
    await expect(kiln.wizard.create({ name: "Other", alias: "shop front", repos: [{ owner: "acme", name: "web" }] }, "x")).rejects.toThrow(/already exists/);
    await expect(kiln.wizard.create({ name: "J", repos: [{ owner: "acme", name: "web" }], automationTemplates: ["linear-duplicate-check"] }, "x")).rejects.toThrow(/needs linear/);
  });
});

describe("metrics, scorers and benchmarks", () => {
  it("reports PR metrics, costs and pull requests after a merge", async () => {
    const { kiln, forge } = createTestKiln({ preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    await kiln.workflow.advance(wi.id);
    const pr = kiln.workflow.get(wi.id)!.pr!;
    await forge.merge({ owner: "acme", name: "web" }, pr.number, "alice");
    await kiln.workflow.onPullRequestMerged(pr.repo, pr.number, "alice");
    const m = kiln.factoryMetrics.metrics("webapp", { groupByPeriod: "day" });
    expect(m).toMatchObject({ prCount: 1, mergedPrCount: 1, autonomy: 1, autonomyFunnel: { mergedWithoutHumanCodeChange: 1 } });
    expect(m.prLatency.kickoffToMerge.measuredPrCount).toBe(1);
    expect(m.deltas.mergedPrCount).toMatchObject({ previous: 0, change: 1 });
    expect(m.series!.length).toBeGreaterThanOrEqual(30);
    expect(kiln.factoryMetrics.costPerPr("webapp", {}).prCount).toBe(1);
    expect(kiln.factoryMetrics.costBreakdown("webapp", "agent", {}).groups.map((g) => g.key)).toContain("implement");
    expect(kiln.factoryMetrics.costBySize("webapp", {}).buckets.find((b) => b.bucket === "S")!.prCount).toBe(1);
    expect(kiln.factoryMetrics.runBreakdown("webapp", "status", {}).groups[0]).toMatchObject({ key: "SUCCEEDED" });
    const prs = kiln.factoryMetrics.pullRequests("webapp", { state: ["merged"] }).pullRequests;
    expect(prs[0]).toMatchObject({ number: pr.number, state: "merged", humanCodeChange: false });
    expect(prs[0]!.additions).toBeGreaterThan(0);
  });

  it("scorer CRUD, manual dispatch, results and metrics", async () => {
    const { kiln } = createTestKiln();
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "Add a footer", push: false });
    await kiln.scorers.create("webapp", { name: "Docs Quality", scoringPrompt: "Are the docs clear?", classifications: [{ value: "meets", score: 1 }, { value: "misses", score: 0 }], threshold: 1, scopeMode: "selected_agents", agents: [{ name: "implement", includeDescendants: true }], model: "claude-haiku-5-5" }, "lead");
    expect(kiln.scorers.get("webapp", "docs-quality")).toMatchObject({ name: "Docs Quality", version: 1, resultCount: 0 });
    const d = await kiln.scorers.dispatch("webapp", [run.id], ["docs-quality"], "lead");
    expect(d).toEqual([expect.objectContaining({ status: "dispatched" })]);
    const again = await kiln.scorers.dispatch("webapp", [run.id], ["docs-quality"], "lead");
    expect(again[0]!.status).toBe("dispatched");
    expect(kiln.scorers.results("webapp", "docs-quality", { includeReasons: true }).results).toHaveLength(1);
    expect(kiln.scorers.metrics("webapp", "docs-quality", { includeCost: true })).toMatchObject({ passCount: 1, failCount: 0, passRate: 1, totalCostUsd: 0 });
    await kiln.scorers.update("webapp", "docs-quality", { threshold: 0.5 }, "lead");
    expect(kiln.scorers.get("webapp", "docs-quality")).toMatchObject({ passingScore: 0.5, version: 2 });
    expect(kiln.scorers.runScores(run.id).map((s) => s.triggerSource)).toContain("manual");
    const removed = await kiln.scorers.remove("webapp", "docs-quality", "lead");
    expect(removed.deletedScores).toBe(1);
  });

  it("benchmark suites, tasks and runs with recommendations", async () => {
    const { kiln, forge } = createTestKiln();
    const sha = forge.branchSha({ owner: "acme", name: "web" }, "main")!;
    await kiln.benchmarkAdmin.createSuite(
      "webapp",
      {
        name: "core",
        agent: "implement",
        configurations: [{ name: "sonnet", agents: [{ agent: "implement", model: "claude-sonnet-5-5" }] }, { name: "haiku", agents: [{ agent: "implement", model: "claude-haiku-5-5" }] }],
        firstTask: { title: "Footer link", prompt: "Add a footer link", successCriteria: ["The footer has a link"], startingRepoRefs: [`github.com:acme/web@${sha}`] },
      },
      "lead",
    );
    const again = await kiln.benchmarkAdmin.createTask("webapp", "core", { slug: "footer-link", title: "Footer link", prompt: "Add a footer link", successCriteria: ["The footer has a link"], startingRepoRefs: [`github.com:acme/web@${sha}`] }, "lead");
    expect(again.created).toBe(false);
    const run = await kiln.benchmarkAdmin.start("webapp", "core", { repetitions: 2 }, "lead", { wait: true });
    expect(kiln.benchmarkAdmin.run(run.id).state).toBe("completed");
    expect(kiln.benchmarkAdmin.trials(run.id)).toHaveLength(4);
    const res = kiln.benchmarkAdmin.results(run.id);
    expect(res.coverage).toBe(1);
    expect(res.recommendation).toMatchObject({ lowestCost: "haiku" });
    expect(res.chart.points).toHaveLength(2);
    expect(res.narrative.availability).toBe("available");
    const trial = kiln.benchmarkAdmin.trials(run.id)[0]!;
    expect(kiln.runs.get(trial.agentRunId!)).toMatchObject({ kind: "benchmark", source: "BENCHMARK_TRIAL", metadata: { benchmarkRun: run.id } });
  });
});

describe("factory files: schemas and validation", () => {
  it("reports diagnostics with lines and what is resolved on apply", () => {
    const ok = validateFiles(Object.entries(sampleTree()).map(([path, content]) => ({ path, content })));
    expect(ok.ok).toBe(true);
    expect(ok.deferredResolutions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "model", value: "claude-sonnet-5-5" }), expect.objectContaining({ kind: "alias" })]));
    const bad = validateFiles([...Object.entries(sampleTree()).map(([path, content]) => ({ path, content })), { path: "agents/x/agent.md", content: "---\nagentType: NOPE\n---\n" }]);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.find((d) => d.severity === "error")).toMatchObject({ path: "agents/x/agent.md", line: 2 });
    expect(() => validateFiles(Array.from({ length: 257 }, (_, i) => ({ path: `f${i}`, content: "" })))).toThrow(/at most 256/);
  });
});

describe("computer use", () => {
  it("gives Claude Code agents a recorded browser unless the agent turns it off, and attaches what it saves to the pull request", async () => {
    const seen: Record<string, { servers: string[]; args: string[]; instructions: string }> = {};
    const harness = new FakeHarness(async (ctx) => {
      const browser = ctx.opts.mcpServers?.find((s) => s.name === "browser");
      seen[ctx.opts.env?.KILN_AGENT_TYPE ?? "?"] = { servers: (ctx.opts.mcpServers ?? []).map((s) => s.name), args: browser && "command" in browser ? (browser.args ?? []) : [], instructions: ctx.opts.instructions };
      if (ctx.opts.env?.KILN_AGENT_TYPE === "VERIFY") await ctx.opts.sandbox.writeBytes(`${ctx.opts.cwd ? `${ctx.opts.cwd}/` : ""}.kiln/artifacts/browser/checkout.png`, new Uint8Array([137, 80, 78, 71]));
      return fakeAgentScript(ctx);
    });
    const tree = sampleTree({ "agents/review/agent.md": "---\nagentType: REVIEW\ncomputerUse: false\n---\nReview adversarially.\n" });
    const { kiln, forge } = createTestKiln({ harness: () => harness, tree, preview: false, browserMcp: { command: "playwright-mcp" } });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix the checkout button", body: "It is misaligned", source: { provider: "api" }, requester: "po@acme.test" });
    void kiln.workflow.advance(wi.id);
    await waitFor(kiln, wi.id, ["handed_off"]);
    expect(seen.VERIFY!.servers).toContain("browser");
    expect(seen.VERIFY!.args).toEqual(expect.arrayContaining(["--headless", "--caps=devtools,vision", "--output-dir", ".kiln/artifacts/browser"]));
    expect(seen.VERIFY!.instructions).toContain("browser_start_video");
    expect(seen.REVIEW!.servers).not.toContain("browser");
    const pr = (await forge.listPullRequests({ owner: "acme", name: "web" }, { state: "all" }))[0]!;
    expect(pr.body).toContain("## Evidence");
    expect(pr.body).toMatch(/\[checkout\.png\]\(http.*\/files\/.*checkout\.png\)/);
  });
});

describe("forge credentials for sandboxes", () => {
  it("clones with the forge's repo-scoped token, and keeps it out of the run's output", async () => {
    const harness = new FakeHarness(async (ctx) => {
      ctx.emit({ type: "message", text: "cloned with ghs_scoped_secret_token" });
      return { summary: "done ghs_scoped_secret_token" };
    });
    const { kiln, forge } = createTestKiln({ harness: () => harness });
    const seen: (string | undefined)[] = [];
    const f = forge as unknown as { cloneUrl: (repo: unknown, token?: string) => string; sandboxToken?: (repo: unknown) => Promise<string> };
    const clone = f.cloneUrl.bind(forge);
    f.cloneUrl = (repo, token) => (seen.push(token), clone(repo, token));
    f.sandboxToken = async () => "ghs_scoped_secret_token";
    const run = await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "build", push: false });
    expect(seen).toContain("ghs_scoped_secret_token");
    expect(run.summary).not.toContain("ghs_scoped_secret_token");
    expect(JSON.stringify(kiln.runs.events(run.id))).not.toContain("ghs_scoped_secret_token");
  });
});

describe("multi-repository factories", () => {
  const twoRepos = () => {
    const tree = sampleTree();
    tree["factory.yaml"] = tree["factory.yaml"]!.replace(
      "  - { owner: acme, name: web }\n",
      "  - { owner: acme, name: web, description: Customer web app (Next.js) }\n  - { owner: acme, name: api, description: Invoices and billing API }\n",
    );
    return tree;
  };
  const pickApi: FakeRule = (r) => (r.decision === "repository" ? { repository: { "acme/web": 0.1, "acme/api": 0.9 } } : undefined);

  it("triage picks the repository and every later stage works in it", async () => {
    const decide = new FakeProvider([pickApi, heuristicRule]);
    const forge = new FakeForge();
    forge.createRepo({ owner: "acme", name: "api" }, { "README.md": "# api\n", "package.json": '{ "name": "api" }\n' });
    const { kiln } = createTestKiln({ tree: twoRepos(), forge, decide: { primary: decide }, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix rounding in invoice totals", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    await kiln.workflow.advance(wi.id);
    const done = kiln.workflow.get(wi.id)!;
    expect(done.repo).toBe("acme/api");
    expect(done.pr?.repo).toBe("acme/api");
    const question = decide.calls.find((c) => c.decision === "repository")!;
    expect(question.questions.repository).toEqual({ type: "choice", options: ["acme/web", "acme/api"] });
    expect(JSON.stringify(question.state)).toContain("Invoices and billing API");
    const build = kiln.runs.list({ workItemId: wi.id }).find((r) => r.agent === "implement")!;
    expect(build.startState.repos.map((r) => r.name)).toEqual(["api"]);
  });

  it("keeps the first repository when the choice is unclear, and never asks with one repository", async () => {
    const unsure: FakeRule = (r) => (r.decision === "repository" ? { repository: { "acme/web": 0.5, "acme/api": 0.5 } } : undefined);
    const forge = new FakeForge();
    forge.createRepo({ owner: "acme", name: "api" });
    const { kiln } = createTestKiln({ tree: twoRepos(), forge, decide: { primary: new FakeProvider([unsure, heuristicRule]) }, preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Tidy up", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    await kiln.workflow.advance(wi.id);
    expect(kiln.workflow.get(wi.id)!.repo).toBe("acme/web");

    const single = new FakeProvider([heuristicRule]);
    const one = createTestKiln({ decide: { primary: single }, preview: false }).kiln;
    const item = await one.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a@acme.test" });
    await one.workflow.advance(item.id);
    expect(single.calls.some((c) => c.decision === "repository")).toBe(false);
    expect(one.workflow.get(item.id)!.repo).toBeUndefined();
  });
});

describe("spec stage failures", () => {
  it("does not ask to approve a spec the agent could not write: it retries once, then parks and asks why", async () => {
    const failing = new FakeHarness(async () => {
      throw new Error("setup command failed: pnpm install --frozen-lockfile");
    });
    const agents = fakeAgents();
    let specRuns = 0;
    const { kiln } = createTestKiln({
      harness: (type, agentType) => {
        if (agentType !== "SPEC") return agents(type, agentType);
        specRuns++;
        return failing;
      },
    });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Redesign the billing page", body: "- show invoices\n- show plan", source: { provider: "api" }, requester: "a@acme.test" });
    void kiln.workflow.advance(wi.id);
    const parked = await waitFor(kiln, wi.id, ["blocked"]);
    expect(parked.blockedReason).toContain("setup command failed");
    expect(specRuns).toBe(2);
    const gates = kiln.gates.list({ workItemId: wi.id });
    expect(gates.some((g) => g.kind === "spec")).toBe(false);
    expect(gates.find((g) => g.name === "spec-failed")).toMatchObject({ kind: "question", state: "open" });
    expect(gates.find((g) => g.name === "spec-failed")!.question).toContain("setup command failed");
  });
});
