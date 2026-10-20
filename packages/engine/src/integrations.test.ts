import { createHmac } from "node:crypto";
import { FakeConnectionProvider, FakeLinearAgentApi, normalizeGitHubEvents, type IncomingEvent } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { AUTOMATION_TEMPLATES, renderTemplates } from "./automation-templates";
import { cloudProviderEnv } from "./cloud";
import { evaluateTrigger, matchPayload } from "./matchers";
import { createTestKiln, sampleTree } from "./testing";
import { FakeClock } from "./types";

const ev = (provider: IncomingEvent["provider"], event: string, data: IncomingEvent["data"], deliveryId?: string): IncomingEvent => ({ provider, event, data, deliveryId });
const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

describe("trigger matching", () => {
  it("applies in/not_in, keywords, path globs and integer matchers", () => {
    const pr = ev("github", "pull_request_opened", { repos: ["acme/web"], labels: ["bug"], base: "main", number: 7, title: "Fix login", body: "", paths: ["api/users.ts"] });
    const t = (filter: Record<string, unknown>) => evaluateTrigger({ provider: "github", event: "pull_request_opened", filter }, pr).ok;
    expect(t({ labels: { not_in: ["wip"] }, base_branches: ["main"] })).toBe(true);
    expect(t({ labels: { in: ["feature"] } })).toBe(false);
    expect(t({ keywords: ["LOGIN"] })).toBe(true);
    expect(t({ paths: ["api/**"] })).toBe(true);
    expect(t({ paths: ["web/**"] })).toBe(false);
    expect(t({ pr_numbers: [7] })).toBe(true);
    expect(t({ prNumbers: [8] })).toBe(false);
    expect(t({ assignees: ["alice"] })).toBe(false);
  });

  it("skips bots by default on GitHub and only Kiln itself elsewhere", () => {
    const bot = (provider: IncomingEvent["provider"], event: string, self = false) => ev(provider, event, { authorIsBot: true, authorIsSelf: self });
    expect(evaluateTrigger({ provider: "github", event: "issue_created" }, bot("github", "issue_created")).ok).toBe(false);
    expect(evaluateTrigger({ provider: "github", event: "issue_created", filter: { skip_bots: "self" } }, bot("github", "issue_created")).ok).toBe(true);
    expect(evaluateTrigger({ provider: "github", event: "issue_created", filter: { skip_bots: "self" } }, bot("github", "issue_created", true)).ok).toBe(false);
    expect(evaluateTrigger({ provider: "github", event: "issue_created", filter: { skip_bots: "none" } }, bot("github", "issue_created", true)).ok).toBe(true);
    expect(evaluateTrigger({ provider: "linear", event: "issue_created" }, bot("linear", "issue_created")).ok).toBe(true);
    expect(evaluateTrigger({ provider: "linear", event: "issue_created" }, bot("linear", "issue_created", true)).ok).toBe(false);
  });

  it("matches alias lists by resolved ids, falling back to names", () => {
    const e = ev("linear", "issue_created", { team_ids: ["team_eng"], team_names: ["Engineering", "ENG"] });
    expect(evaluateTrigger({ provider: "linear", event: "issue_created", filter: { teams: ["Engineering"] } }, e, { aliases: { "teams:Engineering": ["team_eng"] } }).ok).toBe(true);
    expect(evaluateTrigger({ provider: "linear", event: "issue_created", filter: { teams: ["Design"] } }, e, { aliases: { "teams:Design": ["team_design"] } }).ok).toBe(false);
    expect(evaluateTrigger({ provider: "linear", event: "issue_created", filter: { teams: ["eng"] } }, e).ok).toBe(true);
  });

  it("follows the payload filter rules and fails closed", () => {
    const body = { data: { issue: { level: "fatal", count: 3, tags: ["prod", "eu"], resolved: false, owner: null }, events: [{ type: "a" }, { type: "b" }] } };
    expect(matchPayload({ data: { issue: { level: ["fatal"] } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { level: ["Fatal"] } } }, body)).toBe(false);
    expect(matchPayload({ data: { issue: { count: [3.0] } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { resolved: [false], owner: [null] } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { tags: ["eu"] } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { tags: { not_in: ["dev", "eu"] } } } }, body)).toBe(false);
    expect(matchPayload({ data: { issue: { missing: ["x"] } } }, body)).toBe(false);
    expect(matchPayload({ data: { issue: { missing: { not_in: ["x"] } } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { missing: { exists: false } } } }, body)).toBe(true);
    expect(matchPayload({ data: { nested: { anything: ["x"] } } }, body)).toBe(false);
    expect(matchPayload({ data: { events: { type: ["b"] } } }, body)).toBe(true);
    expect(matchPayload({ data: { issue: { level: { in: ["fatal"], not_in: ["fatal"] } } } }, body)).toBe(false);
  });

  it("maps work-item states to stages", () => {
    const e = ev("factory", "work_item_stage_changed", { to: "handed_off" });
    expect(evaluateTrigger({ provider: "factory", event: "work_item_stage_changed", filter: { stages: ["REVIEW"] } }, e).ok).toBe(true);
    expect(evaluateTrigger({ provider: "factory", event: "work_item_stage_changed", filter: { stages: ["handed_off"] } }, e).ok).toBe(true);
    expect(evaluateTrigger({ provider: "factory", event: "work_item_stage_changed", filter: { stages: ["COMPLETE"] } }, e).ok).toBe(false);
  });
});

