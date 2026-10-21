import { can } from "@kiln/auth";
import { FakeHarness, type StartOptions } from "@kiln/harness";
import { normalizeSlack } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { createTestKiln, sampleTree, waitFor } from "../testing";
import { FakeClock } from "../types";
import { BudgetExceededError, FakeMcpProbe, resolveAccess } from "./index";

const pw = "correct horse battery";

describe("signup, login and invites", () => {
  it("the first signup owns the default team; later ones need an invite", () => {
    const { kiln } = createTestKiln();
    const owner = kiln.accounts.signup({ name: "Olga", email: "Olga@Acme.test", password: pw });
    expect(owner.user.email).toBe("olga@acme.test");
    const team = kiln.teams.ensureDefaultTeam();
    expect(kiln.teams.role(team.id, owner.user.id)).toBe("owner");
    expect(kiln.defs.require("webapp").team).toBe(team.id);
    expect(() => kiln.accounts.signup({ email: "bob@acme.test", password: pw })).toThrow("signing up needs an invite");
    const { token } = kiln.teams.invite(team.id, { email: "bob@acme.test", role: "member" }, owner.user.email);
    expect(() => kiln.accounts.signup({ email: "eve@acme.test", password: pw, invite: token })).toThrow("this invite is for bob@acme.test");
    const bob = kiln.accounts.signup({ email: "bob@acme.test", password: pw, invite: token });
    expect(kiln.teams.role(team.id, bob.user.id)).toBe("member");
    expect(() => kiln.teams.accept(token, bob.user.id)).toThrow("not valid");
    expect(kiln.accounts.login("bob@acme.test", pw).record).toMatchObject({ type: "session", userId: bob.user.id });
    expect(() => kiln.accounts.login("bob@acme.test", "wrong password")).toThrow("wrong email or password");
  });

  it("open signup joins the default team as a member", () => {
    const { kiln } = createTestKiln();
    kiln.accounts.signup({ email: "first@acme.test", password: pw });
    const u = kiln.accounts.signup({ email: "walkin@acme.test", password: pw }, { openSignup: true });
    expect(kiln.teams.teamsOf(u.user.id).map((t) => t.role)).toEqual(["member"]);
  });

  it("invites expire after 7 days; resend gives a new link and revoke kills it", () => {
    const clock = new FakeClock();
    const { kiln } = createTestKiln({ clock });
    const owner = kiln.accounts.signup({ email: "o@acme.test", password: pw });
    const team = kiln.teams.ensureDefaultTeam();
    const first = kiln.teams.invite(team.id, { email: "x@acme.test", role: "admin" }, "o@acme.test");
    expect(first.link).toContain("/join?invite=kinv_");
    clock.advance(8 * 86_400_000);
    expect(() => kiln.teams.findInvite(first.token)).toThrow("expired");
    const again = kiln.teams.resend(team.id, first.invite.id, "o@acme.test");
    expect(() => kiln.teams.findInvite(first.token)).toThrow("not valid");
    expect(kiln.teams.previewInvite(again.token)).toMatchObject({ email: "x@acme.test", role: "admin", team: { slug: "default" } });
    kiln.teams.revoke(team.id, again.invite.id, "o@acme.test");
    expect(() => kiln.teams.findInvite(again.token)).toThrow("not valid");
    expect(kiln.auditLog().map((a) => a.action)).toEqual(expect.arrayContaining(["team.invite_created", "team.invite_resent", "team.invite_revoked"]));
    expect(owner.user.id).toBeTruthy();
  });

  it("GitHub login links the account, signs up the first user and reuses the account later", () => {
    const { kiln } = createTestKiln();
    const first = kiln.accounts.githubLogin({ id: "42", login: "octo", email: "octo@acme.test", name: "Octo" }, {});
    expect(first.created).toBe(true);
    expect(first.user.linkedAccounts[0]).toMatchObject({ provider: "github", externalId: "42", handle: "octo" });
    const again = kiln.accounts.githubLogin({ id: "42", login: "octo" }, {});
    expect(again).toMatchObject({ created: false, user: { id: first.user.id } });
    expect(() => kiln.accounts.githubLogin({ id: "7", login: "stranger", email: "s@x.test" }, {})).toThrow("needs an invite");
  });
});

