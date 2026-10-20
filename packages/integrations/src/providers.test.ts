import { createHmac, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AzureDevOpsForge, normalizeAzureDevOps, verifyAzureDevOps } from "./azure-devops";
import { BitbucketForge, normalizeBitbucket, verifyBitbucket } from "./bitbucket";
import { connectionProviders, FakeConnectionProvider } from "./connections";
import { DiscordChat, InteractionType, normalizeDiscordGateway, normalizeDiscordInteraction, registerDiscordCommands, verifyDiscord } from "./discord";
import { mentionsIn } from "./events";
import { githubAppJwt, HttpGitHubAppAuth, normalizeGitHubEvents } from "./github";
import { GitLabForge, normalizeGitLab, verifyGitLab } from "./gitlab";
import { HttpJiraCloudApi, normalizeJiraEvents } from "./jira";
import { HttpLinearAgentApi, normalizeLinearEvents } from "./linear";
import { normalizeSlackEvents, slackHomeView } from "./slack";
import { SlackChat } from "./chat";
import { JwtBotFrameworkVerifier, normalizeTeams, teamsAppPackage } from "./teams";
import { verifyPagerDuty, verifySignature, verifyStandardWebhook, verifyVercel } from "./webhooks";
import { unzipStored } from "./zip";

type Seen = { method: string; url: string; body?: any; headers: Record<string, string> };

