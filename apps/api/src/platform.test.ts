import { FakeGitHubOAuth, issueToken } from "@kiln/auth";
import { createTestKiln, sampleTree } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { createMcpHandler } from "@kiln/mcp";
import { KilnClient } from "@kiln/sdk-ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "./app";

const pw = "correct horse battery";

function setup(opts: AppOptions & { harnessCost?: number; serverAdmins?: string[]; ownerEmail?: string } = {}) {
  const t = createTestKiln({ preview: false, webUrl: "http://web.test", publicUrl: "http://kiln.test", serverAdmins: opts.serverAdmins, ownerEmail: opts.ownerEmail, ...(opts.harnessCost !== undefined ? { harness: () => new FakeHarness(async () => ({ summary: "ok", costUsd: opts.harnessCost })) } : {}) });
  let app: ReturnType<typeof createApp>;
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  app = createApp(t.kiln, { mcp: createMcpHandler("http://kiln.test", inProcess), ...opts });
  const client = (token?: string, team?: string) => new KilnClient({ baseUrl: "http://kiln.test", token, team, fetch: inProcess as typeof fetch });
  return { ...t, app, client, inProcess };
}

/** An owner, an admin and a member in the default team, each with a session client. */
async function people(s: ReturnType<typeof setup>) {
  const anon = s.client();
  const owner = await anon.signup({ name: "Olga", email: "olga@acme.test", password: pw });
  const o = s.client(owner.token);
  const join = async (email: string, role: "admin" | "member") => {
    const inv = await o.inviteMember("default", email, role);
    const session = await anon.signup({ email, password: pw, invite: inv.token });
    return { session, c: s.client(session.token) };
  };
  return { owner, o, admin: await join("ada@acme.test", "admin"), member: await join("max@acme.test", "member") };
}