describe("teams and factory roles", () => {
  function team3() {
    const t = createTestKiln();
    const { kiln } = t;
    const owner = kiln.accounts.signup({ email: "owner@acme.test", password: pw }).user;
    const team = kiln.teams.ensureDefaultTeam();
    const join = (email: string, role: "admin" | "member") => {
      const { token } = kiln.teams.invite(team.id, { email, role }, owner.email);
      return kiln.accounts.signup({ email, password: pw, invite: token }).user;
    };
    return { ...t, owner, team, admin: join("admin@acme.test", "admin"), member: join("member@acme.test", "member") };
  }

  it("owners and admins are Admin on every factory; members get the default role", () => {
    const { kiln, owner, admin, member, team } = team3();
    expect(kiln.teams.factoryRole(owner.id, "webapp")).toBe("admin");
    expect(kiln.teams.factoryRole(admin.id, "webapp")).toBe("admin");
    expect(kiln.teams.factoryRole(member.id, "webapp")).toBe("user");
    const memberToken = resolveAccess(kiln, { id: "t", name: "s", subject: member.email, hash: "", grants: [], createdAt: "", type: "session", userId: member.id }).token;
    expect(can(memberToken, "send", "webapp")).toBe(true);
    expect(can(memberToken, "definitions:write", "webapp")).toBe(false);
    kiln.teams.setFactoryMember("webapp", member.id, "editor", owner.email);
    expect(kiln.teams.factoryRole(member.id, "webapp")).toBe("editor");
    kiln.teams.removeFactoryMember("webapp", member.id, owner.email);
    kiln.teams.updateSettings(team.id, { defaultFactoryRole: "none" }, owner.email);
    expect(kiln.teams.factoryRole(member.id, "webapp")).toBeUndefined();
  });

  it("protects ownership and the last owner", () => {
    const { kiln, owner, admin, member, team } = team3();
    expect(() => kiln.teams.setRole(team.id, member.id, "owner", { userId: admin.id, label: admin.email })).toThrow("only owners");
    expect(() => kiln.teams.setRole(team.id, owner.id, "member", { userId: owner.id, label: owner.email })).toThrow("at least one owner");
    expect(() => kiln.teams.removeMember(team.id, owner.id, { userId: owner.id, label: owner.email })).toThrow("at least one owner");
    kiln.teams.setRole(team.id, member.id, "admin", { userId: admin.id, label: admin.email });
    kiln.teams.removeMember(team.id, member.id, { userId: owner.id, label: owner.email });
    expect(kiln.teams.role(team.id, member.id)).toBeUndefined();
  });

  it("a second team keeps its factories to itself", () => {
    const { kiln, owner, member } = team3();
    const other = kiln.teams.create({ name: "Payments" }, member.id);
    kiln.defs.apply(sampleTree({}, "Pay", "pay", "acme/web"), { author: "test" });
    kiln.teams.assignFactory("pay", other.id, member.email);
    expect(kiln.teams.factoryRole(member.id, "pay")).toBe("admin");
    expect(kiln.teams.factoryRole(owner.id, "pay")).toBeUndefined();
    expect(() => resolveAccess(kiln, { id: "t", name: "s", subject: owner.email, hash: "", grants: [], createdAt: "", type: "session", userId: owner.id }, other.slug)).toThrow("not a member");
  });
});