describe("automation routing", () => {
  const both = sampleTree({
    "agents/helper/agent.md": "---\ndescription: helps\n---\nHelp.\n",
    "automations/comments/automation.md": "---\nagent: helper\ntriggers:\n  - provider: github\n    event: issue_commented\n  - provider: github\n    event: issue_mentioned\n---\nAnswer.\n",
  });

  it("fires an automation once per delivery and dedupes retries across restarts of the dedupe", async () => {
    const { kiln } = createTestKiln({ tree: both });
    const events = normalizeGitHubEvents("issue_comment", { action: "created", repository: { full_name: "acme/web" }, sender: { login: "alice" }, issue: { number: 3, title: "Q" }, comment: { body: "@someone can you look" } }, "gh-1");
    expect(events).toHaveLength(2);
    const r = await kiln.automations.handle(events);
    expect(r.started.filter((w) => w.source.automation === "comments")).toHaveLength(1);
    expect((await kiln.automations.handle(events)).duplicate).toBe(true);
    const log = kiln.automations.deliveries({ provider: "github" });
    expect(log[0]).toMatchObject({ duplicate: true });
    expect(log[1]!.events.map((e) => e.event)).toEqual(["issue_commented", "issue_mentioned"]);
  });

  it("carries execution overrides to the work item", async () => {
    const tree = sampleTree({
      "runners/big.yaml": "image: node:22\nbackend: local\n",
      "automations/heavy/automation.md": "---\nrunner: big\nsecrets: [NPM_TOKEN]\nenvironmentId: env_1\nworkerHost: gpu-1\nidleTimeoutMinutes: 30\nrequired_repos: [acme/docs]\ntriggers:\n  - provider: slack\n    event: reaction_added\n    filter: { emojis: [ticket] }\n---\nFile it.\n",
    });
    const { kiln } = createTestKiln({ tree });
    const { started } = await kiln.automations.handle(ev("slack", "reaction_added", { emoji: "ticket", channel: "C1", thread: "1.0", title: "x" }, "r1"));
    expect(started[0]!.execution).toMatchObject({ runner: "big", secrets: ["NPM_TOKEN"], environmentId: "env_1", workerHost: "gpu-1", idleTimeoutMinutes: 30, requiredRepos: ["acme/docs"] });
  });

  it("resolves alias names when applying and rejects unknown ones", async () => {
    const { kiln } = createTestKiln();
    const tree = sampleTree({ "automations/linear-eng/automation.md": "---\ntriggers:\n  - provider: linear\n    event: issue_created\n    filter: { teams: [Engineering] }\n---\n" });
    const r = kiln.defs.apply(tree, { author: "t" });
    expect(r.ok ? [] : r.errors.join()).toMatch(/Engineering is not a known linear team; connect linear first/);
    kiln.connections.setDirectory("linear", { teams: { Engineering: "team_eng" } });
    expect(kiln.defs.apply(tree, { author: "t" }).ok).toBe(true);
    const { matched } = await kiln.automations.handle(ev("linear", "issue_created", { team_ids: ["team_eng"], issueId: "i9", title: "New" }, "l1"));
    expect(matched.map((m) => m.automation)).toContain("linear-eng");
  });

  it("needs a mention for thread replies when auto-respond is off", async () => {
    const tree = sampleTree();
    tree["factory.yaml"] = tree["factory.yaml"]!.replace("integrations: [github, slack, linear]", "integrations:\n  - type: slack\n    slack: { autoRespondToThreadReplies: false }");
    const { kiln } = createTestKiln({ tree });
    const { started } = await kiln.automations.handle(ev("slack", "app_mention", { channel: "C1", thread: "9.0", text: "@webapp build it", mentioned: ["webapp"] }, "s1"));
    expect(started).toHaveLength(1);
    const reply = await kiln.automations.handle(ev("slack", "message_posted", { channel: "C1", thread: "9.0", text: "also add tests", isThreadReply: true }, "s2"));
    expect(reply.continued).toEqual([]);
    const mention = await kiln.automations.handle(ev("slack", "app_mention", { channel: "C1", thread: "9.0", text: "also add tests" }, "s3"));
    expect(mention.continued).toEqual([started[0]!.id]);
  });

  it("fires @every schedules and exposes schedule ids", async () => {
    const clock = new FakeClock(new Date("2026-10-20T09:00:00Z"));
    const tree = sampleTree({ "automations/poll/automation.md": "---\ntriggers:\n  - provider: schedule\n    event: cron_fired\n    schedule: { cron: \"@every 5m\", name: poll }\n---\nPoll.\n" });
    const { kiln } = createTestKiln({ tree, clock });
    await kiln.automations.tick();
    clock.advance(4 * 60_000);
    await kiln.automations.tick();
    expect(kiln.workflow.list()).toHaveLength(0);
    clock.advance(60_000);
    await kiln.automations.tick();
    await kiln.automations.tick();
    expect(kiln.workflow.list().filter((w) => w.source.automation === "poll")).toHaveLength(1);
  });

  it("passes cloud federation settings to runs as env", () => {
    expect(cloudProviderEnv({ cloudProviders: { aws: { roleArn: "arn:aws:iam::123456789012:role/kiln" }, gcp: { projectNumber: "42", workloadIdentityFederationPoolId: "pool", workloadIdentityFederationProviderId: "prov" } } })).toMatchObject({
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/kiln",
      GCP_PROJECT_NUMBER: "42",
      GCP_WORKLOAD_IDENTITY_PROVIDER: "projects/42/locations/global/workloadIdentityPools/pool/providers/prov",
    });
    expect(cloudProviderEnv({ providers: { aws: { roleArn: "arn:aws:iam::123456789012:role/legacy" } } }).AWS_ROLE_ARN).toMatch(/legacy/);
  });
});

