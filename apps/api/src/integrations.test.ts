import { createHmac, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { issueToken } from "@kiln/auth";
import { createTestKiln, sampleTree } from "@kiln/engine";
import { FakeBotFrameworkVerifier, FakeChat, FakeConnectionProvider, FakeGitHubManifests, unzipStored } from "@kiln/integrations";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const automations = {
  "automations/gitlab/automation.md": "---\ntriggers:\n  - provider: gitlab\n    event: bot_mentioned\n---\nDo it.\n",
  "automations/ado/automation.md": "---\ntriggers:\n  - provider: azure_devops\n    event: work_item_assigned\n    filter: { work_item_types: [Bug] }\n---\n",
  "automations/bitbucket/automation.md": "---\ntriggers:\n  - provider: bitbucket\n    event: pull_request_commented\n    filter: { mentioned: [kiln] }\n---\n",
  "automations/teams/automation.md": "---\ntriggers:\n  - provider: teams\n    event: app_mention\n---\n",
  "automations/discord/automation.md": "---\ntriggers:\n  - provider: discord\n    event: slash_command\n  - provider: discord\n    event: app_mention\n---\n",
  "automations/jira/automation.md":
    "---\ntriggers:\n  - provider: jira\n    event: agent_session_created\n    filter: { project_keys: [ENG], keywords: [investigate] }\n---\n",
  "automations/alerts/automation.md":
    "---\ntriggers:\n  - provider: webhook\n    event: received\n    filter:\n      webhook_ids: [pagerduty]\n      payload: { event: { event_type: [incident.triggered] } }\n---\nTriage.\n",
  "webhooks/pagerduty.yaml": "authMode: signature\nsignatureScheme: pagerduty\nsecretName: PD_SECRET\n",
};

function setup() {
  const teams = new FakeChat("teams");
  const discord = new FakeChat("discord");
  const t = createTestKiln({
    tree: sampleTree(automations),
    adapters: { chats: { teams, discord }, teamsVerifier: new FakeBotFrameworkVerifier("bf-token") },
    connectionProviders: { linear: new FakeConnectionProvider("linear", "Linear"), jira: new FakeConnectionProvider("jira", "Jira") },
    publicUrl: "http://kiln.test",
  });
  const app = createApp(t.kiln);
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  const token = (subject: string, grants: { scope: string; factory: string }[]) =>
    issueToken(t.kiln.store, { name: subject, subject, grants: grants as never }).token;
  const client = (tok: string) => new KilnClient({ baseUrl: "http://kiln.test", token: tok, fetch: inProcess as typeof fetch });
  const admin = client(token("admin@acme.test", [{ scope: "admin", factory: "*" }]));
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }) as unknown as Promise<JsonResponse>;
  return { ...t, app, teams, discord, client, token, admin, post };
}

