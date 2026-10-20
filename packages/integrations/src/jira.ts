import { mentionsIn, uniq, type IncomingEvent } from "./events";
import { jsonRequest, type Fetch } from "./http";

type Payload = Record<string, any>;

export type JiraNormalizeOptions = {
  /** Atlassian account id of the factory's app user; assigning or mentioning it starts an agent session. */
  botAccountId?: string;
  /** Plain-text handles that also count as a mention (e.g. "kiln"). */
  botHandles?: string[];
};

/** Plain text of an Atlassian Document Format node (or a string). */
export function adfText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mention") return `@${node.attrs?.text?.replace(/^@/, "") ?? node.attrs?.id ?? ""}`;
  const inner = ((node.content ?? []) as any[]).map(adfText);
  return inner.join(node.type === "doc" ? "\n\n" : node.type === "paragraph" ? "" : " ");
}

function adfMentions(node: any): string[] {
  if (!node || typeof node !== "object") return [];
  const here = node.type === "mention" && node.attrs?.id ? [String(node.attrs.id)] : [];
  return [...here, ...((node.content ?? []) as any[]).flatMap(adfMentions)];
}

/**
 * Jira Cloud webhooks → automation events. Assigning or mentioning the factory's app user is
 * `agent_session_created`; label additions are `issue_labeled`; status changes are
 * `status_changed` (with `status_id`). `comment_created` continues the work item of that issue.
 */
export function normalizeJiraEvents(payload: Payload, deliveryId?: string, options: JiraNormalizeOptions = {}): IncomingEvent[] {
  const issue = payload.issue ?? {};
  const f = issue.fields ?? {};
  const actor = payload.user ?? payload.comment?.author ?? {};
  const isSelf = Boolean(options.botAccountId && actor.accountId === options.botAccountId);
  const handles = (options.botHandles ?? ["kiln"]).map((h) => h.toLowerCase());
  const mentionsBot = (raw: any) => {
    const ids = adfMentions(raw);
    const text = adfText(raw);
    return (options.botAccountId !== undefined && (ids.includes(options.botAccountId) || text.includes(`[~accountid:${options.botAccountId}]`))) || mentionsIn(text).some((m) => handles.includes(m));
  };
  const base = {
    issueId: issue.key as string | undefined,
    issue_ids: uniq([issue.key, issue.id]),
    title: f.summary,
    body: adfText(f.description),
    labels: (f.labels ?? []) as string[],
    project: f.project?.key,
    project_keys: uniq([f.project?.key]),
    status_id: f.status?.id,
    url: issue.self && issue.key ? `${String(issue.self).replace(/\/rest\/api\/.*$/, "")}/browse/${issue.key}` : undefined,
    author: actor.displayName ?? actor.emailAddress ?? actor.accountId,
    authorAccountId: actor.accountId,
    authorIsSelf: isSelf,
    authorIsBot: isSelf || actor.accountType === "app",
    assignee: f.assignee?.displayName,
  };
  const ev = (event: string, extra: Record<string, unknown> = {}): IncomingEvent => ({ provider: "jira", event, deliveryId, data: { ...base, ...extra } });
  const out: IncomingEvent[] = [];
  const items = (payload.changelog?.items ?? []) as { field: string; fieldId?: string; to?: string; toString?: string; from?: string; fromString?: string }[];
  const assignedToBot = (to: string | undefined) => Boolean(options.botAccountId && to === options.botAccountId);
  switch (payload.webhookEvent) {
    case "jira:issue_created":
      out.push(ev("issue_created", { mentioned: mentionsIn(base.body) }));
      if (assignedToBot(f.assignee?.accountId) || mentionsBot(f.description)) out.push(ev("agent_session_created", { text: base.body }));
      break;
    case "jira:issue_updated":
      for (const i of items) {
        if (i.field === "assignee" && assignedToBot(i.to)) out.push(ev("agent_session_created", { text: base.body }));
        if (i.field === "labels") {
          const before = new Set(String(i.fromString ?? "").split(" ").filter(Boolean));
          const added = String(i.toString ?? "").split(" ").filter((l) => l && !before.has(l));
          if (added.length) out.push(ev("issue_labeled", { added_labels: added }));
        }
        if (i.field === "status") out.push(ev("status_changed", { status_id: i.to, previous_status_id: i.from, status: i.toString }));
      }
      break;
    case "comment_created": {
      const text = adfText(payload.comment?.body);
      if (mentionsBot(payload.comment?.body)) out.push(ev("agent_session_created", { text }));
      else out.push(ev("comment_created", { text }));
      break;
    }
  }
  return out;
}

