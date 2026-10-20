import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { Chat, ChatMessage, ChatPost } from "./chat";
import { uniq, type IncomingEvent } from "./events";
import { jsonRequest, type Fetch } from "./http";

type Payload = Record<string, any>;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Discord signs interactions with Ed25519 over `timestamp + body` (X-Signature-Ed25519, X-Signature-Timestamp). */
export function verifyDiscord(publicKeyHex: string, signatureHex: string | undefined, timestamp: string | undefined, body: string, now = Date.now()): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 } as const;
export const InteractionResponse = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_CHANNEL_MESSAGE: 5, DEFERRED_UPDATE: 6, UPDATE_MESSAGE: 7 } as const;

/** The `/kiln` slash command: a prompt and an optional factory alias. */
export const KILN_COMMAND = {
  name: "kiln",
  description: "Send work to a Kiln factory",
  type: 1,
  options: [
    { type: 3, name: "prompt", description: "What should the factory do?", required: true },
    { type: 3, name: "factory", description: "Factory alias (when several share this channel)", required: false },
  ],
};

function userOf(i: Payload) {
  return i.member?.user ?? i.user ?? {};
}

/**
 * An interaction → `slash_command` (`/kiln prompt:…`) or `component` (buttons Kiln posts, with
 * custom ids `kiln:<action>:<id>`). Pings are answered by the route, not normalized.
 */
export function normalizeDiscordInteraction(i: Payload): IncomingEvent | undefined {
  const user = userOf(i);
  const base = {
    channel: i.channel_id ?? i.channel?.id,
    channel_ids: uniq([i.channel_id ?? i.channel?.id]),
    guild_ids: uniq([i.guild_id]),
    user_ids: uniq([user.id]),
    author: user.id,
    userName: user.global_name ?? user.username,
    interactionToken: i.token,
    applicationId: i.application_id,
  };
  if (i.type === InteractionType.APPLICATION_COMMAND && i.data?.name === KILN_COMMAND.name) {
    const opts = Object.fromEntries(((i.data.options ?? []) as { name: string; value: string }[]).map((o) => [o.name, o.value]));
    const text = String(opts.prompt ?? "");
    return { provider: "discord", event: "slash_command", deliveryId: i.id, data: { ...base, text, title: text.split("\n")[0], factoryAlias: opts.factory, mentioned: opts.factory ? [String(opts.factory).toLowerCase()] : [] } };
  }
  if (i.type === InteractionType.MESSAGE_COMPONENT) {
    const [, action, id] = String(i.data?.custom_id ?? "").split(":");
    return { provider: "discord", event: "component", deliveryId: i.id, data: { ...base, action, targetId: id, thread: i.message?.id } };
  }
  return undefined;
}

/**
 * Gateway dispatches forwarded by a small bridge (optional): MESSAGE_CREATE → `app_mention`
 * when the bot is mentioned, otherwise `message_posted`; MESSAGE_REACTION_ADD → `reaction_added`.
 */
export function normalizeDiscordGateway(dispatch: { t?: string; d?: Payload; id?: string }, options: { botUserId?: string } = {}): IncomingEvent | undefined {
  const d = dispatch.d ?? {};
  const deliveryId = dispatch.id ?? d.id;
  if (dispatch.t === "MESSAGE_CREATE") {
    if (d.author?.bot) return undefined;
    const mentionsBot = Boolean(options.botUserId && ((d.mentions ?? []) as { id: string }[]).some((m) => m.id === options.botUserId));
    const text = String(d.content ?? "").replace(/<@!?\d+>/g, "").trim();
    const data = {
      channel: d.channel_id,
      channel_ids: uniq([d.channel_id, d.parent_id]),
      guild_ids: uniq([d.guild_id]),
      user_ids: uniq([d.author?.id]),
      author: d.author?.id,
      userName: d.author?.global_name ?? d.author?.username,
      thread: d.channel_id,
      ts: d.id,
      text,
      title: text.split("\n")[0],
      mentionsBot,
      isThreadReply: Boolean(d.thread_reply ?? d.parent_id) && !mentionsBot,
    };
    return { provider: "discord", event: mentionsBot ? "app_mention" : "message_posted", deliveryId, data };
  }
  if (dispatch.t === "MESSAGE_REACTION_ADD") {
    const emoji = d.emoji?.name as string | undefined;
    return {
      provider: "discord",
      event: "reaction_added",
      deliveryId: deliveryId ?? `${d.message_id}:${d.user_id}:${emoji}`,
      data: { channel: d.channel_id, channel_ids: uniq([d.channel_id]), guild_ids: uniq([d.guild_id]), user_ids: uniq([d.user_id]), author: d.user_id, emoji, ts: d.message_id, thread: d.channel_id, authorIsBot: Boolean(d.member?.user?.bot) },
    };
  }
  return undefined;
}

