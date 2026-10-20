import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import type { Chat, ChatMessage, ChatPost } from "./chat";
import { uniq, type IncomingEvent } from "./events";
import { jsonRequest, type Fetch } from "./http";
import { iconPng, zip } from "./zip";

type Activity = Record<string, any>;

/** Checks the Bot Framework bearer token on an incoming activity. */
export interface BotFrameworkVerifier {
  verify(authorization: string | undefined, activity: Activity): Promise<boolean>;
}

export class FakeBotFrameworkVerifier implements BotFrameworkVerifier {
  constructor(private readonly token = "test-bot-token") {}
  async verify(authorization: string | undefined) {
    return authorization === `Bearer ${this.token}`;
  }
}

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/**
 * Validates tokens issued by the Bot Connector: RS256 signature against the published keys,
 * issuer api.botframework.com, audience = the bot's app id, not expired, and the serviceUrl
 * claim matches the activity.
 */
export class JwtBotFrameworkVerifier implements BotFrameworkVerifier {
  private keys?: { at: number; keys: (JsonWebKey & { kid?: string; endorsements?: string[] })[] };

  constructor(private readonly options: { appId: string; fetch?: Fetch; now?: () => number; openIdUrl?: string }) {}

  private async jwks() {
    const now = this.options.now?.() ?? Date.now();
    if (this.keys && now - this.keys.at < 24 * 3600_000) return this.keys.keys;
    const doFetch = this.options.fetch ?? fetch;
    const config = await jsonRequest<{ jwks_uri: string }>("Bot Framework", doFetch, "GET", this.options.openIdUrl ?? "https://login.botframework.com/v1/.well-known/openidconfiguration", {});
    const set = await jsonRequest<{ keys: (JsonWebKey & { kid?: string })[] }>("Bot Framework", doFetch, "GET", config.jwks_uri, {});
    this.keys = { at: now, keys: set.keys };
    return set.keys;
  }

  async verify(authorization: string | undefined, activity: Activity) {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    try {
      const header = b64urlJson(parts[0]!) as { alg: string; kid: string };
      const claims = b64urlJson(parts[1]!) as { iss: string; aud: string; exp: number; nbf?: number; serviceUrl?: string; serviceurl?: string };
      if (header.alg !== "RS256") return false;
      const jwk = (await this.jwks()).find((k) => k.kid === header.kid);
      if (!jwk) return false;
      const verify = createVerify("RSA-SHA256");
      verify.update(`${parts[0]}.${parts[1]}`);
      if (!verify.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2]!, "base64url"))) return false;
      const now = (this.options.now?.() ?? Date.now()) / 1000;
      if (claims.iss !== "https://api.botframework.com") return false;
      if (claims.aud !== this.options.appId) return false;
      if (claims.exp + 300 < now || (claims.nbf && claims.nbf - 300 > now)) return false;
      const serviceUrl = claims.serviceUrl ?? claims.serviceurl;
      if (serviceUrl && activity.serviceUrl && serviceUrl !== activity.serviceUrl) return false;
      return true;
    } catch {
      return false;
    }
  }
}

export type TeamsNormalizeOptions = { botId?: string };