type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("connections API", () => {
  it("connects, tests and disconnects through the SDK; non-admins are refused", async () => {
    const { admin, client, token, kiln } = setup();
    const start = await admin.startConnection("linear");
    expect(start.url).toContain(`state=${start.state}`);
    const conn = await admin.completeConnection("linear", { code: "ok", state: start.state });
    expect(conn).toMatchObject({ status: "connected", connectedBy: "admin@acme.test", secretNames: ["token"] });
    expect((await admin.connections()).find((r) => r.provider === "linear")!.connection!.status).toBe("connected");
    expect(await admin.testConnection("linear")).toEqual({ ok: true, message: "Linear answered" });
    const reader = client(token("dev@acme.test", [{ scope: "read", factory: "*" }]));
    await expect(reader.connections()).rejects.toMatchObject({ status: 403 });
    await admin.disconnect("linear");
    expect(kiln.connections.isConnected("linear")).toBe(false);
    await expect(admin.startConnection("myspace")).rejects.toMatchObject({ status: 400 });
  });

  it("finishes OAuth on the callback route and handles approval links", async () => {
    const { admin, app, kiln } = setup();
    const { state } = await admin.startConnection("linear");
    const cb = await app.request(`/oauth/linear/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("connected=1");
    const link = await admin.createApprovalLink("jira", "siteadmin@acme.test");
    expect(link.url).toBe(`http://kiln.test/connect/approve/${link.token}`);
    expect((await admin.approvalLinks("jira"))[0]).not.toHaveProperty("token");
    const open = await app.request(`/connect/approve/${link.token}`);
    expect(open.headers.get("location")).toMatch(/^https:\/\/jira\.test\/oauth\?state=/);
    const resent = await admin.resendApprovalLink(link.id);
    expect((await app.request(`/connect/approve/${link.token}`)).status).toBe(404);
    await admin.revokeApprovalLink(resent.id);
    expect((await app.request(`/connect/approve/${resent.token}`)).status).toBe(404);
    expect(kiln.connections.get("jira")).toBeUndefined();
  });

  it("reads and sets factory integrations, keeping Linear and Jira exclusive", async () => {
    const { admin } = setup();
    expect((await admin.factoryIntegrations("webapp")).integrations).toEqual([{ type: "slack" }, { type: "linear" }]);
    const r = await admin.setFactoryIntegrations("webapp", [
      { type: "slack", slack: { autoRespondToThreadReplies: false } },
      { type: "discord", discord: { guildIds: ["g1"] } },
      "linear",
    ]);
    expect(r.integrations).toEqual([
      { type: "slack", slack: { autoRespondToThreadReplies: false } },
      { type: "discord", discord: { guildIds: ["g1"] } },
      { type: "linear" },
    ]);
    await expect(admin.setFactoryIntegrations("webapp", ["linear", "jira"])).rejects.toMatchObject({ status: 400 });
  });

  it("builds the Teams app package and lists notification routes", async () => {
    const { admin, kiln } = setup();
    kiln.secrets.setSecret("TEAMS_APP_ID", "bot-app-id");
    const zip = Buffer.from(await admin.teamsAppPackage({ name: "Acme Kiln" }));
    const files = unzipStored(zip);
    expect(JSON.parse(files["manifest.json"]!.toString())).toMatchObject({ id: "bot-app-id", name: { short: "Acme Kiln" } });
    const routes = await admin.notificationRoutes({ factory: "webapp" });
    expect(routes.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["slack_dm", "discord_dm", "teams_thread", "linear_issue", "jira_issue", "github_comment", "gitlab_comment"]),
    );
    expect(routes.find((r) => r.kind === "slack_dm")!.reason).toMatch(/link your slack account/);
  });
});

describe("deleting a factory", () => {
  it("needs Admin, cancels open work and removes labels and webhooks", async () => {
    const { admin, client, token, kiln, forge } = setup();
    await settle();
    expect([...(forge.labels.get("acme/web") ?? [])]).toContain("factory:webapp");
    const { webhook } = await admin.createWebhook("webapp", { name: "gone" });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "In flight", body: "", source: { provider: "api" }, requester: "a" });
    const reader = client(
      token("dev@acme.test", [
        { scope: "read", factory: "webapp" },
        { scope: "send", factory: "webapp" },
      ]),
    );
    await expect(reader.deleteFactory("webapp")).rejects.toMatchObject({ status: 403 });
    const r = await admin.deleteFactory("webapp");
    expect(r.cancelled).toContain(wi.id);
    expect(kiln.defs.get("webapp")).toBeUndefined();
    expect([...(forge.labels.get("acme/web") ?? [])]).not.toContain("factory:webapp");
    expect(kiln.webhookSources.get(webhook.id)).toBeUndefined();
    await expect(admin.deleteFactory("webapp")).rejects.toMatchObject({ status: 404 });
  });
});