/**
 * Discord REST with a bot token. Threads are channels: work started from a message gets a thread
 * created on that message, and later posts go to the thread's channel id.
 */
export class DiscordChat implements Chat {
  readonly name = "discord" as const;

  constructor(private readonly options: { botToken: string; applicationId?: string; fetch?: Fetch; baseUrl?: string }) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>("Discord", this.options.fetch ?? fetch, method, `${this.options.baseUrl ?? "https://discord.com/api/v10"}${path}`, { authorization: `Bot ${this.options.botToken}` }, body);
  }

  /** `channel` is a channel or thread id; `thread` (when different) is a thread channel id to post into. */
  async post(input: ChatPost): Promise<ChatMessage> {
    const target = input.thread && /^\d+$/.test(input.thread) && input.thread !== input.channel ? input.thread : input.channel;
    const content = (input.fileUrl ? `${input.text}\n${input.fileUrl}` : input.text).slice(0, 2000);
    const m = await this.api<{ id: string }>("POST", `/channels/${target}/messages`, { content, allowed_mentions: { parse: [] } });
    return { channel: input.channel, thread: input.thread, text: content, ts: m.id };
  }

  async react(input: { channel: string; ts: string; emoji: string }) {
    await this.api("PUT", `/channels/${input.channel}/messages/${input.ts}/reactions/${encodeURIComponent(input.emoji)}/@me`);
  }

  async directMessage(user: string, text: string) {
    const dm = await this.api<{ id: string }>("POST", "/users/@me/channels", { recipient_id: user });
    return this.post({ channel: dm.id, text });
  }

  /** Start a public thread on a message; returns the thread's channel id. */
  async startThread(channel: string, messageId: string, name: string): Promise<string> {
    const t = await this.api<{ id: string }>("POST", `/channels/${channel}/messages/${messageId}/threads`, { name: name.slice(0, 100) || "Kiln", auto_archive_duration: 1440 });
    return t.id;
  }

  /** The message an interaction responded with (to start a thread on it). */
  async originalResponse(interactionToken: string): Promise<{ id: string; channel_id: string } | undefined> {
    if (!this.options.applicationId) return undefined;
    return this.api("GET", `/webhooks/${this.options.applicationId}/${interactionToken}/messages/@original`);
  }

  async followUp(interactionToken: string, content: string) {
    if (!this.options.applicationId) return;
    await this.api("POST", `/webhooks/${this.options.applicationId}/${interactionToken}`, { content: content.slice(0, 2000) });
  }
}

/** Register the `/kiln` command globally, or in one guild (instant, good for testing). */
export async function registerDiscordCommands(input: { applicationId: string; botToken: string; guildId?: string; fetch?: Fetch; baseUrl?: string }) {
  const path = input.guildId ? `/applications/${input.applicationId}/guilds/${input.guildId}/commands` : `/applications/${input.applicationId}/commands`;
  return jsonRequest<{ id: string; name: string }[]>("Discord", input.fetch ?? fetch, "PUT", `${input.baseUrl ?? "https://discord.com/api/v10"}${path}`, { authorization: `Bot ${input.botToken}` }, [KILN_COMMAND]);
}

/** OAuth2 install link that adds the bot with the permissions Kiln uses. */
export function discordInstallUrl(input: { applicationId: string; guildId?: string; redirectUri?: string; state?: string }) {
  // View channels, send messages, send in threads, create public threads, read history, add reactions.
  const permissions = (1n << 10n) | (1n << 11n) | (1n << 38n) | (1n << 35n) | (1n << 16n) | (1n << 6n);
  const q = new URLSearchParams({ client_id: input.applicationId, scope: "bot applications.commands", permissions: permissions.toString() });
  if (input.guildId) q.set("guild_id", input.guildId);
  if (input.redirectUri) {
    q.set("redirect_uri", input.redirectUri);
    q.set("response_type", "code");
  }
  if (input.state) q.set("state", input.state);
  return `https://discord.com/oauth2/authorize?${q}`;
}