/** `<at>Kiln</at> do this` → `do this`. */
export function stripTeamsMentions(text: string | undefined): string {
  return String(text ?? "").replace(/<at>[^<]*<\/at>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export const TEAMS_COMMANDS = ["sign in", "sign out", "help"] as const;

/**
 * A Bot Framework activity → `app_mention` (the bot is @mentioned), `message_posted`
 * (other channel messages it can see) or `command` (sign in / sign out / help).
 */
export function normalizeTeams(activity: Activity, options: TeamsNormalizeOptions = {}): IncomingEvent | undefined {
  if (activity.type !== "message") return undefined;
  const botId = options.botId ?? activity.recipient?.id;
  const mentioned = ((activity.entities ?? []) as Activity[]).some((e) => e.type === "mention" && (e.mentioned?.id === botId || e.mentioned?.id === activity.recipient?.id));
  const text = stripTeamsMentions(activity.text);
  const conversation = String(activity.conversation?.id ?? "");
  const [channelConversation, threadPart] = conversation.split(";messageid=");
  const cd = activity.channelData ?? {};
  const data = {
    channel: channelConversation,
    channel_ids: uniq([cd.channel?.id, channelConversation?.startsWith("19:") ? channelConversation : undefined]),
    team_ids: uniq([cd.team?.aadGroupId ?? cd.team?.id]),
    tenant: cd.tenant?.id ?? activity.conversation?.tenantId,
    thread: threadPart ?? activity.replyToId ?? activity.id,
    ts: activity.id,
    text,
    author: activity.from?.aadObjectId ?? activity.from?.id,
    user_ids: uniq([activity.from?.aadObjectId, activity.from?.id]),
    userName: activity.from?.name,
    serviceUrl: activity.serviceUrl,
    conversationType: activity.conversation?.conversationType,
    mentionsBot: mentioned,
    isThreadReply: Boolean(threadPart) && !mentioned,
  };
  const command = TEAMS_COMMANDS.find((c) => text.toLowerCase() === c);
  if (mentioned && command) return { provider: "teams", event: "command", deliveryId: activity.id, data: { ...data, command } };
  return { provider: "teams", event: mentioned ? "app_mention" : "message_posted", deliveryId: activity.id, data };
}

/** Teams has no reactions or DMs for factory bots; it posts to channels and replies in threads. */
export class TeamsChat implements Chat {
  readonly name = "teams" as const;
  private token?: { value: string; expiresAt: number };
  private readonly serviceUrls = new Map<string, string>();

  constructor(private readonly options: { appId: string; appPassword: string; tenantId?: string; defaultServiceUrl?: string; fetch?: Fetch; now?: () => number }) {}

  /** Learn where a conversation lives from an incoming activity. */
  remember(conversationId: string, serviceUrl: string) {
    this.serviceUrls.set(conversationId.split(";")[0]!, serviceUrl);
  }

  private async bearer() {
    const now = this.options.now?.() ?? Date.now();
    if (this.token && this.token.expiresAt - now > 60_000) return this.token.value;
    const tenant = this.options.tenantId ?? "botframework.com";
    const res = await (this.options.fetch ?? fetch)(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.options.appId, client_secret: this.options.appPassword, scope: "https://api.botframework.com/.default" }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!body.access_token) throw new Error(`Bot Framework token request failed: ${body.error_description ?? res.status}`);
    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async post(input: ChatPost): Promise<ChatMessage> {
    const serviceUrl = (this.serviceUrls.get(input.channel) ?? this.options.defaultServiceUrl ?? "https://smba.trafficmanager.net/teams/").replace(/\/?$/, "/");
    const conversation = input.thread ? `${input.channel};messageid=${input.thread}` : input.channel;
    const text = input.fileUrl ? `${input.text}\n\n${input.fileUrl}` : input.text;
    const r = await jsonRequest<{ id: string }>("Teams", this.options.fetch ?? fetch, "POST", `${serviceUrl}v3/conversations/${encodeURIComponent(conversation)}/activities`, { authorization: `Bearer ${await this.bearer()}` }, { type: "message", text, textFormat: "markdown" });
    return { channel: input.channel, thread: input.thread, text, ts: r?.id ?? "" };
  }
}

/** The help text for `@Kiln help`. */
export function teamsHelpText(factoryNames: string[]) {
  return [
    "Mention me with a request to send it to a factory, then reply in the thread to answer questions or approve.",
    "Commands: `sign in` links your Teams account to Kiln, `sign out` unlinks it, `help` shows this.",
    factoryNames.length ? `Factories connected to this channel: ${factoryNames.join(", ")}.` : "This channel isn't connected to a factory yet.",
  ].join("\n\n");
}

export const TEAMS_NOT_CONNECTED = "This Microsoft Teams channel isn't connected to a Kiln factory. Connect this team to a factory, then mention this bot again.";

export type TeamsManifestInput = {
  botId: string;
  name: string;
  shortDescription?: string;
  fullDescription?: string;
  developerName: string;
  websiteUrl: string;
  privacyUrl?: string;
  termsOfUseUrl?: string;
  /** Hex color for the icon background. */
  accentColor?: string;
  version?: string;
  validDomains?: string[];
};

/** A Teams app manifest (schema 1.17) for a channel bot. */
export function teamsManifest(input: TeamsManifestInput) {
  const short = input.shortDescription ?? "Send work to a Kiln software factory.";
  return {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: input.version ?? "1.0.0",
    id: input.botId,
    developer: { name: input.developerName, websiteUrl: input.websiteUrl, privacyUrl: input.privacyUrl ?? input.websiteUrl, termsOfUseUrl: input.termsOfUseUrl ?? input.websiteUrl },
    name: { short: input.name.slice(0, 30), full: input.name.slice(0, 100) },
    description: { short: short.slice(0, 80), full: (input.fullDescription ?? `${short} Mention the bot in a channel to start work; reply in the thread to continue.`).slice(0, 4000) },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: input.accentColor ?? "#5319E7",
    bots: [
      {
        botId: input.botId,
        scopes: ["team"],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [{ scopes: ["team"], commands: [{ title: "sign in", description: "Link your Teams account to Kiln" }, { title: "sign out", description: "Unlink your account" }, { title: "help", description: "How to use the factory" }] }],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: input.validDomains ?? [],
  };
}

/** The upload package: manifest.json plus the 192×192 color and 32×32 outline icons. No executables. */
export function teamsAppPackage(input: TeamsManifestInput): Buffer {
  const hex = (input.accentColor ?? "#5319E7").replace("#", "");
  const rgb: [number, number, number] = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  return zip({ "manifest.json": JSON.stringify(teamsManifest(input), null, 2), "color.png": iconPng(192, rgb), "outline.png": iconPng(32, rgb, true) });
}