describe("secrets", () => {
  it("values are write-only, typed and limited to 128 KiB", () => {
    const { kiln } = createTestKiln();
    const team = kiln.teams.ensureDefaultTeam();
    const meta = kiln.vault.set({ scope: "team", owner: team.id, name: "NPM_TOKEN", value: "npm_secret_value", description: "npm" }, "a@x.test");
    expect(meta).not.toHaveProperty("value");
    expect(JSON.stringify(kiln.vault.list({ teamId: team.id }))).not.toContain("npm_secret_value");
    expect(() => kiln.vault.set({ scope: "team", owner: team.id, name: "REG", type: "docker_registry", value: { host: "ghcr.io" } }, "a")).toThrow("invalid docker_registry value");
    expect(() => kiln.vault.set({ scope: "personal", owner: "usr_1", name: "ECR", type: "aws_ecr", value: { roleArn: "arn:aws:iam::123456789012:role/x", region: "eu-west-1" } }, "a")).toThrow("team secrets");
    expect(() => kiln.vault.set({ scope: "team", owner: team.id, name: "BIG", value: "x".repeat(129 * 1024) }, "a")).toThrow("128 KiB");
    expect(() => kiln.vault.set({ scope: "team", owner: team.id, name: "bad-name", value: "x" }, "a")).toThrow();
  });

  it("seals values when a secret key is configured", () => {
    const { kiln } = createTestKiln({ secretKey: "k".repeat(32) });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "TOKEN", value: "plain-text-value" }, "a");
    expect(JSON.stringify(kiln.store.list("managed_secrets"))).not.toContain("plain-text-value");
    expect(kiln.vault.resolver({ teamId: team.id }).get("TOKEN")).toBe("plain-text-value");
  });

  it("personal secrets reach only the runs their owner triggers; typed harness keys map to provider variables; output is redacted", async () => {
    const seen: StartOptions[] = [];
    const harness = new FakeHarness(async (ctx) => {
      seen.push(ctx.opts);
      ctx.emit({ type: "message", text: `my token is ${ctx.opts.env?.NPM_TOKEN}` });
      return { summary: `done with ${ctx.opts.env?.CLAUDE_CODE_OAUTH_TOKEN}` };
    });
    const tree = sampleTree({ "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nsecrets: [NPM_TOKEN]\n---\nBuild.\n" });
    const { kiln } = createTestKiln({ harness: () => harness, tree });
    const alice = kiln.accounts.signup({ email: "alice@acme.test", password: pw }).user;
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "NPM_TOKEN", value: "npm_team_token" }, "a");
    kiln.vault.set({ scope: "personal", owner: alice.id, name: "NPM_TOKEN", value: "npm_alice_token" }, "a");
    kiln.vault.set({ scope: "team", owner: team.id, name: "CLAUDE", type: "claude_oauth_token", value: "sk-ant-oat01-team" }, "a");
    const sha = kiln.defs.require("webapp").appliedSha!;
    const mine = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false, triggeredBy: alice.id });
    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(seen[0]!.env).toMatchObject({ NPM_TOKEN: "npm_alice_token", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-team" });
    expect(seen[1]!.env).toMatchObject({ NPM_TOKEN: "npm_team_token" });
    expect(mine).toMatchObject({ userId: alice.id, team: team.id, summary: "done with [redacted]" });
    expect(kiln.runs.events(mine.id).find((e) => e.type === "message")!.text).toBe("my token is [redacted]");
  });

  it("Bedrock access keys switch Claude Code to Bedrock", () => {
    const { kiln } = createTestKiln();
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.setModelKey(team.id, "bedrock", { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secretsecret", region: "eu-north-1" }, "a");
    expect(kiln.vault.modelKeys(team.id).bedrock.set).toBe(true);
    const env = kiln.runs.credentials("claude-code", { secrets: [], harness: { type: "claude-code" } }, { teamId: team.id });
    expect(env).toMatchObject({ AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_REGION: "eu-north-1", CLAUDE_CODE_USE_BEDROCK: "1" });
  });
});