describe("provider webhooks", () => {
  it("Teams: verifies the Bot Framework token, starts work and answers sign in", async () => {
    const { post, kiln, teams } = setup();
    const activity = (text: string, id: string) =>
      JSON.stringify({
        type: "message",
        id,
        text,
        serviceUrl: "https://smba.test/",
        recipient: { id: "28:bot" },
        from: { id: "29:u", aadObjectId: "aad-1" },
        conversation: { id: "19:c@thread.tacv2" },
        channelData: { team: { id: "T" }, channel: { id: "19:c@thread.tacv2" } },
        entities: [{ type: "mention", mentioned: { id: "28:bot" } }],
      });
    expect((await post("/webhooks/teams", activity("<at>Kiln</at> fix it", "a1"), { authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await post("/webhooks/teams", activity("<at>Kiln</at> fix the footer", "a2"), { authorization: "Bearer bf-token" });
    expect(await ok.json()).toEqual({ started: 1, continued: 0 });
    expect(kiln.workflow.list().find((w) => w.source.provider === "teams")).toMatchObject({
      title: "fix the footer",
      source: { channel: "19:c@thread.tacv2", thread: "a2" },
    });
    await post("/webhooks/teams", activity("<at>Kiln</at> sign in", "a3"), { authorization: "Bearer bf-token" });
    expect(teams.messages.at(-1)!.text).toMatch(/http:\/\/localhost:3000\/link\?token=|\/link\?token=/);
  });

  it("Discord: verifies Ed25519, answers pings and /kiln", async () => {
    const { post, kiln } = setup();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    kiln.secrets.setSecret("DISCORD_PUBLIC_KEY", (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex"));
    const signed = (body: string) => {
      const ts = String(Math.floor(Date.now() / 1000));
      return { "x-signature-ed25519": cryptoSign(null, Buffer.from(ts + body), privateKey).toString("hex"), "x-signature-timestamp": ts };
    };
    const ping = JSON.stringify({ type: 1 });
    expect(await (await post("/webhooks/discord", ping, signed(ping))).json()).toEqual({ type: 1 });
    expect((await post("/webhooks/discord", ping, { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": "1" })).status).toBe(401);
    const cmd = JSON.stringify({
      id: "i1",
      type: 2,
      token: "itok",
      channel_id: "c1",
      guild_id: "g1",
      member: { user: { id: "u1" } },
      data: { name: "kiln", options: [{ name: "prompt", value: "Add a dark mode toggle" }] },
    });
    expect(await (await post("/webhooks/discord", cmd, signed(cmd))).json()).toEqual({ type: 4, data: { content: "On it: Add a dark mode toggle" } });
    await settle();
    expect(kiln.workflow.list().find((w) => w.source.provider === "discord")).toMatchObject({
      title: "Add a dark mode toggle",
      source: { automation: "discord", channel: "c1" },
    });
  });

  it("GitLab, Azure DevOps and Bitbucket start work with their own auth", async () => {
    const { post, kiln } = setup();
    kiln.secrets.setSecret("GITLAB_WEBHOOK_TOKEN", "gl-secret");
    kiln.secrets.setSecret("GITLAB_BOT_USERNAMES", "webapp-kiln-ab12");
    const note = JSON.stringify({
      object_kind: "note",
      project: { path_with_namespace: "acme/api" },
      user: { username: "alice" },
      object_attributes: { note: "@webapp-kiln-ab12 bump the timeout", discussion_id: "d1" },
      merge_request: { iid: 3, title: "Timeouts" },
    });
    expect((await post("/webhooks/gitlab", note, { "x-gitlab-token": "nope", "x-gitlab-event": "Note Hook" })).status).toBe(401);
    const gl = await (
      await post("/webhooks/gitlab", note, { "x-gitlab-token": "gl-secret", "x-gitlab-event": "Note Hook", "x-gitlab-event-uuid": "u1" })
    ).json();
    expect(gl.started).toHaveLength(1);
    expect(kiln.workflow.get(gl.started[0].id)!.source).toMatchObject({ provider: "gitlab", repo: "acme/api", number: 3, discussionId: "d1" });

    kiln.secrets.setSecret("AZURE_DEVOPS_WEBHOOK_PASSWORD", "hook-pass");
    const wi = JSON.stringify({
      id: "e1",
      eventType: "workitem.updated",
      resource: {
        workItemId: 9,
        fields: { "System.AssignedTo": { newValue: "Kiln" } },
        revision: { fields: { "System.Title": "Crash", "System.WorkItemType": "Bug", "System.AssignedTo": "Kiln" } },
      },
    });
    const basic = (p: string) => ({ authorization: `Basic ${Buffer.from(`kiln:${p}`).toString("base64")}` });
    expect((await post("/webhooks/azure-devops", wi, basic("bad"))).status).toBe(401);
    expect((await (await post("/webhooks/azure-devops", wi, basic("hook-pass"))).json()).started).toHaveLength(1);

    kiln.secrets.setSecret("BITBUCKET_WEBHOOK_SECRET", "bb");
    const bb = JSON.stringify({
      repository: { full_name: "acme/app" },
      actor: { nickname: "al" },
      pullrequest: { id: 5, title: "PR" },
      comment: { content: { raw: "@kiln review this" } },
    });
    const sig = `sha256=${createHmac("sha256", "bb").update(bb).digest("hex")}`;
    expect(
      (await (await post("/webhooks/bitbucket", bb, { "x-hub-signature": sig, "x-event-key": "pullrequest:comment_created", "x-request-uuid": "b1" })).json())
        .started,
    ).toHaveLength(1);
  });

  it("Slack acknowledges with 👀; Jira starts agent sessions; Linear checks signatures", async () => {
    const { post, kiln, chat } = setup();
    kiln.secrets.setSecret("SLACK_SIGNING_SECRET", "slk");
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "Ev1",
      event: { type: "app_mention", channel: "C1", ts: "1.1", user: "U1", text: "<@UBOT> @webapp fix typo" },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v0=${createHmac("sha256", "slk").update(`v0:${ts}:${body}`).digest("hex")}`;
    expect((await post("/webhooks/slack", body, { "x-slack-request-timestamp": ts, "x-slack-signature": sig })).status).toBe(200);
    await settle();
    expect(chat.reactions).toContainEqual({ channel: "C1", ts: "1.1", emoji: "eyes" });
    const signIn = JSON.stringify({
      type: "event_callback",
      event_id: "Ev2",
      event: { type: "message", channel_type: "im", channel: "D1", ts: "2.1", user: "U9", text: "sign in" },
    });
    const sig2 = `v0=${createHmac("sha256", "slk").update(`v0:${ts}:${signIn}`).digest("hex")}`;
    await post("/webhooks/slack", signIn, { "x-slack-request-timestamp": ts, "x-slack-signature": sig2 });
    await settle();
    const linkText = chat.messages.at(-1)!.text;
    expect(linkText).toMatch(/connect your Slack account/);
    const u9 = kiln.users.create({ email: "u9@acme.test" });
    kiln.identities.claim(/token=([\w-]+)/.exec(linkText)![1]!, u9.id);
    expect(kiln.automations.person("slack", "U9")).toBe("u9@acme.test");

    kiln.secrets.setSecret("JIRA_BOT_ACCOUNT_ID", "kiln-bot");
    const jira = JSON.stringify({
      webhookEvent: "jira:issue_updated",
      issue: {
        key: "ENG-4",
        fields: { summary: "Slow page", description: "please investigate", project: { key: "ENG" }, assignee: { accountId: "kiln-bot" } },
      },
      changelog: { items: [{ field: "assignee", to: "kiln-bot" }] },
    });
    expect((await (await post("/webhooks/jira", jira, { "x-atlassian-webhook-identifier": "j1" })).json()).started).toHaveLength(1);

    kiln.secrets.setSecret("LINEAR_WEBHOOK_SECRET", "lin");
    const lin = JSON.stringify({ type: "AgentSessionEvent", action: "created", agentSession: { id: "s1", issue: { id: "i1", title: "T", teamId: "t1" } } });
    expect((await post("/webhooks/linear", lin, { "linear-signature": "00" })).status).toBe(401);
    expect(
      (
        await (
          await post("/webhooks/linear", lin, { "linear-signature": createHmac("sha256", "lin").update(lin).digest("hex"), "linear-delivery": "l1" })
        ).json()
      ).started,
    ).toHaveLength(1);
  });
});

describe("custom webhooks API", () => {
  it("creates a webhook, receives deliveries at /webhooks/w/<uid> and tests filters", async () => {
    const { admin, app, kiln } = setup();
    const created = await admin.createWebhook("webapp", { name: "deploys" });
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.url).toBe(`http://kiln.test/webhooks/w/${created.webhook.id}`);
    const body = JSON.stringify({ title: "Deploy failed", env: "prod" });
    const res = await app.request(`/webhooks/w/${created.webhook.id}`, {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${created.secret}`, "x-kiln-delivery-id": "dep-1" },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ delivery_id: "dep-1" });
    expect((await app.request(`/webhooks/w/${created.webhook.id}`)).status).toBe(405);
    expect((await app.request("/webhooks/w/wh_missing", { method: "POST", body })).status).toBe(404);
    const deliveries = await admin.webhookDeliveries(created.webhook.id);
    expect(deliveries[0]).toMatchObject({ status: "accepted", deliveryId: "dep-1", hasPayload: true });
    expect((await admin.webhookDelivery(created.webhook.id, deliveries[0]!.id)).payload).toEqual({ title: "Deploy failed", env: "prod" });
    await admin.updateWebhook(created.webhook.id, { enabled: false });
    expect(
      (await app.request(`/webhooks/w/${created.webhook.id}`, { method: "POST", body, headers: { authorization: `Bearer ${created.secret}` } })).status,
    ).toBe(404);
    const list = await admin.webhooks("webapp");
    expect(list.map((w) => [w.name, w.origin])).toEqual([
      ["deploys", "managed"],
      ["pagerduty", "file"],
    ]);
    const rotated = await admin.rotateWebhookSecret(created.webhook.id);
    expect(rotated.secret).not.toBe(created.secret);
    await admin.deleteWebhook(created.webhook.id);
    await expect(admin.webhook(created.webhook.id)).rejects.toMatchObject({ status: 404 });
  });

  it("routes file webhooks at the old and new URLs, with payload filters and Test filter", async () => {
    const { admin, app, kiln } = setup();
    kiln.secrets.setSecret("PD_SECRET", "pd");
    const send = (path: string, payload: unknown, id: string) => {
      const body = JSON.stringify(payload);
      return app.request(path, {
        method: "POST",
        body,
        headers: { "x-pagerduty-signature": `v1=${createHmac("sha256", "pd").update(body).digest("hex")}`, "x-webhook-id": id },
      }) as unknown as Promise<JsonResponse>;
    };
    const fired = await (await send("/webhooks/webapp/pagerduty", { event: { event_type: "incident.triggered" } }, "p1")).json();
    expect(fired.started).toHaveLength(1);
    const [file] = await admin.webhooks("webapp");
    const quiet = await (await send(`/webhooks/w/${file!.id}`, { event: { event_type: "incident.resolved" } }, "p2")).json();
    expect(quiet.started).toEqual([]);
    const deliveries = await admin.webhookDeliveries(file!.id);
    const result = await admin.testFilter("webapp", "alerts", deliveries.find((d) => d.deliveryId === "p2")!.id);
    expect(result.wouldTrigger).toBe(false);
    expect(result.triggers[0]!.checks.find((c) => c.check === "payload")!.ok).toBe(false);
    expect((await admin.testFilter("webapp", "alerts", deliveries.find((d) => d.deliveryId === "p1")!.id)).wouldTrigger).toBe(true);
  });

  it("runs an automation now, as the person who asked, and refuses unknown or disabled ones", async () => {
    const { admin, client, token, kiln } = setup();
    const r = await admin.runAutomation("webapp", "alerts");
    const wi = kiln.workflow.get(r.workItemId)!;
    expect(wi.source).toMatchObject({ provider: "kiln", automation: "alerts" });
    expect(wi.requester).toBe("admin@acme.test");
    expect(wi.body).toContain('Automation "alerts": Triage.');
    expect(await admin.runAutomation("webapp", "nope").catch((e: { status: number }) => e.status)).toBe(404);
    const reader = client(token("viewer@acme.test", [{ scope: "read", factory: "webapp" }]));
    expect(await reader.runAutomation("webapp", "alerts").catch((e: { status: number }) => e.status)).toBe(403);
    const tree = { ...kiln.defs.tree(kiln.defs.require("webapp").appliedSha!)! };
    tree["automations/alerts/automation.md"] = tree["automations/alerts/automation.md"]!.replace("---\ntriggers:", "---\nenabled: false\ntriggers:");
    expect(kiln.defs.apply(tree, { author: "test", factory: "webapp" }).ok).toBe(true);
    expect(await admin.runAutomation("webapp", "alerts").catch((e: { status: number }) => e.status)).toBe(409);
  });

  it("serves templates, the catalogue and adds a template to a factory", async () => {
    const { admin, kiln } = setup();
    const templates = await admin.automationTemplates({ factory: "webapp", category: "suggested" });
    expect(templates.map((t) => t.id)).toContain("autofix-ci-failures");
    expect(templates.find((t) => t.id === "auto-review-prs")!.files["automations/auto-review-prs/automation.md"]).toContain("pull_request_opened");
    expect(Object.keys((await admin.automationCatalog()).providers)).toEqual(
      expect.arrayContaining([
        "github",
        "gitlab",
        "azure_devops",
        "bitbucket",
        "slack",
        "teams",
        "discord",
        "linear",
        "jira",
        "webhook",
        "schedule",
        "factory",
      ]),
    );
    const r = await admin.addAutomationFromTemplate("webapp", "audit-dependencies");
    expect(r.applied).toBe(true);
    expect(Object.keys(kiln.defs.current("webapp").automations)).toContain("audit-dependencies");
  });
});

describe("Kiln's own GitHub App from a manifest", () => {
  function appSetup() {
    const manifests = new FakeGitHubManifests();
    const configured: string[] = [];
    const t = createTestKiln({
      publicUrl: "https://kiln-api.acme.test",
      webUrl: "https://kiln.acme.test",
      secretKey: "test-secret-key",
      githubManifests: manifests,
      onGitHubApp: (a) => configured.push(a.slug),
      connectionProviders: { github: new FakeConnectionProvider("github", "GitHub") },
    });
    const app = createApp(t.kiln);
    const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
    const tok = (subject: string, scope: string) => issueToken(t.kiln.store, { name: subject, subject, grants: [{ scope: scope as never, factory: "*" }] }).token;
    const client = (token: string) => new KilnClient({ baseUrl: "http://kiln.test", token, fetch: inProcess as typeof fetch });
    return { ...t, app, manifests, configured, admin: client(tok("admin@acme.test", "admin")), reader: client(tok("viewer@acme.test", "read")) };
  }

  it("creates the app, keeps its key out of reach of agents, and connects after install", async () => {
    const { app, kiln, manifests, configured, admin, reader } = appSetup();
    await expect(reader.request("POST", "/api/v1/connections/github/app-manifest", {})).rejects.toMatchObject({ status: 403 });
    const start = await admin.request<{ action: string; state: string; manifest: { hook_attributes: { url: string }; redirect_url: string; setup_url: string; default_permissions: Record<string, string> } }>("POST", "/api/v1/connections/github/app-manifest", { org: "acme" });
    expect(start.action).toBe(`https://github.com/organizations/acme/settings/apps/new?state=${start.state}`);
    expect(start.manifest).toMatchObject({ hook_attributes: { url: "https://kiln-api.acme.test/webhooks/github" }, redirect_url: "https://kiln-api.acme.test/oauth/github/app/callback", setup_url: "https://kiln-api.acme.test/oauth/github/app/installed" });
    expect(start.manifest.default_permissions).toMatchObject({ contents: "write", pull_requests: "write", issues: "write" });

    const created = await app.request(`/oauth/github/app/callback?code=abc&state=${start.state}`);
    expect(created.status).toBe(302);
    const install = new URL(created.headers.get("location")!);
    expect(install.origin + install.pathname).toBe("https://github.com/apps/kiln-test/installations/new");
    expect(manifests.codes).toEqual(["abc"]);
    expect(configured).toEqual(["kiln-test"]);
    // The state is single use.
    expect((await app.request(`/oauth/github/app/callback?code=abc&state=${start.state}`)).headers.get("location")).toContain("error=");
    // The key is not a named secret: neither the server secrets nor a run's resolver can return it.
    expect(JSON.stringify(kiln.store.list("github_app"))).not.toContain("BEGIN RSA");
    expect(kiln.secrets.getSecret("GITHUB_APP_PRIVATE_KEY")).toBeUndefined();
    expect(kiln.vault.resolver({}).get("GITHUB_APP_PRIVATE_KEY")).toBeUndefined();
    expect(await admin.request("GET", "/api/v1/connections/github/app")).toMatchObject({ slug: "kiln-test", appId: "4242", createdBy: "admin@acme.test" });

    const installed = await app.request(`/oauth/github/app/installed?installation_id=987&setup_action=install&state=${install.searchParams.get("state")}`);
    expect(decodeURIComponent(installed.headers.get("location")!)).toBe("https://kiln.acme.test/integrations?provider=github&connected=1");
    expect(kiln.githubApp.info()).toMatchObject({ installationId: "987" });
    expect(kiln.connections.list().find((p) => p.provider === "github")?.connection?.status).toBe("connected");
    // Webhooks are now verified with the app's secret.
    const unsigned = await app.request("/webhooks/github", { method: "POST", body: "{}", headers: { "x-github-event": "ping" } });
    expect(unsigned.status).toBe(401);
  });

  it("keeps one app per account or organization", async () => {
    const { app, kiln, manifests, admin } = appSetup();
    const create = async (org?: string) => {
      const { state } = await admin.request<{ state: string }>("POST", "/api/v1/connections/github/app-manifest", org ? { org } : {});
      const install = new URL((await app.request(`/oauth/github/app/callback?code=c&state=${state}`)).headers.get("location")!);
      return install.searchParams.get("state")!;
    };
    const first = await create();
    await app.request(`/oauth/github/app/installed?installation_id=1&state=${first}`);
    manifests.next = { appId: "5151", slug: "kiln-inofy-org", privateKey: "-----BEGIN RSA PRIVATE KEY-----\norg\n-----END RSA PRIVATE KEY-----\n", webhookSecret: "whsec-org", owner: "inofy" };
    const second = await create("inofy");
    await app.request(`/oauth/github/app/installed?installation_id=2&state=${second}`);
    const apps = await admin.request<{ slug: string; owner?: string; installationId?: string }[]>("GET", "/api/v1/connections/github/apps");
    expect(apps.map((a) => [a.slug, a.owner, a.installationId])).toEqual([
      ["kiln-test", "acme", "1"],
      ["kiln-inofy-org", "inofy", "2"],
    ]);
    expect(kiln.githubApp.allCredentials().map((c) => c.webhookSecret)).toEqual(["whsec-fake", "whsec-org"]);
    // Deliveries signed by either app are accepted.
    const body = JSON.stringify({ zen: "ok" });
    const sig = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    for (const secret of ["whsec-fake", "whsec-org"]) expect((await app.request("/webhooks/github", { method: "POST", body, headers: { "x-github-event": "ping", "x-hub-signature-256": sig(secret) } })).status).toBe(200);
    expect((await app.request("/webhooks/github", { method: "POST", body, headers: { "x-github-event": "ping", "x-hub-signature-256": sig("nope") } })).status).toBe(401);
  });

  it("removes an app an admin created by mistake", async () => {
    const { app, kiln, manifests, admin, reader } = appSetup();
    const create = async (org?: string) => {
      const { state } = await admin.request<{ state: string }>("POST", "/api/v1/connections/github/app-manifest", org ? { org } : {});
      await app.request(`/oauth/github/app/callback?code=c&state=${state}`);
    };
    await create();
    manifests.next = { appId: "5151", slug: "kiln-dup", privateKey: "-----BEGIN RSA PRIVATE KEY-----\ndup\n-----END RSA PRIVATE KEY-----\n", webhookSecret: "whsec-dup", owner: "acme" };
    await create("acme");
    await expect(reader.removeGitHubApp("kiln-dup")).rejects.toMatchObject({ status: 403 });
    await admin.removeGitHubApp("kiln-dup");
    expect((await admin.githubApps()).map((a) => a.slug)).toEqual(["kiln-test"]);
    expect(kiln.githubApp.allCredentials().map((c) => c.webhookSecret)).toEqual(["whsec-fake"]);
    expect(kiln.store.list<{ id: string; action: string; target: string }>("audit").some((e) => e.action === "github_app.removed" && e.target === "kiln-dup")).toBe(true);
    await expect(admin.removeGitHubApp("kiln-dup")).rejects.toMatchObject({ status: 404 });
  });

  it("sends people back to Integrations when GitHub's code has expired", async () => {
    const { app, admin } = appSetup();
    const { state } = await admin.request<{ state: string }>("POST", "/api/v1/connections/github/app-manifest");
    const r = await app.request(`/oauth/github/app/callback?code=expired&state=${state}`);
    expect(r.headers.get("location")).toMatch(/^https:\/\/kiln\.acme\.test\/integrations\?provider=github&error=GitHub%20did%20not%20return/);
  });
});
