import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln, fakeAgentScript, isActive, Kiln, sampleTree, TRANSITIONS, transition, waitFor, type WorkItem } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { normalizeGitHub, normalizeLinear, normalizeSlack } from "@kiln/integrations";
import { hashDir, LocalSandboxProvider } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";

describe("M1-T5 atomic apply", () => {
  it("keeps the previous definition when a broken tree is applied", () => {
    const { kiln } = createTestKiln();
    const before = kiln.defs.require("webapp").appliedSha;
    const broken = sampleTree({ "agents/triage/agent.md": "---\nagentType: TRIAGE\nrunner: missing\n---\n" });
    const r = kiln.defs.apply(broken, { author: "alice" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe("agents/triage/agent.md:3: runner missing is not defined in runners/");
    expect(kiln.defs.require("webapp").appliedSha).toBe(before);
    expect(kiln.defs.require("webapp").lastError).toContain("runner missing");
  });

  it("dry-run reports the diff without applying", () => {
    const { kiln } = createTestKiln();
    const before = kiln.defs.require("webapp").appliedSha;
    const r = kiln.defs.apply(sampleTree({ "agents/docs/agent.md": "---\ndescription: docs\n---\nWrite docs.\n" }), { author: "a", dryRun: true });
    expect(r.ok && r.diff.added).toEqual(["agent/docs"]);
    expect(kiln.defs.require("webapp").appliedSha).toBe(before);
  });
});

describe("M2-T4 run records and replay", () => {
  it("replaying a run reproduces its starting workspace byte for byte", async () => {
    const { kiln } = createTestKiln();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a footer link", body: "x", source: { provider: "api" }, requester: "alice" });
    const first = await kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "# Add a footer link", workItem: wi, branch: "kiln/footer" });
    expect(first.status).toBe("succeeded");
    expect(first.definitionSha).toBe(wi.definitionSha);
    expect(first.startState.repos[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    const replay = await kiln.runs.replay(first.id);
    expect(replay).toMatchObject({ kind: "replay", replayOf: first.id });
    expect(replay.startState.workspaceSha).toBe(first.startState.workspaceSha);
    expect(replay.startState.repos[0]!.sha).toBe(first.startState.repos[0]!.sha);
  });
});

describe("M2-T5 scoped tokens", () => {
  it("a run token cannot push to main or approve a PR", () => {
    const { kiln } = createTestKiln();
    const token = kiln.secrets.issueRunToken("run_1", ["acme/web"]);
    expect(kiln.secrets.authorize(token, "push", "acme/web", "kiln/feature").ok).toBe(true);
    expect(kiln.secrets.authorize(token, "push", "acme/web", "main")).toEqual({ ok: false, reason: "run tokens can only push kiln/* branches" });
    expect(kiln.secrets.authorize(token, "approve", "acme/web")).toEqual({ ok: false, reason: "run tokens cannot approve" });
    expect(kiln.secrets.authorize(token, "merge", "acme/web").ok).toBe(false);
    expect(kiln.secrets.authorize(token, "push", "acme/other", "kiln/x").ok).toBe(false);
    expect(kiln.secrets.authorize(`${token}x`, "push", "acme/web", "kiln/x").ok).toBe(false);
  });
});

describe("M2-T7 command guardrail inside a run", () => {
  it("blocks a destructive command and turns a risky one into an inbox question", async () => {
    const commands: Record<string, string> = {};
    const harness = new FakeHarness(async (ctx) => {
      for (const cmd of ["rm -rf /", "git push origin main"]) {
        try {
          await ctx.opts.sandbox.exec(cmd, { cwd: ctx.opts.cwd });
          commands[cmd] = "ran";
        } catch (e) {
          commands[cmd] = (e as Error).message;
        }
      }
      return { summary: "tried" };
    });
    const { kiln } = createTestKiln({ harness: () => harness, askHumanTimeoutMs: 300 });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Guard me", body: "", source: { provider: "api" }, requester: "alice" });
    const pending = kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "go", workItem: wi, push: false });
    let q;
    for (let i = 0; i < 100 && !q; i++) {
      await new Promise((r) => setTimeout(r, 20));
      q = kiln.gates.inbox("alice").find((g) => g.command === "git push origin main");
    }
    expect(q?.kind).toBe("question");
    await pending;
    expect(commands["rm -rf /"]).toBe("blocked by guardrail: rm -rf /");
    expect(commands["git push origin main"]).toBe("a human declined: git push origin main");
    const logs = kiln.store.list<{ id: string; decision: string; action: string }>("decision_logs").filter((d) => d.decision === "command-guard");
    expect(logs.map((l) => l.action)).toEqual(["block", "ask_human"]);
  });
});