describe("MCP servers and environments", () => {
  it("resolves custom and built-in servers into the harness config", async () => {
    const seen: StartOptions[] = [];
    const tree = sampleTree({ "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nmcpServers: [figma, sentry, linear, github, nope]\n---\nBuild.\n" });
    const { kiln } = createTestKiln({ harness: () => new FakeHarness(async (ctx) => void seen.push(ctx.opts)), tree });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "FIGMA_TOKEN", value: "figma-secret" }, "a");
    kiln.vault.set({ scope: "team", owner: team.id, name: "SENTRY_TOKEN", value: "sentry-secret" }, "a");
    kiln.vault.set({ scope: "team", owner: team.id, name: "LINEAR_API_KEY", value: "lin_api_x" }, "a");
    kiln.mcp.create(team.id, { name: "figma", url: "https://mcp.figma.test/mcp", headers: { Authorization: "Bearer {{FIGMA_TOKEN}}" } }, "a");
    kiln.mcp.create(team.id, { name: "sentry", command: "npx", args: ["sentry-mcp"], env: { SENTRY_TOKEN: "{{SENTRY_TOKEN}}" }, mode: "direct" }, "a");
    expect(() => kiln.mcp.create(team.id, { name: "both", command: "x", url: "https://x" }, "a")).toThrow("either command");
    expect(kiln.mcp.builtins(team.id).find((b) => b.kiln_id === "linear")).toMatchObject({ connected: true });
    expect(kiln.mcp.builtins(team.id).find((b) => b.kiln_id === "github")).toMatchObject({ connected: false, missing: ["GITHUB_MCP_TOKEN"] });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const run = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(seen[0]!.mcpServers!.filter((s) => s.name !== "browser")).toEqual([
      { name: "figma", url: "https://mcp.figma.test/mcp", headers: { Authorization: "Bearer figma-secret" } },
      { name: "sentry", command: "npx", args: ["sentry-mcp"], env: { SENTRY_TOKEN: "${SENTRY_TOKEN}" } },
      { name: "linear", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer lin_api_x" } },
    ]);
    expect(seen[0]!.env).toMatchObject({ SENTRY_TOKEN: "sentry-secret" });
    expect(kiln.runs.events(run.id).filter((e) => e.type === "mcp_skipped").map((e) => e.text)).toEqual(["github: missing secret GITHUB_MCP_TOKEN", "nope: unknown MCP server"]);
  });

  it("tests MCP servers for the team, a factory or one agent with the same check (#44)", async () => {
    const probe = new FakeMcpProbe({ "https://obs.acme.test/mcp": { ok: true, tools: ["search_logs", "get_trace"], server: "obs" } });
    const tree = sampleTree({
      "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nmcpServers: [obs, sentry, github]\n---\nBuild.\n",
      "agents/review/agent.md": "---\nagentType: REVIEW\nmcpServers: [obs]\n---\nReview.\n",
    });
    const { kiln } = createTestKiln({ tree, mcpProbe: probe });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "OBS_KEY", value: "obs-key" }, "a");
    kiln.vault.set({ scope: "team", owner: team.id, name: "SENTRY_TOKEN", value: "sentry-secret" }, "a");
    kiln.mcp.create(team.id, { name: "obs", url: "https://obs.acme.test/mcp", headers: { "x-key": "{{OBS_KEY}}" } }, "a");
    kiln.mcp.create(team.id, { name: "sentry", command: "npx", args: ["sentry-mcp"], env: { SENTRY_TOKEN: "{{SENTRY_TOKEN}}" } }, "a");

    const ok = { name: "obs", status: "ok", tools: ["search_logs", "get_trace"], message: "Connected to obs: 2 tools." };
    const untested = { name: "sentry", status: "untested" };
    expect(await kiln.mcp.testServers(team.id)).toMatchObject([ok, untested]);
    expect(probe.calls[0]).toEqual({ url: "https://obs.acme.test/mcp", headers: { "x-key": "obs-key" } });

    expect(await kiln.mcp.testServers(undefined, { factory: "webapp" })).toMatchObject([
      { ...ok, agents: ["implement", "review"] },
      { ...untested, agents: ["implement"] },
      { name: "github", status: "error", message: "Missing secret GITHUB_MCP_TOKEN", agents: ["implement"] },
    ]);
    expect(await kiln.mcp.testServers(undefined, { factory: "webapp", agent: "review" })).toMatchObject([{ ...ok, agents: ["review"] }]);
    expect(await kiln.mcp.testServers(team.id, { servers: ["nope"] })).toMatchObject([{ name: "nope", status: "error", message: "unknown MCP server" }]);
    await expect(kiln.mcp.testServers(undefined, { factory: "webapp", agent: "ghost" })).rejects.toThrow("has no agent ghost");
  });

  it("a team server given to all agents reaches every run, even ones that list nothing (#62)", async () => {
    const seen: StartOptions[] = [];
    const tree = sampleTree({
      "agents/implement/agent.md": "---\nagentType: IMPLEMENT\n---\nBuild.\n",
      "agents/review/agent.md": "---\nagentType: REVIEW\nmcpServers: [obs]\n---\nReview.\n",
    });
    const probe = new FakeMcpProbe({ "https://obs.acme.test/mcp": { ok: true, tools: ["search_logs"] } });
    const { kiln } = createTestKiln({ harness: () => new FakeHarness(async (ctx) => void seen.push(ctx.opts)), tree, mcpProbe: probe });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "OBS_KEY", value: "obs-key" }, "a");
    const obs = kiln.mcp.create(team.id, { name: "obs", url: "https://obs.acme.test/mcp", headers: { "x-key": "{{OBS_KEY}}" } }, "a");
    const sha = kiln.defs.require("webapp").appliedSha!;
    const servers = () => seen.at(-1)!.mcpServers!.filter((s) => s.name === "obs");

    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(servers()).toEqual([]);

    expect(kiln.mcp.update(team.id, obs.id, { allAgents: true }, "a").allAgents).toBe(true);
    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(servers()).toEqual([{ name: "obs", url: "https://obs.acme.test/mcp", headers: { "x-key": "obs-key" } }]);
    // Listed and shared: still one entry.
    await kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    expect(servers()).toHaveLength(1);
    // An automation override replaces the listed servers, not the shared ones.
    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false, overrides: { mcpServers: [] } });
    expect(servers()).toHaveLength(1);

    expect(await kiln.mcp.testServers(undefined, { factory: "webapp" })).toMatchObject([{ name: "obs", status: "ok", agents: expect.arrayContaining(["foreman", "implement", "review", "triage"]) }]);
  });

  it("an environment template adds setup commands after the runner's and its secrets", async () => {
    const seen: StartOptions[] = [];
    const harness = new FakeHarness(async (ctx) => {
      seen.push(ctx.opts);
      return { summary: (await ctx.opts.sandbox.readFile(`${ctx.opts.cwd}/.env-ready`)) ?? "missing" };
    });
    const tree = sampleTree({
      "factory.yaml": sampleTree()["factory.yaml"]!.replace("agentDefaults:\n", "agentDefaults:\n  environmentId: node-env\n"),
    });
    const { kiln } = createTestKiln({ harness: () => harness, tree });
    const team = kiln.teams.ensureDefaultTeam();
    const sha = kiln.defs.require("webapp").appliedSha!;
    await expect(kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false })).rejects.toThrow("environment node-env is not defined for this team");
    kiln.vault.set({ scope: "team", owner: team.id, name: "ENV_TOKEN", value: "env-token-value" }, "a");
    const env = kiln.environments.create(team.id, { name: "node-env", image: "node:24", setupCommands: ["cd web && echo ready > .env-ready"], secrets: ["ENV_TOKEN"] }, "a");
    const run = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(run).toMatchObject({ environmentId: env.id, status: "succeeded" });
    expect(run.summary?.trim()).toBe("ready");
    expect(seen.at(-1)!.env).toMatchObject({ ENV_TOKEN: "env-token-value" });
  });
});