/** Routes "METHOD substring" → response body (or a function of the request). */
function fakeFetch(routes: Record<string, unknown>, seen: Seen[] = []) {
  return (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const raw = init.body ? String(init.body) : undefined;
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* form bodies stay strings */
    }
    seen.push({ method, url, body, headers: (init.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find((k) => {
      const [m, ...rest] = k.split(" ");
      return m === method && url.includes(rest.join(" "));
    });
    if (!key) return new Response("not found", { status: 404 });
    const value = routes[key];
    const out = typeof value === "function" ? (value as (b: unknown) => unknown)(body) : value;
    return new Response(typeof out === "string" ? out : JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
}

const now = Date.parse("2026-10-20T09:00:00Z");

describe("custom webhook signature schemes", () => {
  const body = '{"event":{"event_type":"incident.triggered"}}';
  it("verifies PagerDuty v1 signatures, including rotated lists", () => {
    const sig = `v1=${createHmac("sha256", "pd-secret").update(body).digest("hex")}`;
    expect(verifyPagerDuty("pd-secret", body, `v1=00,${sig}`)).toBe(true);
    expect(verifyPagerDuty("pd-secret", body, "v1=00")).toBe(false);
  });
  it("verifies Vercel HMAC-SHA1", () => {
    const sig = createHmac("sha1", "v-secret").update(body).digest("hex");
    expect(verifyVercel("v-secret", body, sig)).toBe(true);
    expect(verifySignature("vercel", "v-secret", body, (h) => (h === "x-vercel-signature" ? sig : undefined))).toBe(true);
  });
  it("rejects Standard Webhooks older than five minutes and accepts svix headers", () => {
    const secret = `whsec_${Buffer.from("k3y").toString("base64")}`;
    const ts = String(now / 1000);
    const sig = `v1,${createHmac("sha256", Buffer.from("k3y")).update(`msg_1.${ts}.${body}`).digest("base64")}`;
    expect(verifyStandardWebhook(secret, "msg_1", ts, body, sig, now)).toBe(true);
    expect(verifyStandardWebhook(secret, "msg_1", ts, body, sig, now + 301_000)).toBe(false);
    const headers: Record<string, string> = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig };
    expect(verifySignature("standard_webhooks", secret, body, (h) => headers[h], now)).toBe(true);
  });
});

describe("github", () => {
  it("emits commented and mentioned for one comment, ignoring mentions in code", () => {
    const evs = normalizeGitHubEvents("issue_comment", { action: "created", repository: { full_name: "acme/web" }, sender: { login: "alice", type: "User" }, issue: { number: 3, title: "Bug", labels: [{ name: "factory:web" }] }, comment: { body: "@kiln-factory please fix\n```\n@ignored\n```" } }, "d1");
    expect(evs.map((e) => e.event)).toEqual(["issue_commented", "issue_mentioned"]);
    expect(evs[1]!.data).toMatchObject({ mentioned: ["kiln-factory"], labels: ["factory:web"], authorIsBot: false });
    expect(normalizeGitHubEvents("issue_comment", { action: "edited", issue: {}, comment: {} })).toEqual([]);
  });
  it("flags Kiln's own bot and covers workflow runs, pushes and review requests", () => {
    const [self] = normalizeGitHubEvents("issues", { action: "labeled", label: { name: "x" }, sender: { login: "kiln-factory[bot]", type: "Bot" }, issue: { number: 1 } });
    expect(self!.data).toMatchObject({ authorIsSelf: true, authorIsBot: true });
    const [wr] = normalizeGitHubEvents("workflow_run", { action: "completed", repository: { full_name: "acme/web" }, workflow_run: { name: "CI", conclusion: "failure", head_branch: "main", actor: { login: "bob" }, pull_requests: [{ number: 9 }] } });
    expect(wr).toMatchObject({ event: "workflow_run_completed", data: { workflow: "CI", conclusion: "failure", branch: "main", author: "bob", number: 9 } });
    const [push] = normalizeGitHubEvents("push", { ref: "refs/heads/main", repository: { full_name: "acme/web" }, commits: [{ added: ["api/a.ts"], modified: ["README.md"] }] });
    expect(push!.data).toMatchObject({ branch: "main", paths: ["api/a.ts", "README.md"] });
    const [rr] = normalizeGitHubEvents("pull_request", { action: "review_requested", repository: { full_name: "acme/web" }, pull_request: { number: 2, base: { ref: "main" }, head: { ref: "f" } }, requested_team: { slug: "core" } });
    expect(rr).toMatchObject({ event: "pull_request_review_requested", data: { reviewer_teams: ["core"], base: "main" } });
  });
  it("signs an app JWT and caches installation tokens", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const jwt = githubAppJwt("123", pem, now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ iss: "123", exp: now / 1000 - 60 + 600 });
    const { createVerify } = await import("node:crypto");
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    const seen: Seen[] = [];
    const auth = new HttpGitHubAppAuth({ appId: "123", privateKey: pem, installationId: "77", now: () => now, fetch: fakeFetch({ "POST /app/installations/77/access_tokens": { token: "ghs_1", expires_at: new Date(now + 3600_000).toISOString() } }, seen) });
    expect(await auth.installationToken()).toBe("ghs_1");
    expect(await auth.installationToken()).toBe("ghs_1");
    expect(seen).toHaveLength(1);
  });

  it("picks the installation of each owner and mints repo-scoped tokens for sandboxes", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const seen: Seen[] = [];
    const exp = new Date(now + 3600_000).toISOString();
    const auth = new HttpGitHubAppAuth({
      appId: "123",
      privateKey: pem,
      installationId: "77",
      now: () => now,
      fetch: fakeFetch(
        {
          "GET /app/installations": [
            { id: 77, account: { login: "fishuke" } },
            { id: 88, account: { login: "inofy" } },
          ],
          "POST /app/installations/88/access_tokens": { token: "ghs_inofy", expires_at: exp },
          "POST /app/installations/77/access_tokens": { token: "ghs_fishuke", expires_at: exp },
        },
        seen,
      ),
    });
    expect(await auth.tokenForOwner("inofy")).toBe("ghs_inofy");
    expect(await auth.tokenForOwner("Inofy")).toBe("ghs_inofy");
    expect(seen.filter((x) => x.url.endsWith("/app/installations?per_page=100"))).toHaveLength(1);
    // Unknown owners fall back to the configured installation.
    expect(await auth.tokenForOwner("someone-else")).toBe("ghs_fishuke");
    await auth.repoToken("inofy", "poe-bot");
    const scoped = seen.filter((x) => x.method === "POST" && x.url.endsWith("/app/installations/88/access_tokens")).at(-1)!;
    expect(scoped.body).toEqual({ repositories: ["poe-bot"], permissions: { contents: "write", metadata: "read" } });
  });
});