describe("managed webhooks", () => {
  const tree = sampleTree({ "automations/alerts/automation.md": "---\ntriggers:\n  - provider: webhook\n    event: received\n    filter:\n      webhook_ids: [alerts]\n      payload: { data: { level: [fatal] } }\n---\nTriage the alert.\n" });

  it("creates, accepts, dedupes and logs deliveries with the payload attached as untrusted", async () => {
    const { kiln } = createTestKiln({ tree });
    const { webhook, secret, url } = kiln.webhookSources.create("webapp", { name: "alerts" }, "admin@acme.test");
    expect(secret).toMatch(/^whsec_/);
    expect(url).toMatch(/\/webhooks\/w\/wh_[0-9a-f]+$/);
    const body = JSON.stringify({ title: "DB down", data: { level: "fatal" } });
    const post = (b: string, h: Record<string, string> = {}) => kiln.webhookSources.ingest(webhook.id, { method: "POST", body: b, header: headers({ authorization: `Bearer ${secret}`, ...h }) });
    const first = await post(body, { "x-kiln-delivery-id": "d-1" });
    expect(first).toMatchObject({ status: 202, body: { delivery_id: "d-1" } });
    expect((first.body.started as string[]).length).toBe(1);
    const wi = kiln.workflow.get((first.body.started as string[])[0]!)!;
    expect(wi.attachments.map((a) => a.name)).toEqual(["event-payload.json"]);
    expect(wi.body).toMatch(/untrusted data/);
    expect(wi.body).not.toContain("DB down\",");
    expect((await post(body, { "x-kiln-delivery-id": "d-1" })).body).toMatchObject({ duplicate: true });
    expect((await post(JSON.stringify({ data: { level: "info" } }))).body.started).toEqual([]);
    expect((await kiln.webhookSources.ingest(webhook.id, { method: "POST", body, header: headers({ authorization: "Bearer nope" }) })).status).toBe(401);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ big: "x".repeat(300 * 1024) }))).status).toBe(413);
    expect((await kiln.webhookSources.ingest(webhook.id, { method: "GET", body: "", header: headers({}) })).status).toBe(405);
    const statuses = kiln.webhookSources.deliveries(webhook.id).map((d) => d.status);
    expect(statuses).toEqual(expect.arrayContaining(["accepted", "duplicate", "rejected_auth", "rejected_invalid_json", "rejected_too_large"]));
    expect(kiln.webhookSources.deliveries(webhook.id).find((d) => d.status === "rejected_auth")!.payload).toBeUndefined();
    kiln.webhookSources.update(webhook.id, { enabled: false }, "admin");
    expect((await post(body)).status).toBe(404);
  });

  it("rate-limits above 60 deliveries a minute", async () => {
    const clock = new FakeClock();
    const { kiln } = createTestKiln({ clock });
    const { webhook, secret } = kiln.webhookSources.create("webapp", { name: "busy" }, "admin");
    let last;
    for (let i = 0; i < 61; i++) last = await kiln.webhookSources.ingest(webhook.id, { method: "POST", body: JSON.stringify({ i }), header: headers({ authorization: `Bearer ${secret}` }) });
    expect(last).toMatchObject({ status: 429, headers: { "retry-after": expect.any(String) } });
    clock.advance(61_000);
    expect((await kiln.webhookSources.ingest(webhook.id, { method: "POST", body: "{}", header: headers({ authorization: `Bearer ${secret}` }) })).status).toBe(202);
  });

  it("supports url tokens, create-and-finish for provider secrets, rotation, deletion and the 20 limit", async () => {
    const { kiln } = createTestKiln();
    const u = kiln.webhookSources.create("webapp", { name: "linky", authMode: "url_token" }, "admin");
    expect(u.url.endsWith(`/${u.secret}`)).toBe(true);
    expect((await kiln.webhookSources.ingest(u.webhook.id, { method: "POST", body: "{}", header: headers({}), pathToken: u.secret })).status).toBe(202);
    const v = kiln.webhookSources.create("webapp", { name: "vercel", authMode: "signature", signatureScheme: "vercel" }, "admin");
    expect(v.webhook).toMatchObject({ enabled: false, awaitingSecret: true });
    expect(v.secret).toBeUndefined();
    expect(() => kiln.webhookSources.update(v.webhook.id, { enabled: true }, "admin")).toThrow(/finish setup/);
    kiln.webhookSources.finish(v.webhook.id, "vercel-secret", "admin");
    const body = '{"type":"deployment.error"}';
    const sig = createHmac("sha1", "vercel-secret").update(body).digest("hex");
    expect((await kiln.webhookSources.ingest(v.webhook.id, { method: "POST", body, header: headers({ "x-vercel-signature": sig }) })).status).toBe(202);
    const sw = kiln.webhookSources.create("webapp", { name: "svix", authMode: "signature", signatureScheme: "standard_webhooks" }, "admin");
    expect(sw.secret).toMatch(/^whsec_/);
    const rotated = kiln.webhookSources.rotate(u.webhook.id, "admin");
    expect(rotated.secret).not.toBe(u.secret);
    expect((await kiln.webhookSources.ingest(u.webhook.id, { method: "POST", body: "{}", header: headers({}), pathToken: u.secret })).status).toBe(401);
    kiln.webhookSources.delete(u.webhook.id, "admin");
    expect((await kiln.webhookSources.ingest(u.webhook.id, { method: "POST", body: "{}", header: headers({}), pathToken: rotated.secret })).status).toBe(404);
    for (let i = kiln.webhookSources.list("webapp").length; i < 20; i++) kiln.webhookSources.create("webapp", { name: `w${i}` }, "admin");
    expect(() => kiln.webhookSources.create("webapp", { name: "one-too-many" }, "admin")).toThrow(/at most 20/);
  });

  it("tests an automation's filter against a stored delivery", async () => {
    const { kiln } = createTestKiln({ tree });
    const { webhook, secret } = kiln.webhookSources.create("webapp", { name: "alerts" }, "admin");
    await kiln.webhookSources.ingest(webhook.id, { method: "POST", body: JSON.stringify({ data: { level: "warning" } }), header: headers({ authorization: `Bearer ${secret}` }) });
    const delivery = kiln.webhookSources.deliveries(webhook.id)[0]!;
    const r = kiln.automations.testFilter("webapp", "alerts", delivery.id);
    expect(r.wouldTrigger).toBe(false);
    expect(r.triggers[0]!.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: "webhook_ids", ok: true }), expect.objectContaining({ check: "payload", ok: false })]));
  });
});

