import { mentionsIn, type IncomingEvent } from "./events";
import type { Fetch } from "./http";

type Payload = Record<string, any>;

export type SlackNormalizeOptions = {
  /** The bot user id of the Slack app (from authorizations); messages from it are dropped. */
  botUserId?: string;
};

/**
 * Slack Events API → automation events: app_mention, message_dm and message_im (DMs),
 * message_mpim (group DMs), message_posted (channel messages, thread replies flagged),
 * member_joined_channel and reaction_added. Bot messages are dropped so the app never answers itself.
 */
export function normalizeSlackEvents(payload: Payload, options: SlackNormalizeOptions = {}): IncomingEvent[] {
  if (payload.type !== "event_callback") return [];
  const e = payload.event ?? {};
  const deliveryId = payload.event_id as string | undefined;
  const botUser = options.botUserId ?? payload.authorizations?.[0]?.user_id;
  const base = { channel: e.channel, channel_ids: e.channel ? [e.channel] : [], user_ids: e.user ? [e.user] : [], author: e.user, team_ids: payload.team_id ? [payload.team_id] : [] };
  const ev = (event: string, data: IncomingEvent["data"]): IncomingEvent => ({ provider: "slack", event, deliveryId, data: { ...base, ...data } });
  const textOf = (t: unknown) => String(t ?? "");
  switch (e.type) {
    case "app_mention":
      if (e.bot_id) return [];
      return [ev("app_mention", { thread: e.thread_ts ?? e.ts, ts: e.ts, text: e.text, mentioned: mentionsIn(textOf(e.text).replace(/<@[^>]+>/g, "")) })];
    case "message": {
      if (e.bot_id || e.user === botUser) return [];
      if (e.subtype && !["thread_broadcast", "file_share"].includes(e.subtype)) return [];
      const mentionsBot = Boolean(botUser && textOf(e.text).includes(`<@${botUser}>`));
      const data = { thread: e.thread_ts ?? e.ts, ts: e.ts, text: e.text, mentionsBot, isThreadReply: Boolean(e.thread_ts && e.thread_ts !== e.ts) && !mentionsBot, files: e.files };
      if (e.channel_type === "im") return [ev("message_dm", data), ev("message_im", data)];
      if (e.channel_type === "mpim") return [ev("message_mpim", data)];
      return [ev("message_posted", data)];
    }
    case "member_joined_channel":
      return [ev("member_joined_channel", { text: `<@${e.user}> joined <#${e.channel}>`, inviter: e.inviter })];
    case "reaction_added":
      return [
        ev("reaction_added", {
          channel: e.item?.channel,
          channel_ids: e.item?.channel ? [e.item.channel] : [],
          thread: e.item?.ts,
          ts: e.item?.ts,
          emoji: e.reaction,
          reaction: e.reaction,
          item_user_ids: e.item_user ? [e.item_user] : [],
        }),
      ];
    case "app_home_opened":
      return [ev("app_home_opened", { tab: e.tab })];
    default:
      return [];
  }
}

/** The first event (kept for callers that handle one). */
export function normalizeSlack(payload: Payload, options?: SlackNormalizeOptions): IncomingEvent | undefined {
  return normalizeSlackEvents(payload, options)[0];
}

// ---------------------------------------------------------------------------------------------
// OAuth install ("Add to Slack")

export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "groups:history",
  "im:history",
  "im:write",
  "mpim:history",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
];

export function slackInstallUrl(input: { clientId: string; redirectUri: string; state: string; scopes?: string[] }) {
  const q = new URLSearchParams({ client_id: input.clientId, scope: (input.scopes ?? SLACK_BOT_SCOPES).join(","), redirect_uri: input.redirectUri, state: input.state });
  return `https://slack.com/oauth/v2/authorize?${q}`;
}

export type SlackInstall = { botToken: string; botUserId: string; teamId: string; teamName: string; scopes: string[]; appId?: string };

export async function slackExchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetch?: Fetch }): Promise<SlackInstall> {
  const res = await (input.fetch ?? fetch)("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri }).toString(),
  });
  const body = (await res.json()) as Payload;
  if (!body.ok) throw new Error(`Slack OAuth failed: ${body.error}`);
  return { botToken: body.access_token, botUserId: body.bot_user_id, teamId: body.team?.id, teamName: body.team?.name, scopes: String(body.scope ?? "").split(","), appId: body.app_id };
}

// ---------------------------------------------------------------------------------------------
// App Home

export type HomeItem = { title: string; stage: string; url: string; updatedAt: string; factory: string };

/** Stages shown on the Home tab, in order. */
export const HOME_STAGES = ["Triage", "Planning", "Building", "Reviewing", "Complete", "Cancelled"] as const;

/** A Block Kit Home tab: work items grouped by stage, newest first, each linking to the web app. */
export function slackHomeView(items: HomeItem[], opts: { factoryName?: string; webUrl?: string; perStage?: number } = {}) {
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: opts.factoryName ? `${opts.factoryName}: your work` : "Your factory work" } },
  ];
  if (!items.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "Nothing yet. Mention the app in a channel or send it a DM to start work." } });
  }
  for (const stage of HOME_STAGES) {
    const inStage = items.filter((i) => i.stage === stage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!inStage.length) continue;
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `*${stage}* (${inStage.length})` } });
    for (const i of inStage.slice(0, opts.perStage ?? 10)) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${i.url}|${i.title.replace(/[<>|]/g, "")}> · ${i.factory} · ${i.updatedAt.slice(0, 10)}` }] });
    }
  }
  if (opts.webUrl) blocks.push({ type: "divider" }, { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Kiln" }, url: opts.webUrl }] });
  return { type: "home", blocks: blocks.slice(0, 100) };
}