export function normalizeJira(payload: Payload, deliveryId?: string, options?: JiraNormalizeOptions): IncomingEvent | undefined {
  return normalizeJiraEvents(payload, deliveryId, options)[0];
}

// ---------------------------------------------------------------------------------------------
// Jira Cloud actions (comment, transition, labels) through the OAuth 2.0 (3LO) API gateway

export interface JiraCloudApi {
  comment(issueKey: string, text: string): Promise<void>;
  /** Transition to the first transition whose target status (or transition) name matches. */
  transition(issueKey: string, toStatus: string): Promise<void>;
  labels(issueKey: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
  /** Project keys by name and key, for alias resolution and pickers. */
  projects(): Promise<Record<string, string>>;
}

export class FakeJiraCloudApi implements JiraCloudApi {
  readonly calls: { op: string; issueKey?: string; arg: unknown }[] = [];
  async comment(issueKey: string, text: string) {
    this.calls.push({ op: "comment", issueKey, arg: text });
  }
  async transition(issueKey: string, toStatus: string) {
    this.calls.push({ op: "transition", issueKey, arg: toStatus });
  }
  async labels(issueKey: string, change: { add?: string[]; remove?: string[] }) {
    this.calls.push({ op: "labels", issueKey, arg: change });
  }
  async projects() {
    return { ENG: "ENG", Engineering: "ENG" };
  }
}

export class HttpJiraCloudApi implements JiraCloudApi {
  constructor(private readonly options: { cloudId: string; accessToken: string | (() => Promise<string>); fetch?: Fetch }) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = typeof this.options.accessToken === "string" ? this.options.accessToken : await this.options.accessToken();
    return jsonRequest<T>("Jira", this.options.fetch ?? fetch, method, `https://api.atlassian.com/ex/jira/${this.options.cloudId}/rest/api/3${path}`, { authorization: `Bearer ${token}` }, body);
  }

  async comment(issueKey: string, text: string) {
    await this.api("POST", `/issue/${encodeURIComponent(issueKey)}/comment`, { body: { type: "doc", version: 1, content: text.split("\n\n").map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })) } });
  }

  async transition(issueKey: string, toStatus: string) {
    const r = await this.api<{ transitions: { id: string; name: string; to: { name: string } }[] }>("GET", `/issue/${encodeURIComponent(issueKey)}/transitions`);
    const want = toStatus.toLowerCase();
    const t = r.transitions.find((x) => x.to.name.toLowerCase() === want || x.name.toLowerCase() === want);
    if (!t) throw new Error(`no Jira transition to ${toStatus} on ${issueKey}`);
    await this.api("POST", `/issue/${encodeURIComponent(issueKey)}/transitions`, { transition: { id: t.id } });
  }

  async labels(issueKey: string, change: { add?: string[]; remove?: string[] }) {
    const ops = [...(change.add ?? []).map((l) => ({ add: l })), ...(change.remove ?? []).map((l) => ({ remove: l }))];
    if (ops.length) await this.api("PUT", `/issue/${encodeURIComponent(issueKey)}`, { update: { labels: ops } });
  }

  async projects() {
    const r = await this.api<{ values: { key: string; name: string }[] }>("GET", "/project/search?maxResults=100");
    return Object.fromEntries((r?.values ?? []).flatMap((p) => [[p.name, p.key], [p.key, p.key]]));
  }
}

export const JIRA_SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "manage:jira-webhook", "offline_access"];

export function jiraAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; scopes?: string[] }) {
  const q = new URLSearchParams({ audience: "api.atlassian.com", client_id: input.clientId, scope: (input.scopes ?? JIRA_SCOPES).join(" "), redirect_uri: input.redirectUri, state: input.state, response_type: "code", prompt: "consent" });
  return `https://auth.atlassian.com/authorize?${q}`;
}

export async function jiraExchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetch?: Fetch }) {
  const doFetch = input.fetch ?? fetch;
  const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>("Atlassian", doFetch, "POST", "https://auth.atlassian.com/oauth/token", {}, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const sites = await jsonRequest<{ id: string; name: string; url: string; scopes: string[] }[]>("Atlassian", doFetch, "GET", "https://api.atlassian.com/oauth/token/accessible-resources", { authorization: `Bearer ${token.access_token}` });
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, scopes: token.scope.split(" "), sites: sites ?? [] };
}