describe("auth API", () => {
  it("lets only KILN_OWNER_EMAIL claim a fresh server", async () => {
    const s = setup({ ownerEmail: "Olga@Acme.test" });
    const anon = s.client();
    await expect(anon.signup({ email: "mallory@evil.test", password: pw })).rejects.toMatchObject({ status: 403, message: "this server is waiting for its owner to sign up" });
    expect((await anon.authProviders()).needsOwner).toBe(true);
    const first = await anon.signup({ email: "olga@acme.test", password: pw });
    expect(first.teams).toEqual([expect.objectContaining({ role: "owner" })]);
  });

  it("signs up the first owner, then logs in and out", async () => {
    const s = setup();
    const anon = s.client();
    expect(await anon.authProviders()).toEqual({ password: true, github: false, openSignup: false, needsOwner: true });
    const first = await anon.signup({ name: "Olga", email: "olga@acme.test", password: pw });
    expect(first.teams).toEqual([expect.objectContaining({ slug: "default", role: "owner" })]);
    expect(first.user).not.toHaveProperty("passwordHash");
    await expect(anon.signup({ email: "late@acme.test", password: pw })).rejects.toMatchObject({ status: 403, message: "signing up needs an invite" });
    await expect(anon.login("olga@acme.test", "nope-nope")).rejects.toMatchObject({ status: 401 });
    const session = await anon.login("olga@acme.test", pw);
    const me = await s.client(session.token).me();
    expect(me).toMatchObject({ tokenType: "session", subject: "olga@acme.test", role: "owner", currentTeam: { slug: "default" }, factoryRoles: { webapp: "admin" } });
    await s.client(session.token).logout();
    await expect(s.client(session.token).me()).rejects.toMatchObject({ status: 401 });
  });

  it("open signup lets anyone join as a member", async () => {
    const s = setup({ openSignup: true });
    await s.client().signup({ email: "first@acme.test", password: pw });
    const walkin = await s.client().signup({ email: "walkin@acme.test", password: pw });
    expect(walkin.teams[0]).toMatchObject({ role: "member" });
  });

  it("GitHub login: start, callback with a fake provider, redirect back to the web app only", async () => {
    const github = new FakeGitHubOAuth();
    github.codes.set("code-1", { id: "99", login: "octo", email: "octo@acme.test", name: "Octo" });
    const s = setup({ github });
    const anon = s.client();
    const { url, state } = await anon.githubLoginUrl();
    expect(url).toContain(encodeURIComponent("http://kiln.test/api/v1/auth/github/callback"));
    const session = await anon.githubCallback("code-1", state);
    expect(session).toMatchObject({ created: true, user: { email: "octo@acme.test" }, teams: [{ role: "owner" }] });
    await expect(anon.githubCallback("code-1", state)).rejects.toMatchObject({ status: 400 });
    await expect(anon.githubLoginUrl({ redirect: "https://evil.test/steal" })).rejects.toMatchObject({ status: 400 });
    const again = await anon.githubLoginUrl({ redirect: "http://web.test/auth/done" });
    const res = await s.app.request(`/api/v1/auth/github/callback?code=code-1&state=${again.state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^http:\/\/web\.test\/auth\/done#token=kiln_tok_/);
  });

  it("dev auth acts as the seeded owner dev@kiln.local", async () => {
    const s = setup({ devAuth: true });
    const me = await s.client().me();
    expect(me).toMatchObject({ subject: "dev@kiln.local", role: "owner", user: { email: "dev@kiln.local" } });
    expect(me.grants).toContainEqual({ scope: "admin", factory: "*" });
    expect((await s.client().factories()).map((f) => f.id)).toEqual(["webapp"]);
  });
});

describe("teams API", () => {
  it("invites, roles, removal and team switching", async () => {
    const s = setup();
    const { o, admin, member } = await people(s);
    const members = await o.teamMembers("default");
    expect(members.map((m) => [m.user?.email, m.role])).toEqual([
      ["olga@acme.test", "owner"],
      ["ada@acme.test", "admin"],
      ["max@acme.test", "member"],
    ]);
    await expect(member.c.inviteMember("default", "x@acme.test")).rejects.toMatchObject({ status: 403 });
    await expect(admin.c.inviteMember("default", "boss@acme.test", "owner")).rejects.toMatchObject({ status: 403 });
    const inv = await admin.c.inviteMember("default", "later@acme.test");
    expect(inv.link).toBe(`http://web.test/join?invite=${encodeURIComponent(inv.token)}`);
    expect(await s.client().invite(inv.token)).toMatchObject({ email: "later@acme.test", team: { slug: "default" } });
    const resent = await admin.c.resendInvite("default", inv.invite.id);
    await expect(s.client().invite(inv.token)).rejects.toMatchObject({ status: 404 });
    await admin.c.revokeInvite("default", resent.invite.id);
    expect(await admin.c.invites("default")).toEqual([]);

    await expect(admin.c.setTeamRole("default", member.session.user.id, "owner")).rejects.toMatchObject({ status: 403 });
    await admin.c.setTeamRole("default", member.session.user.id, "admin");
    await o.removeTeamMember("default", member.session.user.id);
    await expect(member.c.team("default")).rejects.toMatchObject({ status: 404 });

    const pay = await admin.c.createTeam({ name: "Payments" });
    expect(pay).toMatchObject({ slug: "payments", role: "owner" });
    expect((await admin.c.teams()).map((t) => t.slug)).toEqual(["default", "payments"]);
    const inPay = admin.c.withTeam("payments");
    expect((await inPay.me()).currentTeam).toMatchObject({ slug: "payments" });
    expect(await inPay.factories()).toEqual([]);
    await expect(o.withTeam("payments").me()).rejects.toMatchObject({ status: 403 });
  });

  it("a factory applied in a team belongs to it", async () => {
    const s = setup();
    const { admin } = await people(s);
    await admin.c.createTeam({ name: "Payments" });
    const inPay = admin.c.withTeam("payments");
    const r = await inPay.apply(sampleTree({}, "Pay", "pay", "acme/web"));
    expect(r.ok).toBe(true);
    expect(s.kiln.defs.require("pay").team).toBe(s.kiln.teams.get("payments")!.id);
    expect((await inPay.factories()).map((f) => f.id)).toEqual(["pay"]);
    expect((await admin.c.factories()).map((f) => f.id)).toEqual(["webapp"]);
  });

  it("team settings, avatars and model keys", async () => {
    const s = setup();
    const { o, member } = await people(s);
    expect(await member.c.teamSettings("default")).toMatchObject({ spendLimit: { monthlyUsd: 200, autoStop: false }, defaultFactoryRole: "user" });
    await expect(member.c.updateTeamSettings("default", { githubOrgs: ["acme"] })).rejects.toMatchObject({ status: 403 });
    const next = await o.updateTeamSettings("default", {
      githubOrgs: ["acme"],
      egressAllowlist: ["registry.npmjs.org"],
      defaultSandboxHost: "local",
      storage: { artifacts: { kind: "s3", bucket: "kiln-artifacts", region: "eu-west-1" }, transcripts: { kind: "local" }, attachments: { kind: "local", path: "att" } },
    });
    expect(next.storage.artifacts).toMatchObject({ kind: "s3", bucket: "kiln-artifacts" });
    await expect(o.updateTeamSettings("default", { storage: { artifacts: { kind: "gcs" } } } as never)).rejects.toMatchObject({ status: 400 });
    await expect(o.updateTeamSettings("default", { storage: { ...next.storage, attachments: { kind: "local", path: "/etc" } } })).rejects.toMatchObject({ status: 400 });
    expect(await o.testStorage("default", "transcripts")).toEqual({ ok: true });
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const team = await o.uploadTeamAvatar("default", png, "image/png");
    expect(team.avatar).toMatch(/^\/api\/v1\/teams\/team_.+\/avatar/);
    const res = await s.app.request(team.avatar!, { headers: { authorization: `Bearer ${(o as unknown as { options: { token: string } }).options.token}` } });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(res.headers.get("content-type")).toBe("image/png");
    await expect(o.uploadTeamAvatar("default", png, "text/html")).rejects.toMatchObject({ status: 400 });
    await o.setModelKey("default", "anthropic", "sk-ant-api03-team");
    expect((await member.c.modelKeys("default")).anthropic).toMatchObject({ set: true });
    expect(JSON.stringify(await member.c.modelKeys("default"))).not.toContain("sk-ant");
    await expect(member.c.setModelKey("default", "openai", "sk-x")).rejects.toMatchObject({ status: 403 });
    for (const name of ["CLAUDE_A", "CLAUDE_B"]) await o.createManagedSecret({ scope: "team", name, type: "claude_oauth_token", value: `sk-ant-oat-${name}` });
    const pool = await member.c.claudeTokens("default");
    expect(pool.map((t) => [t.name, t.status])).toEqual([
      ["CLAUDE_A", "unknown"],
      ["CLAUDE_B", "unknown"],
    ]);
    expect(JSON.stringify(pool)).not.toContain("sk-ant-oat");
    await expect(member.c.checkClaudeToken("default", "CLAUDE_A")).rejects.toMatchObject({ status: 403 });
    expect(await o.checkClaudeToken("default", "CLAUDE_A")).toMatchObject({ name: "CLAUDE_A", checkedAt: expect.any(String) });
  });
});

describe("factory roles API", () => {
  it("maps User, Editor and Admin onto scopes and lets admins manage members", async () => {
    const s = setup();
    const { o, member } = await people(s);
    const uid = member.session.user.id;
    await expect(member.c.apply(sampleTree(), { factory: "webapp" })).rejects.toMatchObject({ status: 403 });
    const wi = await member.c.send({ factory: "webapp", title: "Fix typo" });
    expect(wi.requester).toBe("max@acme.test");
    await expect(member.c.addFactoryMember("webapp", { userId: uid, role: "editor" })).rejects.toMatchObject({ status: 403 });
    await o.addFactoryMember("webapp", { email: "max@acme.test", role: "editor" });
    expect((await member.c.me()).factoryRoles).toEqual({ webapp: "editor" });
    expect((await member.c.apply(sampleTree(), { factory: "webapp", dryRun: true })).ok).toBe(true);
    const rows = await o.factoryMembers("webapp");
    expect(rows.find((r) => r.userId === uid)).toMatchObject({ role: "editor", source: "factory" });
    expect(rows.find((r) => r.user?.email === "ada@acme.test")).toMatchObject({ role: "admin", source: "team" });
    await o.setFactoryRole("webapp", uid, "admin");
    expect((await member.c.me()).factoryRoles.webapp).toBe("admin");
    await o.removeFactoryMember("webapp", uid);
    await o.updateTeamSettings("default", { defaultFactoryRole: "none" });
    expect(await member.c.factories()).toEqual([]);
    await expect(member.c.send({ factory: "webapp", title: "x" })).rejects.toMatchObject({ status: 403 });
  });

  it("only factory Admins force a definition change that waits for a second approval", async () => {
    const s = setup();
    const { o, member } = await people(s);
    await o.addFactoryMember("webapp", { email: "max@acme.test", role: "editor" });
    const sha = s.kiln.defs.require("webapp").appliedSha!;
    s.kiln.store.put("proposals", { id: "prop_1", factory: "webapp", agent: "implement", category: "instructions", target: "definition", failures: [], changes: {}, rationale: "", replay: [], passRateBefore: 0, passRateAfter: 1, body: "", candidateSha: sha, needsTwoApprovals: true, droppedProtectedPaths: [], state: "open", createdAt: new Date().toISOString() });
    await expect(member.c.approveProposal("prop_1", { force: true })).rejects.toMatchObject({ status: 403 });
    expect((await o.approveProposal("prop_1", { force: true })).state).toBe("merged");
    expect((await o.audit()).map((a) => a.action)).toContain("proposal.force_approved");
  });

  it("enabled GitHub orgs limit which repos a team's factories use", async () => {
    const s = setup();
    const { o } = await people(s);
    await o.updateTeamSettings("default", { githubOrgs: ["other-org"] });
    await expect(o.apply(sampleTree({}, "Web 2", "web2", "acme/web"))).rejects.toMatchObject({ status: 403, message: "GitHub org acme is not enabled for team default" });
    await o.updateTeamSettings("default", { githubOrgs: ["other-org", "ACME"] });
    expect((await o.apply(sampleTree({}, "Web 2", "web2", "acme/web"))).ok).toBe(true);
  });

  it("scoped tokens keep their explicit grants", async () => {
    const s = setup();
    const { token } = issueToken(s.kiln.store, { name: "ci", subject: "ci@acme.test", grants: [{ scope: "read", factory: "webapp" }] });
    expect((await s.client(token).factories()).map((f) => f.id)).toEqual(["webapp"]);
    await expect(s.client(token).send({ factory: "webapp", title: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("user settings API", () => {
  it("profile, appearance, notifications, avatar, password and linked accounts", async () => {
    const s = setup();
    const { o, member } = await people(s);
    const me = await member.c.updateMe({ name: "Max M", appearance: "dark", notifications: { spec: { email: false, slack: true, discord: true } } });
    expect(me).toMatchObject({ name: "Max M", appearance: "dark", notifications: { spec: { email: false, slack: true, discord: true }, preview: { email: true } } });
    await expect(member.c.updateMe({ email: "olga@acme.test" })).rejects.toMatchObject({ status: 409 });
    expect((await member.c.updateMe({ digest: { daily: true, hourUtc: 7 } })).digest).toEqual({ daily: true, hourUtc: 7, channels: ["email"], only: false });
    await expect(member.c.updateMe({ digest: { hourUtc: 25 } })).rejects.toMatchObject({ status: 400 });
    expect(await member.c.notifications()).toEqual([]);
    const withAvatar = await member.c.uploadAvatar(new Uint8Array([1, 2, 3]), "image/webp");
    expect(withAvatar.avatar).toMatch(/^\/api\/v1\/users\/usr_.+\/avatar/);
    await expect(member.c.uploadAvatar(new Uint8Array(1024 * 1024 + 1), "image/png")).rejects.toMatchObject({ status: 413 });
    await expect(member.c.changePassword("new password!", "wrong")).rejects.toMatchObject({ status: 403 });
    await member.c.changePassword("new password!", pw);
    await s.client().login("max@acme.test", "new password!");
    expect(await member.c.linkAccount("slack", "U_MAX", "max")).toEqual([expect.objectContaining({ provider: "slack", externalId: "U_MAX" })]);
    await expect(o.linkAccount("slack", "U_MAX")).rejects.toMatchObject({ status: 409 });
    expect(s.kiln.users.resolveIdentity("slack", "U_MAX")).toBe("max@acme.test");
    expect(await member.c.unlinkAccount("slack")).toEqual([]);
  });

  it("API keys: personal, agent and worker; shown once, revocable, last use recorded", async () => {
    const s = setup();
    const { o, member } = await people(s);
    const personal = await member.c.createApiKey({ name: "laptop", expiresIn: "1d" });
    expect(personal.token).toMatch(/^kiln_tok_/);
    expect(personal.record).not.toHaveProperty("hash");
    expect(new Date(personal.record.expiresAt!).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    const viaKey = s.client(personal.token);
    expect(await viaKey.me()).toMatchObject({ tokenType: "personal", subject: "max@acme.test", factoryRoles: { webapp: "user" } });
    await expect(member.c.createApiKey({ name: "bot", type: "agent" })).rejects.toMatchObject({ status: 403 });
    const agent = await o.createApiKey({ name: "bot", type: "agent", expiresIn: "never" });
    expect(agent.record).toMatchObject({ type: "agent", subject: "agent:default/bot" });
    expect(agent.record.expiresAt).toBeUndefined();
    const bot = s.client(agent.token);
    expect((await bot.factories()).map((f) => f.id)).toEqual(["webapp"]);
    const sent = await bot.send({ factory: "webapp", title: "Nightly dependency bump" });
    await expect(bot.decide("gate_x", "approve")).rejects.toMatchObject({ status: 404 });
    expect(sent.requester).toBe("agent:default/bot");
    const worker = await o.createApiKey({ name: "runner-1", type: "worker" });
    await expect(s.client(worker.token).factories()).resolves.toEqual([]);
    const listed = await o.apiKeys();
    expect(listed.map((k) => k.type).sort()).toEqual(["agent", "worker"]);
    expect((await member.c.apiKeys()).map((k) => k.name)).toEqual(["laptop"]);
    expect((await member.c.apiKeys())[0]!.lastUsedAt).toBeTruthy();
    await member.c.revokeApiKey(personal.record.id);
    await expect(viaKey.me()).rejects.toMatchObject({ status: 401 });
    await expect(member.c.revokeApiKey(agent.record.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("secrets, MCP servers, environments and usage API", () => {
  it("secrets are write-only; team secrets need a team admin; personal ones are yours", async () => {
    const s = setup();
    const { o, member } = await people(s);
    await o.createManagedSecret({ name: "NPM_TOKEN", value: "npm_live_123456", description: "npm publish" });
    await expect(member.c.createManagedSecret({ name: "X", value: "y" })).rejects.toMatchObject({ status: 403 });
    await member.c.createManagedSecret({ scope: "personal", name: "MY_TOKEN", type: "openai_api_key", value: "sk-proj-mine" });
    await expect(o.createManagedSecret({ name: "NPM_TOKEN", value: "again" })).rejects.toMatchObject({ status: 409 });
    await expect(o.createManagedSecret({ name: "REG", type: "docker_registry", value: "nope" })).rejects.toMatchObject({ status: 400 });
    const listed = await member.c.managedSecrets();
    expect(listed.map((x) => `${x.scope}:${x.name}`)).toEqual(["personal:MY_TOKEN", "team:NPM_TOKEN"]);
    expect(JSON.stringify(listed)).not.toMatch(/npm_live|sk-proj/);
    expect((await o.managedSecrets()).map((x) => x.name)).toEqual(["NPM_TOKEN"]);
    const updated = await o.updateManagedSecret("team", "NPM_TOKEN", { value: "npm_live_rotated" });
    expect(updated.updatedBy).toBe("olga@acme.test");
    await member.c.deleteManagedSecret("personal", "MY_TOKEN");
    await expect(member.c.deleteManagedSecret("team", "NPM_TOKEN")).rejects.toMatchObject({ status: 403 });
    expect((await o.audit()).map((a) => a.action)).toEqual(expect.arrayContaining(["secret.created", "secret.updated", "secret.deleted"]));
  });

  it("MCP servers and environments are team resources", async () => {
    const s = setup();
    const { o, member } = await people(s);
    const figma = await o.createMcpServer({ name: "figma", url: "https://mcp.figma.test/mcp", headers: { Authorization: "Bearer {{FIGMA_TOKEN}}" } });
    expect(figma.mode).toBe("managed");
    await expect(member.c.createMcpServer({ name: "x", url: "https://x.test" })).rejects.toMatchObject({ status: 403 });
    await expect(o.createMcpServer({ name: "bad", command: "x", url: "https://x.test" })).rejects.toMatchObject({ status: 400 });
    const listed = await member.c.mcpServers();
    expect(listed.servers.map((x) => x.name)).toEqual(["figma"]);
    expect(listed.builtins.map((b) => b.kiln_id)).toEqual(["linear", "slack", "jira", "github", "discord", "signoz"]);
    expect((await o.updateMcpServer(figma.id, { description: "Designs" })).description).toBe("Designs");
    await o.deleteMcpServer("figma");
    const env = await o.createEnvironment({ name: "node", image: "node:24", setupCommands: ["pnpm i"], repos: [{ owner: "acme", name: "web" }] });
    expect(await member.c.environment("node")).toMatchObject({ id: env.id, setupCommands: ["pnpm i"] });
    await o.updateEnvironment(env.id, { setupCommands: ["pnpm i", "pnpm build"] });
    expect((await member.c.environments())[0]!.setupCommands).toHaveLength(2);
    await o.deleteEnvironment(env.id);
    expect(await o.environments()).toEqual([]);
  });

  it("usage breakdowns and the spend limit returns budget_exceeded", async () => {
    const s = setup({ harnessCost: 4 });
    const { o, member } = await people(s);
    const sha = s.kiln.defs.require("webapp").appliedSha!;
    await s.kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false, triggeredBy: member.session.user.id });
    await s.kiln.runs.execute({ factory: "webapp", sha, agent: "review", prompt: "x", push: false });
    const u = await member.c.usage({ entries: true });
    expect(u).toMatchObject({ totalUsd: 8, runs: 2, limit: { monthlyUsd: 200, spentThisMonthUsd: 8, exceeded: false } });
    expect(u.byUser.map((r) => r.key).sort()).toEqual(["max@acme.test", "team"]);
    expect(u.byFactory).toEqual([{ key: "webapp", costUsd: 8, runs: 2 }]);
    expect(u.entries).toHaveLength(2);
    expect((await o.usage({ user: "max@acme.test" })).totalUsd).toBe(4);
    await o.updateTeamSettings("default", { spendLimit: { monthlyUsd: 5, autoStop: true } });
    const res = await s.app.request("/api/v1/work-items", {
      method: "POST",
      body: JSON.stringify({ factory: "webapp", title: "More" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${member.session.token}` },
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "budget_exceeded", message: "Monthly spending budget of $5 has been reached ($8.00 spent)" });
  });
});

describe("team MCP tools", () => {
  it("list_teams, create_team and join_team", async () => {
    const s = setup();
    const { o, admin } = await people(s);
    const connect = async (token: string) => {
      const c = new Client({ name: "test", version: "1.0.0" });
      await c.connect(new StreamableHTTPClientTransport(new URL("http://kiln.test/mcp"), { fetch: s.inProcess as typeof fetch, requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      return c;
    };
    const text = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0]!.text);
    const mcp = await connect(admin.session.token);
    const created = text(await mcp.callTool({ name: "create_team", arguments: { name: "Mobile" } }));
    expect(created).toMatchObject({ slug: "mobile", role: "owner" });
    const inv = await admin.c.inviteMember("mobile", "olga@acme.test", "member");
    const olga = await connect((await s.client().login("olga@acme.test", pw)).token);
    expect(text(await olga.callTool({ name: "join_team", arguments: { invite: inv.link } }))).toMatchObject({ team: { slug: "mobile" }, role: "member" });
    expect(text(await olga.callTool({ name: "list_teams", arguments: {} })).map((t: { slug: string }) => t.slug)).toEqual(["default", "mobile"]);
    expect(o).toBeTruthy();
  });
});
