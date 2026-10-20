import { C, type Kiln, type WorkItem } from "@kiln/engine";
import {
  DiscordChat,
  githubExchangeCode,
  InteractionResponse,
  InteractionType,
  JwtBotFrameworkVerifier,
  normalizeAzureDevOps,
  normalizeBitbucket,
  normalizeDiscordGateway,
  normalizeDiscordInteraction,
  normalizeGitHubEvents,
  normalizeGitLab,
  normalizeJiraEvents,
  normalizeLinearEvents,
  normalizeSlackEvents,
  normalizeTeams,
  safeEqual,
  SlackChat,
  slackHomeView,
  TEAMS_NOT_CONNECTED,
  TeamsChat,
  teamsHelpText,
  verifyAzureDevOps,
  verifyBitbucket,
  verifyDiscord,
  verifyGitHub,
  verifyGitLab,
  verifyLinear,
  verifySlack,
  type BotFrameworkVerifier,
  type IncomingEvent,
} from "@kiln/integrations";
import type { Context } from "hono";
import { HttpError, type Env, type RouteContext } from "../app";
import { credential, csv, header, installation, serverSecret, summarize, urls } from "./util";

const json = async (c: Context<Env>) => {
  const body = await c.req.text();
  try {
    return { body, payload: JSON.parse(body) as Record<string, any> };
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
};

const isSignIn = (text: unknown) => String(text ?? "").replace(/<@[^>]+>/g, "").replace(/@\S+/g, "").trim().toLowerCase() === "sign in";

/** Events that start or continue work in chat get a 👀 acknowledgement. */
const ACK_EVENTS = ["app_mention", "message_dm", "message_im", "message_mpim", "message_posted"];

async function handleChat(kiln: Kiln, events: IncomingEvent[]) {
  const r = await kiln.automations.handle(events);
  if (r.started.length || r.continued.length) {
    const ack = events.find((e) => ACK_EVENTS.includes(e.event) && (r.started.length || e.event !== "message_posted" || !e.data.isThreadReply));
    if (ack) await kiln.integrations.acknowledge(ack);
  }
  return r;
}

/** The Teams verifier: an injected one (tests), else Bot Framework JWT validation for TEAMS_APP_ID. */
function teamsVerifier(kiln: Kiln): BotFrameworkVerifier | undefined {
  const injected = kiln.options.adapters?.teamsVerifier;
  if (injected) return injected;
  const appId = serverSecret(kiln, "TEAMS_APP_ID") ?? (installation(kiln, "microsoft-teams").appId as string | undefined);
  return appId ? new JwtBotFrameworkVerifier({ appId }) : undefined;
}

/** Point a work item's source at a chat thread created after it started (Discord threads are channels). */
function moveToThread(kiln: Kiln, wi: WorkItem, thread: string) {
  const fresh = kiln.workflow.get(wi.id);
  if (fresh) kiln.store.put(C.workItems, { ...fresh, source: { ...fresh.source, channel: thread, thread } });
}

export function registerWebhookRoutes({ app, kiln }: RouteContext) {
  // ---- GitHub ----
  app.post("/webhooks/github", async (c) => {
    const { body, payload } = await json(c);
    const ownApp = kiln.githubApp.credentials();
    const secret = serverSecret(kiln, "GITHUB_WEBHOOK_SECRET") ?? ownApp?.webhookSecret;
    if (secret && !verifyGitHub(secret, body, c.req.header("x-hub-signature-256"))) throw new HttpError(401, "bad signature");
    const slug = serverSecret(kiln, "GITHUB_APP_SLUG") ?? ownApp?.slug;
    const events = normalizeGitHubEvents(c.req.header("x-github-event") ?? "", payload, c.req.header("x-github-delivery"), slug ? { selfLogins: [`${slug}[bot]`, slug, "kiln-factory[bot]"] } : {});
    if (!events.length) return c.json({ ignored: true });
    // Definition PRs get the kiln/factory-config check; it never blocks the delivery.
    void kiln.integrations.checkDefinitionPullRequest(events[0]!).catch((err) => kiln.audit("kiln", "factory_config_check.failed", String(events[0]!.data.repo), { error: String(err) }));
    const routed = await kiln.integrations.routeGitHubMentions(events);
    return c.json(summarize(await kiln.automations.handle(routed)));
  });

  // ---- GitLab (group webhook, X-Gitlab-Token) ----
  app.post("/webhooks/gitlab", async (c) => {
    const { payload } = await json(c);
    const secret = credential(kiln, "gitlab", "webhookToken", "GITLAB_WEBHOOK_TOKEN");
    if (!secret || !verifyGitLab(secret, c.req.header("x-gitlab-token"))) throw new HttpError(401, "bad token");
    const ev = normalizeGitLab(c.req.header("x-gitlab-event") ?? "", payload, c.req.header("x-gitlab-event-uuid") ?? c.req.header("idempotency-key"), { botUsernames: csv(serverSecret(kiln, "GITLAB_BOT_USERNAMES")) });
    return c.json(ev ? summarize(await kiln.automations.handle(ev)) : { ignored: true });
  });

  // ---- Azure DevOps (service hooks with basic auth) ----
  app.post("/webhooks/azure-devops", async (c) => {
    const { payload } = await json(c);
    const password = credential(kiln, "azure_devops", "hookPassword", "AZURE_DEVOPS_WEBHOOK_PASSWORD");
    if (!password || !verifyAzureDevOps({ password, username: serverSecret(kiln, "AZURE_DEVOPS_WEBHOOK_USER") }, c.req.header("authorization"))) throw new HttpError(401, "bad credentials");
    const identities = [...csv(serverSecret(kiln, "AZURE_DEVOPS_IDENTITIES")), ...csv(installation(kiln, "azure_devops").identity as string | undefined)];
    const events = normalizeAzureDevOps(payload, payload.id, { identities });
    return c.json(events.length ? summarize(await kiln.automations.handle(events)) : { ignored: true });
  });

  // ---- Bitbucket Cloud ----
  app.post("/webhooks/bitbucket", async (c) => {
    const { body, payload } = await json(c);
    const secret = serverSecret(kiln, "BITBUCKET_WEBHOOK_SECRET");
    if (!secret || !verifyBitbucket(secret, body, c.req.header("x-hub-signature"))) throw new HttpError(401, "bad signature");
    const ev = normalizeBitbucket(c.req.header("x-event-key") ?? "", payload, c.req.header("x-request-uuid") ?? c.req.header("x-hook-uuid"), { selfAccounts: csv(serverSecret(kiln, "BITBUCKET_BOT_ACCOUNTS")) });
    return c.json(ev ? summarize(await kiln.automations.handle(ev)) : { ignored: true });
  });

  // ---- Slack (Events API) ----
  app.post("/webhooks/slack", async (c) => {
    const { body, payload } = await json(c);
    if (payload.type === "url_verification") return c.json({ challenge: payload.challenge });
    const secret = credential(kiln, "slack", "signingSecret", "SLACK_SIGNING_SECRET");
    if (secret && !verifySlack(secret, body, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"))) throw new HttpError(401, "bad signature");
    const events = normalizeSlackEvents(payload, { botUserId: installation(kiln, "slack").botUserId as string | undefined });
    const home = events.find((e) => e.event === "app_home_opened");
    const chat = kiln.integrations.chat("slack");
    if (home) {
      const user = String(home.data.author ?? "");
      if (chat instanceof SlackChat && user) void chat.publishHome(user, slackHomeView(kiln.integrations.homeItems("slack", user), { webUrl: kiln.link("/") })).catch(() => {});
      return c.json({ ok: true });
    }
    // `@app sign in` (or a DM saying it) links the Slack account instead of starting work.
    const signIn = events.find((e) => ["app_mention", "message_dm"].includes(e.event) && isSignIn(e.data.text));
    if (signIn) {
      const { url } = kiln.identities.startLink("slack", String(signIn.data.author ?? ""));
      void chat?.post({ channel: String(signIn.data.channel), thread: signIn.data.thread, text: `Open this link to connect your Slack account to Kiln (it expires in an hour): ${url}` }).catch(() => {});
      return c.json({ ok: true });
    }
    // Slack wants an answer within 3 s; work continues in the background.
    if (events.length) void handleChat(kiln, events).catch((err) => kiln.audit("kiln", "slack.failed", String(payload.event_id), { error: String(err) }));
    return c.json({ ok: true });
  });

  // ---- Microsoft Teams (Bot Framework activities) ----
  app.post("/webhooks/teams", async (c) => {
    const { payload } = await json(c);
    const verifier = teamsVerifier(kiln);
    if (!verifier) throw new HttpError(401, "Microsoft Teams is not configured (TEAMS_APP_ID)");
    if (!(await verifier.verify(c.req.header("authorization"), payload))) throw new HttpError(401, "invalid Bot Framework token");
    const ev = normalizeTeams(payload);
    if (!ev) return c.json({});
    const chat = kiln.integrations.chat("teams");
    if (chat instanceof TeamsChat && payload.serviceUrl && ev.data.channel) chat.remember(String(ev.data.channel), String(payload.serviceUrl));
    const reply = (text: string) => chat?.post({ channel: String(ev.data.channel), thread: ev.data.thread, text }).catch(() => undefined);
    const factoriesHere = kiln.defs.list().filter((f) => {
      if (!f.appliedSha) return false;
      const t = kiln.defs.resolved(f.appliedSha).factory.integrations.find((i) => i.type === "microsoft-teams");
      if (!t) return false;
      const teams = t["microsoft-teams"]?.teams;
      return !teams?.length || teams.some((x) => (ev.data.team_ids ?? []).includes(x.teamId) && x.channelIds.some((id) => (ev.data.channel_ids ?? []).includes(id)));
    });
    if (ev.event === "command") {
      const user = String(ev.data.author ?? "");
      if (ev.data.command === "sign in") {
        const { url } = kiln.identities.startLink("teams", user, { displayName: ev.data.userName as string | undefined });
        await reply(`Open this link to connect your Teams account to Kiln (it expires in an hour): ${url}`);
      } else if (ev.data.command === "sign out") {
        const n = kiln.identities.unlink("teams", user);
        await reply(n ? "Signed out: your Teams account is no longer linked to Kiln." : "Your Teams account isn't linked to Kiln.");
      } else {
        await reply(teamsHelpText(factoriesHere.map((f) => f.name)));
      }
      return c.json({});
    }
    if (ev.event === "app_mention" && kiln.connections.isConnected("microsoft-teams") && !factoriesHere.length) {
      await reply(TEAMS_NOT_CONNECTED);
      return c.json({});
    }
    const r = await kiln.automations.handle(ev);
    return c.json({ started: r.started.length, continued: r.continued.length });
  });

  // ---- Discord (interactions endpoint, Ed25519) ----
  app.post("/webhooks/discord", async (c) => {
    const body = await c.req.text();
    const publicKey = serverSecret(kiln, "DISCORD_PUBLIC_KEY") ?? (installation(kiln, "discord").publicKey as string | undefined);
    if (!publicKey || !verifyDiscord(publicKey, c.req.header("x-signature-ed25519"), c.req.header("x-signature-timestamp"), body, kiln.clock.now().getTime())) throw new HttpError(401, "invalid request signature");
    const interaction = JSON.parse(body) as Record<string, any>;
    if (interaction.type === InteractionType.PING) return c.json({ type: InteractionResponse.PONG });
    const ev = normalizeDiscordInteraction(interaction);
    if (!ev) return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: "Kiln doesn't handle this interaction.", flags: 64 } });
    if (ev.event === "component") {
      const person = kiln.automations.person("discord", String(ev.data.author ?? ""));
      const gate = ev.data.targetId ? kiln.gates.get(String(ev.data.targetId)) : undefined;
      if (!gate || gate.state !== "open") return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: "This decision is already closed.", flags: 64 } });
      if (gate.assignees.length && !gate.assignees.includes(person)) return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: "Only the gate's assignees can decide it. Link your Discord account with /kiln if this is you.", flags: 64 } });
      const decision = ev.data.action === "approve" ? "approve" : "reject";
      await kiln.gates.decide(gate.id, { decision, by: person, via: "discord" });
      return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: `${decision === "approve" ? "Approved" : "Rejected"} by <@${ev.data.author}>.` } });
    }
    // /kiln: answer now (Discord allows 3 s), start the work and move it into a thread on the reply.
    const prompt = String(ev.data.text ?? "");
    if (isSignIn(prompt)) {
      const { url } = kiln.identities.startLink("discord", String(ev.data.author ?? ""), { displayName: ev.data.userName as string | undefined });
      return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: `Open this link to connect your Discord account to Kiln (it expires in an hour): ${url}`, flags: 64 } });
    }
    void (async () => {
      const r = await kiln.automations.handle(ev);
      const chat = kiln.integrations.chat("discord");
      if (!r.started.length) {
        if (chat instanceof DiscordChat && ev.data.interactionToken) await chat.followUp(String(ev.data.interactionToken), r.continued.length ? "Added to the work in progress." : "No factory picked this up: connect this channel to a factory or name one with factory:<alias>.");
        return;
      }
      if (chat instanceof DiscordChat && ev.data.interactionToken) {
        const original = await chat.originalResponse(String(ev.data.interactionToken));
        if (original) {
          const thread = await chat.startThread(original.channel_id, original.id, prompt.slice(0, 90) || "Kiln");
          for (const wi of r.started) moveToThread(kiln, wi, thread);
        }
      }
    })().catch((err) => kiln.audit("kiln", "discord.failed", String(interaction.id), { error: String(err) }));
    return c.json({ type: InteractionResponse.CHANNEL_MESSAGE, data: { content: `On it: ${prompt.slice(0, 1900)}` } });
  });

  // Optional: gateway events (mentions, messages, reactions) forwarded by a small bridge process.
  app.post("/webhooks/discord/events", async (c) => {
    const token = serverSecret(kiln, "DISCORD_EVENTS_TOKEN");
    if (!token || !safeEqual(c.req.header("authorization") ?? "", `Bearer ${token}`)) throw new HttpError(401, "bad token");
    const { payload } = await json(c);
    const ev = normalizeDiscordGateway(payload, { botUserId: installation(kiln, "discord").botUserId as string | undefined ?? serverSecret(kiln, "DISCORD_BOT_USER_ID") });
    if (!ev) return c.json({ ignored: true });
    const r = await handleChat(kiln, [ev]);
    const chat = kiln.integrations.chat("discord");
    if (r.started.length && ev.event === "app_mention" && chat instanceof DiscordChat && ev.data.channel && ev.data.ts) {
      const thread = await chat.startThread(String(ev.data.channel), String(ev.data.ts), String(ev.data.title ?? "Kiln")).catch(() => undefined);
      if (thread) for (const wi of r.started) moveToThread(kiln, wi, thread);
    }
    return c.json(summarize(r));
  });

  // ---- Linear ----
  app.post("/webhooks/linear", async (c) => {
    const { body, payload } = await json(c);
    const secret = serverSecret(kiln, "LINEAR_WEBHOOK_SECRET");
    if (secret && !verifyLinear(secret, body, c.req.header("linear-signature"))) throw new HttpError(401, "bad signature");
    const events = normalizeLinearEvents(payload, c.req.header("linear-delivery"), { appUserId: installation(kiln, "linear").appUserId as string | undefined });
    if (!events.length) return c.json({ ignored: true });
    // Linear expects an activity within seconds of a new session.
    const session = events.find((e) => e.event === "agent_session_created")?.data.sessionId as string | undefined;
    if (session && kiln.integrations.linearAgent) await kiln.integrations.linearAgent.activity(session, { type: "thought", body: "Looking at this issue." }).catch(() => {});
    return c.json(summarize(await kiln.automations.handle(events)));
  });

  // ---- Jira Cloud ----
  app.post("/webhooks/jira", async (c) => {
    const secret = serverSecret(kiln, "JIRA_WEBHOOK_TOKEN");
    if (secret && c.req.query("token") !== secret) throw new HttpError(401, "bad token");
    const { payload } = await json(c);
    const events = normalizeJiraEvents(payload, c.req.header("x-atlassian-webhook-identifier"), { botAccountId: serverSecret(kiln, "JIRA_BOT_ACCOUNT_ID") ?? (installation(kiln, "jira").botAccountId as string | undefined) });
    return c.json(events.length ? summarize(await kiln.automations.handle(events)) : { ignored: true });
  });

  // ---- Custom webhooks ----
  const ingest = async (c: Context<Env>, uid: string, pathToken?: string) => {
    const r = await kiln.webhookSources.ingest(uid, { method: c.req.method, header: header(c), body: c.req.method === "POST" ? await c.req.text() : "", pathToken });
    return c.json(r.body, r.status, r.headers);
  };
  app.all("/webhooks/w/:uid", (c) => ingest(c, c.req.param("uid")));
  app.all("/webhooks/w/:uid/:token", (c) => ingest(c, c.req.param("uid"), c.req.param("token")));
  // The older per-factory URL for file webhooks; url_token secrets come as ?token=.
  app.post("/webhooks/:factory/:name", async (c) => {
    const { factory, name } = c.req.param();
    if (!kiln.defs.get(factory)) throw new HttpError(404, `unknown webhook ${name}`);
    const w = kiln.webhookSources.byName(factory, name);
    if (!w) throw new HttpError(404, `unknown webhook ${name}`);
    return ingest(c, w.id, c.req.query("token"));
  });

  // ---- OAuth callbacks and approval links (browser redirects) ----
  app.get("/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    const back = (q: string) => c.redirect(kiln.link(`/integrations?${q}`));
    const error = c.req.query("error");
    if (error) return back(`provider=${encodeURIComponent(provider)}&error=${encodeURIComponent(error)}`);
    try {
      const params = Object.fromEntries(["installation_id", "setup_action", "guild_id", "permissions"].flatMap((k) => (c.req.query(k) ? [[k, c.req.query(k)!]] : [])));
      await kiln.connections.complete(provider, { code: c.req.query("code"), state: c.req.query("state"), params, by: "oauth", ...urls(kiln, c, provider) });
      return back(`provider=${encodeURIComponent(provider)}&connected=1`);
    } catch (err) {
      return back(`provider=${encodeURIComponent(provider)}&error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
    }
  });
  // A person links their GitHub account (so @kiln-factory mentions map to them).
  app.get("/oauth/github-user/callback", async (c) => {
    const clientId = serverSecret(kiln, "GITHUB_CLIENT_ID");
    const clientSecret = serverSecret(kiln, "GITHUB_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new HttpError(400, "GitHub account linking is not configured");
    try {
      const base = (kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
      const user = await githubExchangeCode({ clientId, clientSecret, code: c.req.query("code") ?? "", redirectUri: `${base}/oauth/github-user/callback` });
      kiln.identities.completeOAuthLink(c.req.query("state") ?? "", "github", user.login, user.login);
      return c.redirect(kiln.link(`/integrations?linked=github`));
    } catch (err) {
      return c.redirect(kiln.link(`/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`));
    }
  });
  app.get("/connect/approve/:token", (c) => {
    try {
      const link = kiln.connections.approvalLinks().find((l) => l.token === c.req.param("token"));
      const started = kiln.connections.openApprovalLink(c.req.param("token"), urls(kiln, c, link?.provider ?? "jira"));
      if (started.url) return c.redirect(started.url);
      return c.json({ provider: started.provider, steps: started.steps });
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : String(err));
    }
  });
}
