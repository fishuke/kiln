import { createSign } from "node:crypto";
import { mentionsIn, uniq, type IncomingEvent } from "./events";

/** The handle people mention on GitHub, and the prefix of the routing label (`factory:<alias>`). */
export const GITHUB_BOT_HANDLE = "kiln-factory";
export const FACTORY_LABEL_PREFIX = "factory:";
export const factoryLabel = (alias: string) => `${FACTORY_LABEL_PREFIX}${alias}`;

type Fetch = typeof fetch;
type Payload = Record<string, any>;

export type GitHubNormalizeOptions = {
  /** Logins that are Kiln itself (e.g. kiln-factory[bot]); their events count as `self` for skip_bots. */
  selfLogins?: string[];
};

const loginOf = (u: { login?: string } | undefined | null) => u?.login;

/** Every automation event one GitHub delivery produces (a comment can be both commented and mentioned). */
export function normalizeGitHubEvents(eventName: string, payload: Payload, deliveryId?: string, options: GitHubNormalizeOptions = {}): IncomingEvent[] {
  const self = new Set((options.selfLogins ?? [`${GITHUB_BOT_HANDLE}[bot]`, GITHUB_BOT_HANDLE]).map((s) => s.toLowerCase()));
  const repo = payload.repository?.full_name as string | undefined;
  const sender = payload.sender as { login?: string; type?: string } | undefined;
  const author = sender?.login;
  const isSelf = Boolean(author && self.has(author.toLowerCase()));
  const isBot = sender?.type === "Bot" || Boolean(author?.endsWith("[bot]")) || isSelf;
  const issue = payload.issue ?? payload.pull_request;
  const base = {
    repo,
    repos: repo ? [repo] : [],
    number: issue?.number as number | undefined,
    labels: ((issue?.labels ?? []) as { name: string }[]).map((l) => l.name),
    assignees: ((issue?.assignees ?? []) as { login: string }[]).map((a) => a.login),
    title: issue?.title as string | undefined,
    body: (issue?.body ?? "") as string,
    url: issue?.html_url as string | undefined,
    author,
    authorIsBot: isBot,
    authorIsSelf: isSelf,
  };
  const ev = (event: string, extra: Record<string, unknown> = {}): IncomingEvent => ({ provider: "github", event, deliveryId, data: { ...base, ...extra } });
  const pr = payload.pull_request as Payload | undefined;
  const prExtra = pr ? { base: pr.base?.ref, head: pr.head?.ref, branch: pr.head?.ref, sha: pr.head?.sha, draft: Boolean(pr.draft) } : {};
  const out: IncomingEvent[] = [];
  switch (eventName) {
    case "issues": {
      const mentioned = mentionsIn(issue?.body);
      if (payload.action === "opened") {
        out.push(ev("issue_created", { mentioned }));
        if (mentioned.length) out.push(ev("issue_mentioned", { mentioned, text: issue?.body }));
      }
      if (payload.action === "labeled") out.push(ev("issue_labeled", { label: payload.label?.name }));
      if (payload.action === "assigned") out.push(ev("issue_assigned", { assignee: loginOf(payload.assignee), assignees: uniq([...base.assignees, loginOf(payload.assignee)]) }));
      break;
    }
    case "issue_comment": {
      // Edits and deletions never start work.
      if (payload.action !== "created") break;
      const onPr = Boolean(payload.issue?.pull_request);
      const text = payload.comment?.body as string | undefined;
      const mentioned = mentionsIn(text);
      const extra = { text, mentioned, commentId: payload.comment?.id, commentUrl: payload.comment?.html_url, author: loginOf(payload.comment?.user) ?? author };
      out.push(ev(onPr ? "pull_request_commented" : "issue_commented", extra));
      if (mentioned.length) out.push(ev(onPr ? "pull_request_mentioned" : "issue_mentioned", extra));
      break;
    }
    case "pull_request_review_comment": {
      if (payload.action !== "created") break;
      const text = payload.comment?.body as string | undefined;
      const mentioned = mentionsIn(text);
      const extra = { ...prExtra, text, mentioned, commentUrl: payload.comment?.html_url, path: payload.comment?.path };
      out.push(ev("pull_request_commented", extra));
      if (mentioned.length) out.push(ev("pull_request_mentioned", extra));
      break;
    }
    case "pull_request": {
      const a = payload.action as string;
      const map: Record<string, string> = {
        opened: "pull_request_opened",
        ready_for_review: "pull_request_ready",
        reopened: "pull_request_reopened",
        labeled: "pull_request_labeled",
        assigned: "pull_request_assigned",
        synchronize: "pull_request_synchronized",
        enqueued: "pull_request_enqueued",
        dequeued: "pull_request_dequeued",
        review_requested: "pull_request_review_requested",
      };
      if (a === "closed") {
        out.push(ev(pr?.merged ? "pull_request_merged" : "pull_request_closed", { ...prExtra, merged: Boolean(pr?.merged), mergedBy: loginOf(pr?.merged_by) }));
        break;
      }
      const name = map[a];
      if (!name) break;
      const extra: Record<string, unknown> = { ...prExtra, label: payload.label?.name };
      if (a === "assigned") extra.assignees = uniq([...base.assignees, loginOf(payload.assignee)]);
      if (a === "review_requested") {
        extra.reviewers = uniq([loginOf(payload.requested_reviewer), ...((pr?.requested_reviewers ?? []) as { login: string }[]).map((r) => r.login)]);
        extra.reviewer_teams = uniq([payload.requested_team?.slug, ...((pr?.requested_teams ?? []) as { slug: string }[]).map((t) => t.slug)]);
      }
      out.push(ev(name, extra));
      if (a === "opened") {
        const mentioned = mentionsIn(pr?.body);
        if (mentioned.length) out.push(ev("pull_request_mentioned", { ...prExtra, mentioned, text: pr?.body }));
      }
      break;
    }
    case "pull_request_review": {
      if (payload.action !== "submitted") break;
      const text = payload.review?.body as string | undefined;
      out.push(ev("pull_request_review_submitted", { ...prExtra, state: payload.review?.state, review_state: String(payload.review?.state ?? "").toLowerCase(), text, mentioned: mentionsIn(text) }));
      break;
    }
    case "check_suite": {
      const cs = payload.check_suite ?? {};
      const prs = ((cs.pull_requests ?? []) as { number: number }[]).map((p) => p.number);
      const extra = { conclusion: cs.conclusion, branch: cs.head_branch, head: cs.head_branch, sha: cs.head_sha, number: prs[0], pr_numbers: prs };
      if (payload.action === "completed") out.push(ev("check_suite_completed", extra));
      if (payload.action === "rerequested") out.push(ev("check_suite_rerequested", extra));
      break;
    }
    case "check_run": {
      if (payload.action === "rerequested") out.push(ev("check_run_rerequested", { name: payload.check_run?.name, sha: payload.check_run?.head_sha, checkRunId: payload.check_run?.id }));
      break;
    }
    case "status": {
      out.push(ev("commit_status", { context: payload.context, state: payload.state, sha: payload.sha, branch: ((payload.branches ?? []) as { name: string }[]).map((b) => b.name), url: payload.target_url }));
      break;
    }
    case "workflow_run": {
      if (payload.action !== "completed") break;
      const wr = payload.workflow_run ?? {};
      const prs = ((wr.pull_requests ?? []) as { number: number }[]).map((p) => p.number);
      out.push(
        ev("workflow_run_completed", {
          workflow: wr.name ?? payload.workflow?.name,
          conclusion: wr.conclusion,
          branch: wr.head_branch,
          head: wr.head_branch,
          sha: wr.head_sha,
          url: wr.html_url,
          title: `${wr.name ?? "workflow"} ${wr.conclusion ?? "completed"} on ${wr.head_branch ?? "?"}`,
          author: loginOf(wr.actor) ?? author,
          number: prs[0],
          pr_numbers: prs,
        }),
      );
      break;
    }
    case "push": {
      const commits = (payload.commits ?? []) as { added?: string[]; modified?: string[]; removed?: string[] }[];
      const paths = uniq(commits.flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]));
      const branch = String(payload.ref ?? "").replace("refs/heads/", "");
      out.push({ provider: "github", event: "push", deliveryId, data: { repo, repos: repo ? [repo] : [], ref: payload.ref, head: branch, branch, sha: payload.after, paths, author: author ?? payload.pusher?.name, authorIsBot: isBot, authorIsSelf: isSelf, title: `push to ${branch}` } });
      break;
    }
  }
  return out;
}