describe("gitlab", () => {
  it("verifies the token and normalizes notes, merge requests and pushes", () => {
    expect(verifyGitLab("tok", "tok")).toBe(true);
    expect(verifyGitLab("tok", "nope")).toBe(false);
    const note = normalizeGitLab("Note Hook", { object_kind: "note", project: { path_with_namespace: "acme/api" }, user: { username: "alice" }, object_attributes: { note: "@web-kiln-ab12 fix the flaky test", discussion_id: "d1", noteable_type: "MergeRequest" }, merge_request: { iid: 4, title: "MR", target_branch: "main" } }, "g1", { botUsernames: ["web-kiln-ab12"] });
    expect(note).toMatchObject({ event: "bot_mentioned", data: { repos: ["acme/api"], number: 4, mentioned: ["web-kiln-ab12"], discussionId: "d1" } });
    expect(normalizeGitLab("Note Hook", { object_kind: "note", user: { username: "web-kiln-ab12" }, object_attributes: { note: "@web-kiln-ab12 hi" } }, "g2", { botUsernames: ["web-kiln-ab12"] })).toBeUndefined();
    expect(normalizeGitLab("Merge Request Hook", { object_kind: "merge_request", project: { path_with_namespace: "acme/api" }, object_attributes: { iid: 5, action: "open", target_branch: "main", source_branch: "f" } })).toMatchObject({ event: "merge_request", data: { action: "open", base: "main" } });
    expect(normalizeGitLab("Push Hook", { object_kind: "push", ref: "refs/heads/main", project: { path_with_namespace: "acme/api" } })).toMatchObject({ event: "push", data: { branch: "main" } });
  });
  it("opens draft merge requests and reads files through the forge interface", async () => {
    const seen: Seen[] = [];
    const forge = new GitLabForge({
      token: "glpat",
      baseUrl: "https://git.acme.test",
      fetch: fakeFetch(
        {
          "POST /merge_requests": (b: any) => ({ iid: 7, web_url: "https://git.acme.test/acme/api/-/merge_requests/7", title: b.title, description: b.description, source_branch: b.source_branch, target_branch: b.target_branch, state: "opened", labels: b.labels.split(","), author: { username: "bot" } }),
          "GET /repository/tree": [{ path: "factory.yaml", type: "blob" }],
          "GET /repository/files/factory.yaml/raw": "name: x\n",
        },
        seen,
      ),
    });
    const mr = await forge.openPullRequest({ repo: { owner: "acme", name: "api" }, head: "kiln/x", title: "Fix", body: "b", labels: ["factory:web"], draft: true });
    expect(mr).toMatchObject({ number: 7, title: "Fix", head: "kiln/x", state: "open", labels: ["factory:web"] });
    expect(seen[0]!.url).toContain("/api/v4/projects/acme%2Fapi/merge_requests");
    expect(seen[0]!.body.title).toBe("Draft: Fix");
    expect(seen[0]!.headers["private-token"]).toBe("glpat");
    expect(await forge.readTree({ owner: "acme", name: "api" })).toEqual({ "factory.yaml": "name: x\n" });
    expect(forge.cloneUrl({ owner: "acme", name: "api" }, "t")).toBe("https://oauth2:t@git.acme.test/acme/api.git");
  });
});