describe("connections", () => {
  it("starts, completes, tests and disconnects with the state check", async () => {
    const { kiln } = createTestKiln({ connectionProviders: { linear: new FakeConnectionProvider("linear", "Linear") } });
    const urls = { redirectUri: "https://kiln.test/oauth/linear/callback", webhookUrl: "https://kiln.test/webhooks/linear" };
    const s = kiln.connections.start("linear", "admin@acme.test", urls);
    expect(s.url).toContain(`state=${s.state}`);
    await expect(kiln.connections.complete("linear", { code: "ok", state: "forged", by: "x", ...urls })).rejects.toThrow(/expired/);
    const c = await kiln.connections.complete("linear", { code: "ok", state: s.state, by: "ignored", ...urls });
    expect(c).toMatchObject({ status: "connected", connectedBy: "admin@acme.test", account: { name: "Linear workspace" } });
    expect(kiln.connections.credentials("linear")).toEqual({ token: "tok_linear" });
    expect((await kiln.connections.test("linear")).ok).toBe(true);
    expect(kiln.connections.disconnect("linear", "admin")).toBe(true);
    expect(kiln.connections.credentials("linear")).toEqual({});
  });

  it("sends 7-day approval links that can be resent, revoked and used once", async () => {
    const clock = new FakeClock();
    const { kiln } = createTestKiln({ clock, connectionProviders: { jira: new FakeConnectionProvider("jira", "Jira") } });
    const link = kiln.connections.createApprovalLink("jira", "editor@acme.test", "siteadmin@acme.test");
    expect(kiln.connections.get("jira")!.status).toBe("pending_approval");
    expect(Date.parse(link.expiresAt) - clock.now().getTime()).toBe(7 * 86_400_000);
    const urls = { redirectUri: "r", webhookUrl: "w" };
    clock.advance(6 * 86_400_000);
    const resent = kiln.connections.resendApprovalLink(link.id, "editor@acme.test");
    expect(resent.token).not.toBe(link.token);
    expect(() => kiln.connections.openApprovalLink(link.token, urls)).toThrow(/revoked or already used/);
    clock.advance(2 * 86_400_000);
    const started = kiln.connections.openApprovalLink(resent.token, urls);
    await kiln.connections.complete("jira", { code: "ok", state: started.state, by: "anonymous", ...urls });
    expect(kiln.connections.get("jira")).toMatchObject({ status: "connected", connectedBy: "editor@acme.test" });
    expect(kiln.connections.approvalLinks("jira")[0]!.state).toBe("used");
    const other = kiln.connections.createApprovalLink("jira", "editor@acme.test");
    kiln.connections.revokeApprovalLink(other.id, "editor@acme.test");
    clock.advance(8 * 86_400_000);
    const expired = kiln.connections.createApprovalLink("jira", "editor@acme.test");
    clock.advance(8 * 86_400_000);
    expect(() => kiln.connections.openApprovalLink(expired.token, urls)).toThrow(/expired/);
  });

  it("links chat identities through a sign-in token", () => {
    const { kiln } = createTestKiln();
    const { token, url } = kiln.identities.startLink("teams", "aad-1", { tenant: "t1" });
    expect(url).toContain(token);
    kiln.identities.claim(token, "ann@acme.test");
    expect(kiln.automations.person("teams", "aad-1")).toBe("ann@acme.test");
    kiln.identities.link("teams", "aad-2", "ann@acme.test", { tenant: "t1" });
    expect(kiln.identities.unlink("teams", "aad-1", { tenant: "t1" })).toBe(2);
    expect(() => kiln.identities.claim(token, "x")).toThrow(/expired/);
  });
});