/** The first event of a delivery (kept for callers that handle one event). */
export function normalizeGitHub(eventName: string, payload: Payload, deliveryId?: string, options?: GitHubNormalizeOptions): IncomingEvent | undefined {
  return normalizeGitHubEvents(eventName, payload, deliveryId, options)[0];
}

// ---------------------------------------------------------------------------------------------
// GitHub App: JWT and installation tokens

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** An RS256 JWT for the GitHub App, valid ten minutes (backdated 60 s for clock skew). */
export function githubAppJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${body}`);
  return `${header}.${body}.${base64url(sign.sign(privateKeyPem))}`;
}

/** Issues short-lived tokens for an installation. */
export interface GitHubAppAuth {
  installationToken(installationId?: string): Promise<string>;
  /** The installation that covers an owner (org or user). */
  installationFor(owner: string): Promise<string | undefined>;
}

export class FakeGitHubAppAuth implements GitHubAppAuth {
  readonly issued: string[] = [];
  constructor(private readonly installations: Record<string, string> = { acme: "1" }) {}
  async installationToken(installationId = "1") {
    const token = `ghs_fake_${installationId}_${this.issued.length + 1}`;
    this.issued.push(token);
    return token;
  }
  async installationFor(owner: string) {
    return this.installations[owner];
  }
}

export class HttpGitHubAppAuth implements GitHubAppAuth {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly options: { appId: string; privateKey: string; installationId?: string; baseUrl?: string; fetch?: Fetch; now?: () => number }) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async app<T>(method: string, path: string): Promise<T> {
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl ?? "https://api.github.com"}${path}`, {
      method,
      headers: { authorization: `Bearer ${githubAppJwt(this.options.appId, this.options.privateKey, this.now())}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`GitHub App ${method} ${path} returned ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async installationFor(owner: string) {
    const list = await this.app<{ id: number; account: { login: string } }[]>("GET", "/app/installations?per_page=100");
    return list.find((i) => i.account.login.toLowerCase() === owner.toLowerCase())?.id.toString();
  }

  async installationToken(installationId = this.options.installationId) {
    if (!installationId) throw new Error("no GitHub App installation id: set GITHUB_APP_INSTALLATION_ID or connect GitHub");
    const hit = this.cache.get(installationId);
    if (hit && hit.expiresAt - this.now() > 5 * 60_000) return hit.token;
    const r = await this.app<{ token: string; expires_at: string }>("POST", `/app/installations/${installationId}/access_tokens`);
    this.cache.set(installationId, { token: r.token, expiresAt: Date.parse(r.expires_at) });
    return r.token;
  }
}

/** GitHub OAuth for linking a person's GitHub account to their Kiln identity. */
export function githubOAuthUrl(input: { clientId: string; redirectUri: string; state: string; baseUrl?: string }) {
  const q = new URLSearchParams({ client_id: input.clientId, redirect_uri: input.redirectUri, state: input.state, scope: "read:user user:email" });
  return `${input.baseUrl ?? "https://github.com"}/login/oauth/authorize?${q}`;
}

export function githubAppInstallUrl(appSlug: string, state: string) {
  return `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

export async function githubExchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetch?: Fetch }): Promise<{ accessToken: string; login: string; email?: string }> {
  const doFetch = input.fetch ?? fetch;
  const res = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`GitHub OAuth failed: ${body.error ?? res.status}`);
  const me = (await (await doFetch("https://api.github.com/user", { headers: { authorization: `Bearer ${body.access_token}`, accept: "application/vnd.github+json" } })).json()) as { login: string; email?: string };
  return { accessToken: body.access_token, login: me.login, email: me.email ?? undefined };
}