describe("azure devops", () => {
  it("checks basic auth and normalizes PRs, comments and work items", () => {
    const auth = `Basic ${Buffer.from("kiln:hook-pass").toString("base64")}`;
    expect(verifyAzureDevOps({ password: "hook-pass" }, auth)).toBe(true);
    expect(verifyAzureDevOps({ password: "other" }, auth)).toBe(false);
    const pr = { pullRequestId: 12, title: "T", repository: { name: "api", project: { name: "Shop" } }, targetRefName: "refs/heads/main", sourceRefName: "refs/heads/f", createdBy: { uniqueName: "a@acme.test" } };
    expect(normalizeAzureDevOps({ eventType: "git.pullrequest.created", id: "e1", resource: pr })[0]).toMatchObject({ event: "pull_request_created", data: { repos: ["Shop/api"], base: "main", number: 12 } });
    const comment = normalizeAzureDevOps({ eventType: "ms.vss-code.git-pullrequest-comment-event", resource: { pullRequest: pr, comment: { content: "@<6b1f1b8e-0000-0000-0000-000000000001> please review", author: { uniqueName: "b@acme.test" } } } }, "e2", { identities: ["6b1f1b8e-0000-0000-0000-000000000001"] });
    expect(comment.map((e) => e.event)).toEqual(["pull_request_commented", "pull_request_mentioned"]);
    const wi = normalizeAzureDevOps({ eventType: "workitem.updated", resource: { workItemId: 5, fields: { "System.AssignedTo": { newValue: "Kiln Factory <kiln@acme.test>" } }, revision: { fields: { "System.Title": "Bug", "System.WorkItemType": "Bug", "System.Tags": "ui; urgent", "System.AssignedTo": "Kiln Factory <kiln@acme.test>" } } } }, "e3");
    expect(wi[0]).toMatchObject({ event: "work_item_assigned", data: { work_item_type: "Bug", labels: ["ui", "urgent"], assignees: ["Kiln Factory"] } });
  });
  it("opens pull requests with labels", async () => {
    const seen: Seen[] = [];
    const forge = new AzureDevOpsForge({ organization: "acme", token: "pat", fetch: fakeFetch({ "POST /pullrequests": (b: any) => ({ pullRequestId: 3, title: b.title, sourceRefName: b.sourceRefName, targetRefName: b.targetRefName, status: "active", labels: b.labels, createdBy: { uniqueName: "kiln" } }) }, seen) });
    const pr = await forge.openPullRequest({ repo: { owner: "Shop", name: "api" }, head: "kiln/x", title: "T", body: "B", labels: ["factory:web"] });
    expect(pr).toMatchObject({ number: 3, head: "kiln/x", base: "main", labels: ["factory:web"], state: "open" });
    expect(seen[0]!.url).toBe("https://dev.azure.com/acme/Shop/_apis/git/repositories/api/pullrequests?api-version=7.1");
    expect(seen[0]!.headers.authorization).toBe(`Basic ${Buffer.from(":pat").toString("base64")}`);
  });
});

describe("bitbucket", () => {
  it("verifies, normalizes and opens pull requests", async () => {
    const body = '{"x":1}';
    expect(verifyBitbucket("s", body, `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`)).toBe(true);
    expect(normalizeBitbucket("pullrequest:comment_created", { repository: { full_name: "acme/app" }, actor: { nickname: "al" }, pullrequest: { id: 2 }, comment: { content: { raw: "@kiln go" } } })).toMatchObject({ event: "pull_request_commented", data: { mentioned: ["kiln"], number: 2 } });
    const forge = new BitbucketForge({ token: "t", fetch: fakeFetch({ "POST /pullrequests": (b: any) => ({ id: 9, title: b.title, source: b.source, destination: b.destination, state: "OPEN", links: { html: { href: "u" } } }) }) });
    expect(await forge.openPullRequest({ repo: { owner: "acme", name: "app" }, head: "kiln/y", title: "Y", body: "" })).toMatchObject({ number: 9, head: "kiln/y", base: "main" });
  });
});