describe("integration hub", () => {
  it("creates the routing label and routes unlabeled mentions to the only factory", async () => {
    const { kiln, forge } = createTestKiln();
    await new Promise((r) => setTimeout(r, 10));
    expect([...(forge.labels.get("acme/web") ?? [])]).toContain("factory:webapp");
    const issue = await forge.createIssue({ owner: "acme", name: "web" }, { title: "Bug", body: "" });
    const events = normalizeGitHubEvents("issue_comment", { action: "created", repository: { full_name: "acme/web" }, sender: { login: "alice" }, issue: { number: issue.number, title: "Bug" }, comment: { body: "@kiln-factory fix it" } }, "m1");
    const routed = await kiln.integrations.routeGitHubMentions(events);
    expect(routed[1]!.data.routeTo).toEqual(["webapp"]);
    expect((await forge.getIssue({ owner: "acme", name: "web" }, issue.number))!.labels).toContain("factory:webapp");
  });

  it("checks definition pull requests in config repos", async () => {
    const { kiln, forge } = createTestKiln();
    const repo = { owner: "acme", name: "kiln-config" };
    forge.createRepo(repo, sampleTree({}, "Cfg", "cfg", "acme/web"));
    expect((await kiln.defs.connectRepo(repo, "admin")).ok).toBe(true);
    const sha = forge.branchSha(repo, "main")!;
    const unchanged = await kiln.integrations.checkDefinitionPullRequest({ provider: "github", event: "pull_request_opened", data: { repo: "acme/kiln-config", base: "main", sha } });
    expect(unchanged).toEqual({ factory: "cfg", conclusion: "success" });
    expect(forge.checkRuns[0]).toMatchObject({ name: "kiln/factory-config", conclusion: "success", summary: "No definition changes." });
    expect(await kiln.integrations.checkDefinitionPullRequest({ provider: "github", event: "pull_request_opened", data: { repo: "acme/kiln-config", base: "develop", sha } })).toBeUndefined();
  });

  it("acknowledges, lists notification routes and builds the Home tab", async () => {
    const { kiln, chat } = createTestKiln();
    const { started } = await kiln.automations.handle(ev("slack", "app_mention", { channel: "C1", thread: "5.0", ts: "5.0", text: "@webapp fix", user_ids: ["U1"], author: "U1" }, "h1"));
    await kiln.integrations.acknowledge(ev("slack", "app_mention", { channel: "C1", ts: "5.0" }));
    expect(chat.reactions).toEqual([{ channel: "C1", ts: "5.0", emoji: "eyes" }]);
    expect(kiln.integrations.homeItems("slack", "U1").map((i) => i.title)).toEqual([started[0]!.title]);
    kiln.identities.link("slack", "U1", "ann@acme.test");
    const routes = kiln.integrations.notificationRoutes({ subject: "ann@acme.test", workItemId: started[0]!.id });
    expect(routes.find((r) => r.kind === "slack_dm")).toMatchObject({ available: true, target: "U1" });
    expect(routes.find((r) => r.kind === "slack_thread")).toMatchObject({ available: true, target: "5.0" });
    expect(routes.find((r) => r.kind === "teams_thread")!.available).toBe(false);
  });

  it("reports Linear session progress", async () => {
    const linear = new FakeLinearAgentApi();
    const { kiln } = createTestKiln({ adapters: { linearAgent: linear } });
    const { started } = await kiln.automations.handle(ev("linear", "agent_session_created", { issueId: "i1", title: "Do it", sessionId: "as1", team_ids: ["t1"] }, "ls1"));
    await kiln.notify(started[0]!, "On it");
    expect(linear.activities).toContainEqual({ sessionId: "as1", activity: { type: "response", body: "On it" } });
    await kiln.integrations.onPullRequestOpened({ workItemId: started[0]!.id, repo: "acme/web", number: 4, url: "https://forge.test/acme/web/pull/4" });
    expect(linear.links).toEqual([{ issueId: "i1", url: "https://forge.test/acme/web/pull/4", title: "PR #4" }]);
  });
});

describe("automation templates", () => {
  it("every template is a valid automation once placeholders are filled", () => {
    const { kiln } = createTestKiln();
    kiln.connections.setDirectory("linear", { teams: { Engineering: "team_eng" } });
    const files = Object.assign({}, ...renderTemplates({ alias: "webapp", linearTeams: ["Engineering"], jiraProjects: ["ENG"] }).map((t) => t.files));
    const tree = sampleTree(files);
    // Linear and Jira are exclusive per factory: check the Jira template in its own tree.
    const jira = Object.keys(files).filter((f) => f.includes("jira"));
    for (const f of jira) delete tree[f];
    const r = kiln.defs.apply(tree, { author: "t", dryRun: true });
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(AUTOMATION_TEMPLATES.filter((t) => t.category === "suggested")).toHaveLength(9);
    expect(renderTemplates({ alias: "webapp" }).find((t) => t.id === "github-issue-labeled")!.files["automations/github-issue-labeled/automation.md"]).toContain("factory:webapp");
  });
});
