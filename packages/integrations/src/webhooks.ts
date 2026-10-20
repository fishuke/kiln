import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyGitHub(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`, signature);
}

export function verifySlack(signingSecret: string, body: string, timestamp: string | undefined, signature: string | undefined, now = Date.now()): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  return safeEqual(`v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`, signature);
}

export function verifyLinear(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(createHmac("sha256", secret).update(body).digest("hex"), signature);
}

/** https://www.standardwebhooks.com — "v1,<base64 hmac>" over "<id>.<timestamp>.<body>". */
export function verifyStandardWebhook(secret: string, id: string | undefined, timestamp: string | undefined, body: string, signature: string | undefined): boolean {
  if (!id || !timestamp || !signature) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signature.split(" ").some((s) => safeEqual(s.replace(/^v1,/, ""), expected));
}

/**
 * A provider event in the shape automation filters read: `repos`, `labels`, `mentioned`,
 * `team_ids`, `channel`, plus the text and links a work item needs.
 */
export type IncomingEvent = {
  provider: "github" | "linear" | "jira" | "slack" | "webhook" | "schedule" | "factory" | "kiln";
  event: string;
  deliveryId?: string;
  data: {
    repo?: string;
    number?: number;
    labels?: string[];
    mentioned?: string[];
    team_ids?: string[];
    channel?: string;
    thread?: string;
    title?: string;
    body?: string;
    text?: string;
    url?: string;
    author?: string;
    merged?: boolean;
    head?: string;
    issueId?: string;
    [k: string]: unknown;
  };
};

export function mentionsIn(text: string | undefined): string[] {
  return [...new Set([...(text ?? "").matchAll(/(?:^|[^\w])@([a-z0-9][a-z0-9-]*)/gi)].map((m) => m[1]!.toLowerCase()))];
}

export function normalizeGitHub(eventName: string, payload: Record<string, any>, deliveryId?: string): IncomingEvent | undefined {
  const repo = payload.repository?.full_name as string | undefined;
  const issue = payload.issue ?? payload.pull_request;
  const base = {
    repo,
    number: issue?.number,
    labels: (issue?.labels ?? []).map((l: { name: string }) => l.name),
    title: issue?.title,
    body: issue?.body ?? "",
    url: issue?.html_url,
    author: payload.sender?.login,
  };
  const ev = (event: string, extra: Record<string, unknown> = {}): IncomingEvent => ({ provider: "github", event, deliveryId, data: { ...base, ...extra } });
  switch (eventName) {
    case "issues":
      if (payload.action === "labeled") return ev("issue_labeled", { label: payload.label?.name });
      if (payload.action === "assigned") return ev("issue_assigned", { assignee: payload.assignee?.login });
      if (payload.action === "opened") return ev("issue_opened", { mentioned: mentionsIn(issue?.body) });
      return undefined;
    case "issue_comment":
      if (payload.action !== "created") return undefined;
      return ev(payload.issue?.pull_request ? "pull_request_mentioned" : "issue_mentioned", {
        text: payload.comment?.body,
        mentioned: mentionsIn(payload.comment?.body),
        commentUrl: payload.comment?.html_url,
      });
    case "pull_request":
      if (payload.action === "closed") return ev(payload.pull_request?.merged ? "pull_request_merged" : "pull_request_closed", { merged: Boolean(payload.pull_request?.merged), head: payload.pull_request?.head?.ref, mergedBy: payload.pull_request?.merged_by?.login });
      if (payload.action === "labeled") return ev("pull_request_labeled", { label: payload.label?.name, head: payload.pull_request?.head?.ref });
      if (payload.action === "opened") return ev("pull_request_opened", { head: payload.pull_request?.head?.ref });
      return undefined;
    case "pull_request_review":
      if (payload.action !== "submitted") return undefined;
      return ev("pull_request_review_submitted", { state: payload.review?.state, text: payload.review?.body, head: payload.pull_request?.head?.ref });
    case "check_suite":
      if (payload.action !== "completed") return undefined;
      return ev("check_suite_completed", { conclusion: payload.check_suite?.conclusion, head: payload.check_suite?.head_branch, sha: payload.check_suite?.head_sha });
    case "push":
      return { provider: "github", event: "push", deliveryId, data: { repo, ref: payload.ref, head: String(payload.ref ?? "").replace("refs/heads/", ""), sha: payload.after } };
    default:
      return undefined;
  }
}

export function normalizeLinear(payload: Record<string, any>, deliveryId?: string): IncomingEvent | undefined {
  const d = payload.data ?? {};
  const team = d.teamId ?? d.team?.id ?? payload.agentSession?.issue?.teamId;
  if (payload.type === "Issue" && payload.action === "create") {
    return { provider: "linear", event: "issue_created", deliveryId, data: { issueId: d.id, title: d.title, body: d.description ?? "", url: payload.url ?? d.url, team_ids: team ? [team] : [], labels: (d.labels ?? []).map((l: { name: string }) => l.name), mentioned: mentionsIn(d.description) } };
  }
  if (payload.type === "Issue" && payload.action === "update" && payload.updatedFrom && "assigneeId" in payload.updatedFrom) {
    return { provider: "linear", event: "issue_assigned", deliveryId, data: { issueId: d.id, title: d.title, body: d.description ?? "", url: payload.url, team_ids: team ? [team] : [], assignee: d.assignee?.name } };
  }
  if (payload.type === "Comment" && payload.action === "create") {
    return { provider: "linear", event: "issue_mentioned", deliveryId, data: { issueId: d.issueId ?? d.issue?.id, text: d.body, mentioned: mentionsIn(d.body), team_ids: team ? [team] : [], url: payload.url } };
  }
  if (payload.type === "AgentSessionEvent" && payload.action === "created") {
    const issue = payload.agentSession?.issue ?? {};
    return { provider: "linear", event: "agent_session_created", deliveryId, data: { issueId: issue.id, title: issue.title, body: issue.description ?? "", url: issue.url, team_ids: issue.teamId ? [issue.teamId] : [], sessionId: payload.agentSession?.id } };
  }
  return undefined;
}

export function normalizeSlack(payload: Record<string, any>): IncomingEvent | undefined {
  if (payload.type !== "event_callback") return undefined;
  const e = payload.event ?? {};
  const deliveryId = payload.event_id;
  if (e.bot_id) return undefined;
  if (e.type === "app_mention") {
    return { provider: "slack", event: "app_mention", deliveryId, data: { channel: e.channel, thread: e.thread_ts ?? e.ts, text: e.text, author: e.user, mentioned: mentionsIn(String(e.text ?? "").replace(/<@[^>]+>/g, "")) } };
  }
  if (e.type === "message" && e.channel_type === "im") {
    return { provider: "slack", event: "direct_message", deliveryId, data: { channel: e.channel, thread: e.thread_ts ?? e.ts, text: e.text, author: e.user } };
  }
  if (e.type === "message" && e.thread_ts) {
    return { provider: "slack", event: "thread_reply", deliveryId, data: { channel: e.channel, thread: e.thread_ts, text: e.text, author: e.user } };
  }
  if (e.type === "reaction_added") {
    return { provider: "slack", event: "reaction_added", deliveryId, data: { channel: e.item?.channel, thread: e.item?.ts, reaction: e.reaction, author: e.user } };
  }
  return undefined;
}

export function normalizeJira(payload: Record<string, any>, deliveryId?: string): IncomingEvent | undefined {
  const issue = payload.issue ?? {};
  const f = issue.fields ?? {};
  const base = { issueId: issue.key, title: f.summary, body: typeof f.description === "string" ? f.description : "", labels: f.labels ?? [], project: f.project?.key };
  switch (payload.webhookEvent) {
    case "jira:issue_created":
      return { provider: "jira", event: "issue_created", deliveryId, data: { ...base, mentioned: mentionsIn(base.body) } };
    case "jira:issue_updated": {
      const assigned = (payload.changelog?.items ?? []).some((i: { field: string }) => i.field === "assignee");
      return assigned ? { provider: "jira", event: "issue_assigned", deliveryId, data: { ...base, assignee: f.assignee?.displayName } } : undefined;
    }
    case "comment_created":
      return { provider: "jira", event: "issue_mentioned", deliveryId, data: { ...base, text: payload.comment?.body, mentioned: mentionsIn(payload.comment?.body) } };
    default:
      return undefined;
  }
}

/** Remembers delivery ids so provider retries do not start the same work twice. */
export class DeliveryDedupe {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 24 * 3600_000) {}

  firstTime(id: string | undefined, now = Date.now()): boolean {
    if (!id) return true;
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
}