describe("slack", () => {
  const cb = (event: Record<string, unknown>) => ({ type: "event_callback", event_id: "Ev1", team_id: "T1", authorizations: [{ user_id: "UBOT" }], event });
  it("normalizes every Slack trigger", () => {
    expect(normalizeSlackEvents(cb({ type: "message", channel_type: "im", channel: "D1", user: "U1", text: "hi", ts: "1" })).map((e) => e.event)).toEqual(["message_dm", "message_im"]);
    expect(normalizeSlackEvents(cb({ type: "message", channel_type: "mpim", channel: "G1", user: "U1", text: "hi", ts: "1" }))[0]!.event).toBe("message_mpim");
    const reply = normalizeSlackEvents(cb({ type: "message", channel_type: "channel", channel: "C1", user: "U1", text: "ok", ts: "2", thread_ts: "1" }))[0]!;
    expect(reply).toMatchObject({ event: "message_posted", data: { isThreadReply: true, thread: "1", channel_ids: ["C1"] } });
    expect(normalizeSlackEvents(cb({ type: "message", channel: "C1", user: "U1", text: "<@UBOT> do it", ts: "3", thread_ts: "1" }))[0]!.data.isThreadReply).toBe(false);
    expect(normalizeSlackEvents(cb({ type: "member_joined_channel", channel: "C1", user: "U2" }))[0]!.event).toBe("member_joined_channel");
    expect(normalizeSlackEvents(cb({ type: "reaction_added", user: "U1", reaction: "ticket", item_user: "U3", item: { channel: "C1", ts: "5" } }))[0]!.data).toMatchObject({ emoji: "ticket", item_user_ids: ["U3"], channel_ids: ["C1"] });
    expect(normalizeSlackEvents(cb({ type: "message", channel: "C1", bot_id: "B1", text: "x", ts: "6" }))).toEqual([]);
  });
  it("reacts, publishes the Home tab and posts as the factory", async () => {
    const seen: Seen[] = [];
    const chat = new SlackChat({ botToken: "xoxb", fetch: fakeFetch({ "POST reactions.add": { ok: true }, "POST views.publish": { ok: true }, "POST chat.postMessage": { ok: true, ts: "9" } }, seen) });
    await chat.react({ channel: "C1", ts: "1", emoji: "eyes" });
    await chat.publishHome("U1", slackHomeView([{ title: "Fix login", stage: "Building", url: "https://k/w/1", updatedAt: "2026-10-20", factory: "web" }]));
    await chat.post({ channel: "C1", text: "hi", as: { name: "Web factory", iconUrl: "https://k/a.png" } });
    expect(seen.map((s) => s.url.split("/").pop())).toEqual(["reactions.add", "views.publish", "chat.postMessage"]);
    expect(seen[0]!.body).toEqual({ channel: "C1", timestamp: "1", name: "eyes" });
    expect(JSON.stringify(seen[1]!.body.view)).toContain("*Building* (1)");
    expect(seen[2]!.body).toMatchObject({ username: "Web factory", icon_url: "https://k/a.png" });
  });
});