describe("usage and spend limits", () => {
  it("breaks usage down and stops new runs when auto-stop is on", async () => {
    const { kiln } = createTestKiln({ harness: () => new FakeHarness(async () => ({ summary: "ok", costUsd: 3 })) });
    const alice = kiln.accounts.signup({ email: "alice@acme.test", password: pw }).user;
    const team = kiln.teams.ensureDefaultTeam();
    const sha = kiln.defs.require("webapp").appliedSha!;
    await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false, triggeredBy: alice.id });
    await kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    const u = kiln.usage.summary(team.id);
    expect(u).toMatchObject({ totalUsd: 6, runs: 2, limit: { monthlyUsd: 200, autoStop: false, exceeded: false } });
    expect(u.byUser).toEqual([
      { key: "alice@acme.test", costUsd: 3, runs: 1 },
      { key: "team", costUsd: 3, runs: 1 },
    ]);
    expect(u.byAgent.map((r) => r.key).sort()).toEqual(["webapp/implement", "webapp/review"]);
    expect(u.byModel[0]).toMatchObject({ key: "claude-sonnet-5-5", costUsd: 6 });
    kiln.teams.updateSettings(team.id, { spendLimit: { monthlyUsd: 5, autoStop: false } }, "a");
    await kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    kiln.teams.updateSettings(team.id, { spendLimit: { monthlyUsd: 5, autoStop: true } }, "a");
    await expect(kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false })).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false })).rejects.toThrow("Monthly spending budget of $5 has been reached");
  });
});

describe("identity mapping", () => {
  it("a linked Slack account decides gates as its user", async () => {
    const { kiln } = createTestKiln();
    const po = kiln.accounts.signup({ email: "po@acme.test", password: pw }).user;
    kiln.users.link(po.id, "slack", "U_PO");
    expect(() => kiln.users.link(kiln.accounts.signup({ email: "x@acme.test", password: pw }, { openSignup: true }).user.id, "slack", "U_PO")).toThrow("linked to another user");
    const slack = (id: string, ts: string, text: string, user: string, thread?: string) => normalizeSlack({ type: "event_callback", event_id: id, event: { type: thread ? "message" : "app_mention", channel: "C", ts, thread_ts: thread, user, text } })!;
    const { started } = await kiln.automations.handle(slack("A", "1.0", "@webapp add exports\n- CSV export\n- PDF export", "U_PO"));
    expect(started[0]!.requester).toBe("po@acme.test");
    await waitFor(kiln, started[0]!.id, ["awaiting_spec"]);
    await kiln.automations.handle(slack("C", "1.2", "approve", "U_PO", "1.0"));
    expect(kiln.gates.list({ workItemId: started[0]!.id }).find((g) => g.kind === "spec")).toMatchObject({ state: "approved", decidedBy: "po@acme.test" });
    kiln.users.unlink(po.id, "slack");
    expect(kiln.users.resolveIdentity("slack", "U_PO")).toBe("U_PO");
  });
});