describe("M2-T8 pausable sandboxes", () => {
  it("a run paused at a gate resumes on a different node with the same workspace", async () => {
    let resumedWith = "";
    const harness = new FakeHarness(async (ctx) => {
      if (ctx.opts.env?.KILN_RESUMED) {
        resumedWith = (await ctx.opts.sandbox.readFile(`${ctx.opts.cwd ?? ""}/notes.md`)) ?? "";
        return { summary: "resumed" };
      }
      await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/notes.md`, "half done\n");
      await ctx.nextSteer(5000);
      return { summary: "stopped" };
    });
    const nodeA = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-a-")));
    const nodeB = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-b-")));
    const { kiln } = createTestKiln({ harness: () => harness, sandboxes: { local: nodeA } });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Long task", body: "", source: { provider: "api" }, requester: "alice" });
    const running = kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "long", workItem: wi, push: false });
    await new Promise((r) => setTimeout(r, 300));
    const runId = kiln.runs.list({ workItemId: wi.id })[0]!.id;
    const ref = await kiln.runs.pause(runId, "alice");
    expect((await running).status).toBe("paused");
    const resumed = await kiln.runs.resume(runId, "alice", nodeB);
    expect(resumed.status).toBe("succeeded");
    expect(resumedWith).toBe("half done\n");
    const ev = kiln.runs.events(runId).find((e) => e.type === "resumed")!;
    expect((ev.data as { workspaceSha: string }).workspaceSha).toBe(ref.workspaceSha);
  });
});

describe("M3-T1 work item state machine", () => {
  it("has no path to complete without a merge or human confirmation (property test)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const states = Object.keys(TRANSITIONS) as WorkItem["state"][];
    for (let trial = 0; trial < 2000; trial++) {
      let wi = { id: "wi", state: "received", completion: undefined } as unknown as WorkItem;
      for (let step = 0; step < 20; step++) {
        const to = states[Math.floor(rand() * states.length)]!;
        if (rand() < 0.05) wi = { ...wi, completion: rand() < 0.5 ? { by: "merge", ref: "acme/web#1" } : undefined };
        try {
          wi = transition(wi, to, "t");
        } catch {
          /* rejected transition */
        }
        if (wi.state === "complete") expect(wi.completion?.by).toMatch(/^(merge|human)$/);
        if (!isActive(wi.state)) break;
      }
    }
  });

  it("every transition emits work_item.stage_changed", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const seen: string[] = [];
    kiln.bus.subscribe("work_item.stage_changed", (e) => void seen.push(`${e.payload.from}->${e.payload.to}`));
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo in header", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    expect(seen).toEqual(["received->triaging", "triaging->building", "building->reviewing", "reviewing->handed_off"]);
  });
});

describe("M3-T2 foreman workflow", () => {
  it("takes a FakeTracker issue to a draft PR", async () => {
    const { kiln, forge, tracker } = createTestKiln();
    const issue = await tracker.createIssue({ title: "Export invoices as CSV", body: "- Users can download a CSV of invoices\n- The CSV has one row per invoice" });
    const { started } = await kiln.automations.handle(normalizeLinear({ type: "AgentSessionEvent", action: "created", agentSession: { id: "s1", issue: { id: issue.key, title: issue.title, description: issue.body, url: issue.url, teamId: "t1" } } })!);
    const wi = await waitFor(kiln, started[0]!.id, ["awaiting_spec", "blocked"]);
    expect(wi.pr).toBeDefined();
    expect((await forge.getPullRequest({ owner: "acme", name: "web" }, wi.pr!.number))!.draft).toBe(true);
    expect(tracker.comments.some((c) => c.issueId === issue.key && c.body.startsWith("Approve the spec"))).toBe(true);
  });

  it("revisions continue the same conversation and loop review back to build", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix the login redirect [needs-changes]", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    const done = kiln.workflow.get(wi.id)!;
    expect(done.state).toBe("handed_off");
    expect(done.loops.review).toBe(1);
    const implRuns = kiln.runs.list({ workItemId: wi.id, agent: "implement" });
    expect(implRuns).toHaveLength(2);
    expect(implRuns[0]!.startState.prompt).toContain("Review findings to address");
  });
});

describe("M3-T3 automations engine", () => {
  const tree = sampleTree({
    "agents/maintainer/agent.md": "---\ndescription: maintenance\n---\nKeep the repo healthy.\n",
    "automations/merged/automation.md": "---\nagent: maintainer\ntriggers:\n  - provider: github\n    event: push\n    filter: { not_in: { head: [main] } }\n---\nCheck the pushed branch.\n",
    "automations/weekly/automation.md": "---\nagent: maintainer\ntriggers:\n  - provider: schedule\n    event: cron_fired\n    schedule: { cron: \"0 9 * * 1\", name: weekly }\n---\nWeekly audit.\n",
    "automations/jira/automation.md": "---\nagent: maintainer\ntriggers:\n  - provider: jira\n    event: issue_created\n    filter: { labels: [kiln] }\n---\n",
  });

  it("routes each provider's event fixture to the right agent", async () => {
    const { kiln } = createTestKiln({ tree });
    const cases: [ReturnType<typeof normalizeGitHub>, string | undefined][] = [
      [normalizeGitHub("issues", { action: "labeled", label: { name: "kiln-ready" }, repository: { full_name: "acme/web" }, issue: { number: 9, title: "T", labels: [{ name: "kiln-ready" }] } }), "ready-label"],
      [normalizeGitHub("issues", { action: "labeled", label: { name: "other" }, repository: { full_name: "acme/web" }, issue: { number: 10, title: "T", labels: [{ name: "other" }] } }), undefined],
      [normalizeGitHub("push", { ref: "refs/heads/feature", repository: { full_name: "acme/web" } }), "merged"],
      [normalizeGitHub("push", { ref: "refs/heads/main", repository: { full_name: "acme/web" } }), undefined],
      [normalizeSlack({ type: "event_callback", event_id: "E5", event: { type: "app_mention", channel: "C9", ts: "5.5", text: "@webapp help" } }), "slack"],
      [{ provider: "jira", event: "issue_created", data: { issueId: "KIL-1", title: "J", labels: ["kiln"] } }, "jira"],
      [{ provider: "jira", event: "issue_created", data: { issueId: "KIL-2", title: "J", labels: [] } }, undefined],
    ];
    for (const [ev, automation] of cases) {
      const { started } = await kiln.automations.handle(ev!);
      expect(started.map((w) => w.source.automation)[0], `${ev!.provider}/${ev!.event}`).toBe(automation);
    }
  });

  it("fires schedules once per due time", async () => {
    const { FakeClock } = await import("@kiln/engine");
    const clock = new FakeClock(new Date("2026-10-18T12:00:00Z"));
    const { kiln } = createTestKiln({ tree, clock });
    await kiln.automations.tick();
    expect(kiln.workflow.list()).toHaveLength(0);
    clock.advance(2 * 86_400_000); // Monday 12:00 UTC, after 09:00
    await kiln.automations.tick();
    await kiln.automations.tick();
    expect(kiln.workflow.list().filter((w) => w.source.automation === "weekly")).toHaveLength(1);
  });
});

describe("M3-T8 live steering", () => {
  it("a steering message changes the next action of a running agent", async () => {
    process.env.KILN_FAKE_STEER_WAIT_MS = "3000";
    try {
      const { kiln, forge } = createTestKiln();
      const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a banner", body: "", source: { provider: "api" }, requester: "alice" });
      const running = kiln.runs.execute({ factory: "webapp", sha: wi.definitionSha, agent: "implement", prompt: "# Add a banner", workItem: wi, branch: "kiln/banner" });
      let runId: string | undefined;
      for (let i = 0; i < 100 && !runId; i++) {
        await new Promise((r) => setTimeout(r, 20));
        runId = kiln.runs.list({ workItemId: wi.id }).find((r) => kiln.runs.isActive(r.id))?.id;
      }
      await kiln.runs.steer(runId!, "use the brand color", "alice");
      const run = await running;
      expect(run.summary).toContain("next action used the steering note");
      expect((await forge.readTree({ owner: "acme", name: "web" }, "kiln/banner"))["src/kiln/add-a-banner.ts"]).toContain("// steered: use the brand color");
      expect(kiln.workflow.get(wi.id)!.humanTouches).toBe(2);
    } finally {
      delete process.env.KILN_FAKE_STEER_WAIT_MS;
    }
  });
});

describe("budgets", () => {
  it("stops a work item that would exceed its budget", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a", budgetUsd: 0.01 });
    await kiln.workflow.advance(wi.id);
    const after = kiln.workflow.get(wi.id)!;
    expect(after.state).toBe("blocked");
    expect(after.blockedReason).toMatch(/^budget of \$0.01 reached/);
  });
});

describe("Kiln instances share nothing", () => {
  it("creates isolated instances", () => {
    const a = createTestKiln().kiln;
    const b = new Kiln({ forge: createTestKiln().forge });
    expect(b.defs.list()).toHaveLength(0);
    expect(a.defs.list()).toHaveLength(1);
    expect(hashDir("/nonexistent")).toHaveLength(64);
    expect(typeof fakeAgentScript).toBe("function");
  });
});

describe("idempotent advances", () => {
  it("advancing an item that waits at a gate opens no second gate", async () => {
    const { kiln } = createTestKiln();
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "a" });
    await kiln.workflow.advance(wi.id);
    expect(kiln.workflow.get(wi.id)!.state).toBe("awaiting_preview");
    await Promise.all([kiln.workflow.advance(wi.id), kiln.workflow.advance(wi.id)]);
    expect(kiln.gates.list({ workItemId: wi.id }).filter((g) => g.kind === "preview")).toHaveLength(1);
  });
});

describe("bring your own keys", () => {
  it("passes a Claude subscription token from claude setup-token to Claude Code, and only the agent's secrets", async () => {
    const seen: Record<string, string | undefined>[] = [];
    const harness = new FakeHarness(async (ctx) => void seen.push(ctx.opts.env ?? {}));
    const tree = sampleTree({ "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nsecrets: [NPM_TOKEN]\n---\nBuild.\n" });
    const { kiln } = createTestKiln({ harness: () => harness, tree });
    kiln.secrets.setSecret("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-subscription");
    kiln.secrets.setSecret("ANTHROPIC_API_KEY", "sk-ant-api-key");
    kiln.secrets.setSecret("NPM_TOKEN", "npm_x");
    kiln.secrets.setSecret("UNRELATED", "nope");
    const sha = kiln.defs.require("webapp").appliedSha!;
    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(seen[0]).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-subscription", NPM_TOKEN: "npm_x" });
    expect(seen[0]!.ANTHROPIC_API_KEY).toBeUndefined();
    expect(seen[0]!.UNRELATED).toBeUndefined();
  });

  it("uses a per-agent harness secret and fails clearly when it is missing", async () => {
    const tree = sampleTree({ "agents/review/agent.md": "---\nagentType: REVIEW\nharness: { type: codex, auth: { source: secret, secretName: TEAM_OPENAI } }\n---\nReview.\n" });
    const seen: Record<string, string | undefined>[] = [];
    const { kiln } = createTestKiln({ harness: () => new FakeHarness(async (ctx) => void seen.push(ctx.opts.env ?? {})), tree });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const failed = await kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    expect(failed.summary).toBe("secret TEAM_OPENAI for the codex harness is not set");
    kiln.secrets.setSecret("TEAM_OPENAI", "sk-proj-team");
    await kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    expect(seen[0]).toMatchObject({ OPENAI_API_KEY: "sk-proj-team" });
  });
});

describe("secrets from the environment", () => {
  it("exposes provider keys and KILN_SECRET_* but not the server's own variables", () => {
    const { kiln } = createTestKiln();
    process.env.KILN_SECRET_NPM_TOKEN = "npm";
    process.env.GITHUB_TOKEN_TEST_ONLY = "server";
    try {
      expect(kiln.secrets.getSecret("NPM_TOKEN")).toBe("npm");
      expect(kiln.secrets.getSecret("GITHUB_TOKEN_TEST_ONLY")).toBeUndefined();
    } finally {
      delete process.env.KILN_SECRET_NPM_TOKEN;
      delete process.env.GITHUB_TOKEN_TEST_ONLY;
    }
  });
});