describe("microsoft teams", () => {
  const activity = { type: "message", id: "m1", text: "<at>Kiln</at> fix the login page", serviceUrl: "https://smba.test/", recipient: { id: "28:bot" }, from: { id: "29:u", aadObjectId: "aad-1", name: "Ann" }, conversation: { id: "19:abc@thread.tacv2;messageid=100" }, channelData: { team: { id: "19:team@thread.tacv2", aadGroupId: "team-guid" }, channel: { id: "19:abc@thread.tacv2" }, tenant: { id: "t1" } }, entities: [{ type: "mention", mentioned: { id: "28:bot" } }] };
  it("normalizes mentions, plain messages and commands", () => {
    expect(normalizeTeams(activity)).toMatchObject({ event: "app_mention", data: { text: "fix the login page", channel: "19:abc@thread.tacv2", thread: "100", team_ids: ["team-guid"], channel_ids: ["19:abc@thread.tacv2"] } });
    expect(normalizeTeams({ ...activity, entities: [] })!.event).toBe("message_posted");
    expect(normalizeTeams({ ...activity, text: "<at>Kiln</at> sign in" })).toMatchObject({ event: "command", data: { command: "sign in" } });
  });
  it("validates Bot Framework JWTs against published keys", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
    const make = (claims: Record<string, unknown>) => {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
      const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
    };
    const verifier = new JwtBotFrameworkVerifier({ appId: "app-1", now: () => now, fetch: fakeFetch({ "GET openidconfiguration": { jwks_uri: "https://keys.test/jwks" }, "GET keys.test/jwks": { keys: [jwk] } }) });
    const good = { iss: "https://api.botframework.com", aud: "app-1", exp: now / 1000 + 600, serviceUrl: "https://smba.test/" };
    expect(await verifier.verify(`Bearer ${make(good)}`, activity)).toBe(true);
    expect(await verifier.verify(`Bearer ${make({ ...good, aud: "other" })}`, activity)).toBe(false);
    expect(await verifier.verify(`Bearer ${make({ ...good, exp: now / 1000 - 600 })}`, activity)).toBe(false);
    expect(await verifier.verify(`Bearer ${make({ ...good, serviceUrl: "https://evil.test/" })}`, activity)).toBe(false);
  });
  it("builds an app package with manifest and icons", () => {
    const files = unzipStored(teamsAppPackage({ botId: "app-1", name: "Kiln", developerName: "Acme", websiteUrl: "https://kiln.acme.test" }));
    expect(Object.keys(files)).toEqual(["manifest.json", "color.png", "outline.png"]);
    expect(JSON.parse(files["manifest.json"]!.toString())).toMatchObject({ id: "app-1", bots: [{ botId: "app-1", scopes: ["team"] }], icons: { color: "color.png", outline: "outline.png" } });
    expect(files["color.png"]!.subarray(1, 4).toString()).toBe("PNG");
    expect(files["color.png"]!.readUInt32BE(16)).toBe(192);
    expect(files["outline.png"]!.readUInt32BE(16)).toBe(32);
  });
});

describe("discord", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
  it("verifies Ed25519 interaction signatures", () => {
    const body = JSON.stringify({ type: 1 });
    const ts = String(now / 1000);
    const sig = cryptoSign(null, Buffer.from(ts + body), privateKey).toString("hex");
    expect(verifyDiscord(pubHex, sig, ts, body, now)).toBe(true);
    expect(verifyDiscord(pubHex, sig, ts, `${body} `, now)).toBe(false);
    expect(verifyDiscord(pubHex, sig, ts, body, now + 600_000)).toBe(false);
  });
  it("normalizes /kiln, components and gateway messages", () => {
    const slash = normalizeDiscordInteraction({ id: "i1", type: InteractionType.APPLICATION_COMMAND, token: "tok", guild_id: "g1", channel_id: "c1", member: { user: { id: "u1", username: "ann" } }, data: { name: "kiln", options: [{ name: "prompt", value: "Fix the flaky test" }, { name: "factory", value: "Web" }] } });
    expect(slash).toMatchObject({ event: "slash_command", data: { text: "Fix the flaky test", guild_ids: ["g1"], channel_ids: ["c1"], user_ids: ["u1"], mentioned: ["web"] } });
    expect(normalizeDiscordInteraction({ id: "i2", type: 3, data: { custom_id: "kiln:approve:gate_1" }, channel_id: "c1", user: { id: "u1" } })).toMatchObject({ event: "component", data: { action: "approve", targetId: "gate_1" } });
    expect(normalizeDiscordGateway({ t: "MESSAGE_CREATE", d: { id: "m1", channel_id: "c1", guild_id: "g1", author: { id: "u1" }, content: "<@999> help", mentions: [{ id: "999" }] } }, { botUserId: "999" })).toMatchObject({ event: "app_mention", data: { text: "help" } });
    expect(normalizeDiscordGateway({ t: "MESSAGE_REACTION_ADD", d: { message_id: "m1", channel_id: "c1", user_id: "u1", emoji: { name: "🐛" } } })).toMatchObject({ event: "reaction_added", data: { emoji: "🐛" } });
  });
  it("posts, reacts, starts threads and registers the command", async () => {
    const seen: Seen[] = [];
    const routes = { "POST /threads": { id: "t1" }, "POST /channels/c1/messages": { id: "m2" }, "PUT /reactions/": "", "PUT /applications/app/guilds/g1/commands": [{ id: "cmd", name: "kiln" }] };
    const chat = new DiscordChat({ botToken: "bt", fetch: fakeFetch(routes, seen) });
    expect((await chat.post({ channel: "c1", text: "hello" })).ts).toBe("m2");
    await chat.react({ channel: "c1", ts: "m2", emoji: "👀" });
    expect(await chat.startThread("c1", "m2", "Fix")).toBe("t1");
    expect(await registerDiscordCommands({ applicationId: "app", botToken: "bt", guildId: "g1", fetch: fakeFetch(routes, seen) })).toEqual([{ id: "cmd", name: "kiln" }]);
    expect(seen[0]!.headers.authorization).toBe("Bot bt");
    expect(seen[1]!.url).toContain(`/reactions/${encodeURIComponent("👀")}/@me`);
  });
});

describe("linear", () => {
  it("normalizes every Linear trigger", () => {
    const issue = { id: "i1", identifier: "ENG-1", number: 1, title: "Bug", description: "x", teamId: "t1", team: { name: "Engineering", key: "ENG" }, stateId: "s2", state: { name: "In Progress" }, labelIds: ["l1", "l2"], labels: [{ name: "bug" }], assigneeId: "u1" };
    expect(normalizeLinearEvents({ type: "Issue", action: "create", data: issue })[0]).toMatchObject({ event: "issue_created", data: { team_ids: ["t1"], team_names: ["Engineering", "ENG"], issue_ids: ["i1", "ENG-1"] } });
    const upd = normalizeLinearEvents({ type: "Issue", action: "update", data: issue, updatedFrom: { assigneeId: null, labelIds: ["l1"], stateId: "s1" } });
    expect(upd.map((e) => e.event)).toEqual(["issue_assigned", "issue_labeled", "issue_state_changed"]);
    expect(normalizeLinearEvents({ type: "Comment", action: "create", data: { id: "c1", body: "hi @kiln", issueId: "i1", userId: "u2", issue: { id: "i1", teamId: "t1" } } })[0]).toMatchObject({ event: "comment_created", data: { creator_ids: ["u2"], mentioned: ["kiln"] } });
    expect(normalizeLinearEvents({ type: "AgentSessionEvent", action: "created", agentSession: { id: "as1", issue } })[0]).toMatchObject({ event: "agent_session_created", data: { sessionId: "as1" } });
    expect(normalizeLinearEvents({ type: "Issue", action: "create", data: issue, actor: { id: "app-user" } }, "d", { appUserId: "app-user" })[0]!.data.authorIsSelf).toBe(true);
  });
  it("posts agent activities and attaches pull requests", async () => {
    const seen: Seen[] = [];
    const api = new HttpLinearAgentApi({ token: "oauth-token", fetch: fakeFetch({ "POST graphql": { data: { agentActivityCreate: { success: true } } } }, seen) });
    await api.activity("as1", { type: "thought", body: "Reading the issue" });
    await api.activity("as1", { type: "action", body: "", action: "Opened PR", parameter: "#12" });
    await api.attachLink("i1", "https://github.com/acme/web/pull/12", "PR #12");
    expect(seen[0]!.body.variables.input).toEqual({ agentSessionId: "as1", content: { type: "thought", body: "Reading the issue" } });
    expect(seen[1]!.body.variables.input.content).toEqual({ type: "action", action: "Opened PR", parameter: "#12" });
    expect(seen[2]!.body.query).toContain("attachmentLinkURL");
    expect(seen[0]!.headers.authorization).toBe("Bearer oauth-token");
  });
  it("posts a question with options as an elicitation with the select signal", async () => {
    const seen: Seen[] = [];
    const api = new HttpLinearAgentApi({ token: "oauth-token", fetch: fakeFetch({ "POST graphql": { data: { agentActivityCreate: { success: true } } } }, seen) });
    await api.activity("as1", { type: "elicitation", body: "Which color?", options: ["Blue", "Green"] });
    expect(seen[0]!.body.variables.input).toEqual({
      agentSessionId: "as1",
      content: { type: "elicitation", body: "Which color?" },
      signal: "select",
      signalMetadata: { options: [{ value: "Blue" }, { value: "Green" }] },
    });
  });
});

describe("jira", () => {
  it("turns assignment to the factory into an agent session and reads labels and status changes", () => {
    const issue = { key: "ENG-7", self: "https://acme.atlassian.net/rest/api/3/issue/1", fields: { summary: "S", project: { key: "ENG" }, labels: ["a", "b"], assignee: { accountId: "bot" } } };
    const evs = normalizeJiraEvents({ webhookEvent: "jira:issue_updated", issue, user: { accountId: "u1" }, changelog: { items: [{ field: "assignee", to: "bot" }, { field: "labels", fromString: "a", toString: "a b" }, { field: "status", from: "1", to: "3", toString: "Done" }] } }, "j1", { botAccountId: "bot" });
    expect(evs.map((e) => e.event)).toEqual(["agent_session_created", "issue_labeled", "status_changed"]);
    expect(evs[2]!.data).toMatchObject({ status_id: "3", project_keys: ["ENG"], url: "https://acme.atlassian.net/browse/ENG-7" });
    const mention = normalizeJiraEvents({ webhookEvent: "comment_created", issue, comment: { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "bot", text: "@Kiln" } }, { type: "text", text: " investigate" }] }] } } }, "j2", { botAccountId: "bot" });
    expect(mention[0]).toMatchObject({ event: "agent_session_created", data: { text: "@Kiln investigate" } });
  });
  it("transitions by status name", async () => {
    const seen: Seen[] = [];
    const api = new HttpJiraCloudApi({ cloudId: "c1", accessToken: "at", fetch: fakeFetch({ "GET /transitions": { transitions: [{ id: "31", name: "Finish", to: { name: "Done" } }] }, "POST /transitions": "" }, seen) });
    await api.transition("ENG-7", "done");
    expect(seen[1]!.body).toEqual({ transition: { id: "31" } });
    expect(seen[0]!.url).toBe("https://api.atlassian.com/ex/jira/c1/rest/api/3/issue/ENG-7/transitions");
  });
});

describe("connections", () => {
  it("connects GitLab with a manager token", async () => {
    const providers = connectionProviders({ fetch: fakeFetch({ "GET /api/v4/groups/acme": { id: 1, full_path: "acme", web_url: "https://gitlab.com/acme" }, "GET /api/v4/user": { username: "kiln-manager" } }) });
    const r = await providers.gitlab.complete({ params: { group: "acme", token: "glpat" }, redirectUri: "", webhookUrl: "https://kiln.test/webhooks/x" });
    expect(r).toMatchObject({ account: { name: "acme" }, installation: { baseUrl: "https://gitlab.com", group: "acme" }, secrets: { token: "glpat" } });
    expect(await providers.gitlab.test({ installation: r.installation, secrets: r.secrets })).toEqual({ ok: true, message: "authenticated as kiln-manager" });
    expect(providers.gitlab.start({ state: "s", redirectUri: "r", webhookUrl: "https://kiln.test/webhooks/x" }).steps.join()).toContain("https://kiln.test/webhooks/gitlab");
  });
  it("has a fake for engine tests", async () => {
    const p = new FakeConnectionProvider("linear");
    expect(p.start({ state: "abc", redirectUri: "https://k/cb" }).url).toContain("state=abc");
    await expect(p.complete({ code: "bad", redirectUri: "", webhookUrl: "" })).rejects.toThrow();
  });
  it("finds mentions outside code", () => {
    expect(mentionsIn("hey @Kiln-Factory and `@nope` @org/team")).toEqual(["kiln-factory", "org/team"]);
  });
});
