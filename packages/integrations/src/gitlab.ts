import { mentionsIn, uniq, type IncomingEvent } from "./events";
import { repoKey, type CheckRunInput, type CheckStatus, type Forge, type ForgeIssue, type PullRequest, type RepoRef } from "./forge";
import { jsonRequest, resolveToken, safeEqual, type Fetch } from "./http";

/** GitLab sends the configured secret token as-is in X-Gitlab-Token. */
export function verifyGitLab(secret: string, header: string | undefined): boolean {
  return Boolean(header) && safeEqual(secret, header!);
}

export type GitLabNormalizeOptions = {
  /** Usernames of the factory bots (service accounts); a note mentioning one is `bot_mentioned`. */
  botUsernames?: string[];
};

type Payload = Record<string, any>;

/**
 * GitLab group webhooks: Note Hook → bot_mentioned (new comments only), Merge Request Hook →
 * merge_request (with `action`), Push Hook → push. Activity by the bots themselves is `self`.
 */
export function normalizeGitLab(eventHeader: string, payload: Payload, deliveryId?: string, options: GitLabNormalizeOptions = {}): IncomingEvent | undefined {
  const bots = new Set((options.botUsernames ?? []).map((b) => b.toLowerCase()));
  const project = payload.project?.path_with_namespace as string | undefined;
  const user = (payload.user?.username ?? payload.user_username) as string | undefined;
  const isSelf = Boolean(user && (bots.has(user.toLowerCase()) || /-kiln-[a-z0-9]+$/i.test(user)));
  const common = { repo: project, repos: project ? [project] : [], author: user, authorIsSelf: isSelf, authorIsBot: isSelf || Boolean(payload.user?.bot) };
  const kind = payload.object_kind ?? eventHeader.replace(/ Hook$/, "").toLowerCase().replace(/ /g, "_");
  if (kind === "note") {
    const note = payload.object_attributes ?? {};
    if (note.action === "update") return undefined;
    const mr = payload.merge_request;
    const issue = payload.issue;
    const target = mr ?? issue ?? {};
    const mentioned = mentionsIn(note.note).filter((m) => bots.size === 0 || bots.has(m));
    if (!mentioned.length || isSelf) return undefined;
    return {
      provider: "gitlab",
      event: "bot_mentioned",
      deliveryId,
      data: {
        ...common,
        number: target.iid,
        noteable: note.noteable_type,
        discussionId: note.discussion_id,
        title: target.title,
        body: target.description ?? "",
        text: note.note,
        mentioned,
        labels: ((target.labels ?? payload.labels ?? []) as { title: string }[]).map((l) => l.title),
        url: note.url,
        base: mr?.target_branch,
        head: mr?.source_branch,
        branch: mr?.source_branch,
      },
    };
  }
  if (kind === "merge_request") {
    const mr = payload.object_attributes ?? {};
    const action = String(mr.action ?? (mr.state === "merged" ? "merge" : "update"));
    return {
      provider: "gitlab",
      event: "merge_request",
      deliveryId,
      data: {
        ...common,
        number: mr.iid,
        action,
        title: mr.title,
        body: mr.description ?? "",
        url: mr.url,
        base: mr.target_branch,
        head: mr.source_branch,
        branch: mr.source_branch,
        merged: action === "merge",
        labels: ((payload.labels ?? []) as { title: string }[]).map((l) => l.title),
      },
    };
  }
  if (kind === "push") {
    const branch = String(payload.ref ?? "").replace("refs/heads/", "");
    return { provider: "gitlab", event: "push", deliveryId, data: { ...common, branch, head: branch, ref: payload.ref, sha: payload.after ?? payload.checkout_sha, title: `push to ${branch}`, paths: uniq(((payload.commits ?? []) as Payload[]).flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])])) } };
  }
  return undefined;
}

/** GitLab REST v4 (gitlab.com or a self-managed base URL). `owner` may be a group path such as acme/platform. */
export class GitLabForge implements Forge {
  readonly name = "gitlab";

  constructor(private readonly options: { token: string | (() => Promise<string> | string); baseUrl?: string; fetch?: Fetch }) {}

  private get base() {
    return (this.options.baseUrl ?? "https://gitlab.com").replace(/\/$/, "");
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>("GitLab", this.options.fetch ?? fetch, method, `${this.base}/api/v4${path}`, { "private-token": await resolveToken(this.options.token) }, body);
  }

  private pid(repo: RepoRef) {
    return `/projects/${encodeURIComponent(repoKey(repo))}`;
  }

  private mr(repo: RepoRef, m: Payload): PullRequest {
    return {
      repo: repoKey(repo),
      number: m.iid,
      url: m.web_url,
      title: String(m.title ?? "").replace(/^(Draft|WIP):\s*/i, ""),
      body: m.description ?? "",
      head: m.source_branch,
      base: m.target_branch,
      state: m.state === "merged" ? "merged" : m.state === "opened" ? "open" : "closed",
      draft: Boolean(m.draft ?? m.work_in_progress),
      labels: (m.labels ?? []) as string[],
      author: m.author?.username ?? "",
      mergedBy: m.merged_by?.username,
      mergedAt: m.merged_at ?? undefined,
      headSha: m.sha,
    };
  }

  cloneUrl(repo: RepoRef, token?: string) {
    const host = this.base.replace(/^https?:\/\//, "");
    return token ? `https://oauth2:${token}@${host}/${repoKey(repo)}.git` : `${this.base}/${repoKey(repo)}.git`;
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]) {
    const m = await this.api<Payload>("POST", `${this.pid(input.repo)}/merge_requests`, {
      source_branch: input.head,
      target_branch: input.base ?? "main",
      title: input.draft ? `Draft: ${input.title}` : input.title,
      description: input.body,
      labels: (input.labels ?? []).join(","),
      remove_source_branch: true,
    });
    return this.mr(input.repo, m);
  }

  async updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }) {
    const current = await this.getPullRequest(repo, number);
    const title = patch.title ?? current?.title ?? "";
    const draft = patch.draft ?? current?.draft ?? false;
    const m = await this.api<Payload>("PUT", `${this.pid(repo)}/merge_requests/${number}`, { title: draft ? `Draft: ${title}` : title, ...(patch.body !== undefined ? { description: patch.body } : {}) });
    return this.mr(repo, m);
  }

  async getPullRequest(repo: RepoRef, number: number) {
    const m = await this.api<Payload | undefined>("GET", `${this.pid(repo)}/merge_requests/${number}`);
    return m ? this.mr(repo, m) : undefined;
  }

  async listPullRequests(repo: RepoRef, filter: { state?: "open" | "closed" | "merged" | "all"; head?: string } = {}) {
    const state = { open: "opened", closed: "closed", merged: "merged", all: "all" }[filter.state ?? "open"];
    const head = filter.head ? `&source_branch=${encodeURIComponent(filter.head)}` : "";
    const list = await this.api<Payload[]>("GET", `${this.pid(repo)}/merge_requests?state=${state}${head}&per_page=100`);
    return (list ?? []).map((m) => this.mr(repo, m));
  }

  /** Comments land on the merge request with that iid, or on the issue when there is none. */
  async comment(repo: RepoRef, number: number, body: string) {
    const onMr = await this.api<Payload | undefined>("GET", `${this.pid(repo)}/merge_requests/${number}`);
    const kind = onMr ? "merge_requests" : "issues";
    const n = await this.api<{ id: number }>("POST", `${this.pid(repo)}/${kind}/${number}/notes`, { body });
    return { id: String(n.id), url: `${this.base}/${repoKey(repo)}/-/${kind}/${number}#note_${n.id}` };
  }

  /** Reply inside an existing discussion thread (how the factory answers a mention). */
  async replyInDiscussion(repo: RepoRef, mrIid: number, discussionId: string, body: string) {
    const n = await this.api<{ id: number }>("POST", `${this.pid(repo)}/merge_requests/${mrIid}/discussions/${discussionId}/notes`, { body });
    return { id: String(n.id) };
  }

  async addLabels(repo: RepoRef, number: number, labels: string[]) {
    await this.api("PUT", `${this.pid(repo)}/merge_requests/${number}`, { add_labels: labels.join(",") });
  }

  async checks(repo: RepoRef, ref: string): Promise<CheckStatus> {
    const pipelines = (await this.api<{ status: string; name?: string; ref: string }[]>("GET", `${this.pid(repo)}/pipelines?sha=${encodeURIComponent(ref)}&per_page=20`)) ?? [];
    const byRef = pipelines.length ? pipelines : ((await this.api<{ status: string; ref: string }[]>("GET", `${this.pid(repo)}/pipelines?ref=${encodeURIComponent(ref)}&per_page=1`)) ?? []);
    const runs = byRef.slice(0, 1).map((p) => ({ name: "pipeline", conclusion: p.status }));
    const s = runs[0]?.conclusion;
    return { status: !s || s === "success" || s === "skipped" ? "success" : ["failed", "canceled"].includes(s) ? "failure" : "pending", runs };
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string; labels?: string[] }): Promise<ForgeIssue> {
    const i = await this.api<Payload>("POST", `${this.pid(repo)}/issues`, { title: input.title, description: input.body, labels: (input.labels ?? []).join(",") });
    return { repo: repoKey(repo), number: i.iid, url: i.web_url, title: i.title, body: i.description ?? "", labels: i.labels ?? [], state: "open" };
  }

  async getIssue(repo: RepoRef, number: number): Promise<ForgeIssue | undefined> {
    const i = await this.api<Payload | undefined>("GET", `${this.pid(repo)}/issues/${number}`);
    return i ? { repo: repoKey(repo), number: i.iid, url: i.web_url, title: i.title, body: i.description ?? "", labels: i.labels ?? [], state: i.state === "opened" ? "open" : "closed" } : undefined;
  }

  async readTree(repo: RepoRef, ref = "main", dir = "") {
    const out: Record<string, string> = {};
    const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
    for (let page = 1; page < 50; page++) {
      const items = (await this.api<{ path: string; type: string }[]>("GET", `${this.pid(repo)}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(ref)}${dir ? `&path=${encodeURIComponent(dir)}` : ""}`)) ?? [];
      for (const item of items) {
        if (item.type !== "blob" || !item.path.startsWith(prefix)) continue;
        const res = await (this.options.fetch ?? fetch)(`${this.base}/api/v4${this.pid(repo)}/repository/files/${encodeURIComponent(item.path)}/raw?ref=${encodeURIComponent(ref)}`, { headers: { "private-token": await resolveToken(this.options.token) } });
        out[item.path.slice(prefix.length)] = await res.text();
      }
      if (items.length < 100) break;
    }
    return out;
  }

  async ensureLabel(repo: RepoRef, name: string, opts: { color?: string; description?: string } = {}) {
    const existing = await this.api<Payload | undefined>("GET", `${this.pid(repo)}/labels/${encodeURIComponent(name)}`);
    if (!existing) await this.api("POST", `${this.pid(repo)}/labels`, { name, color: `#${opts.color ?? "5319e7"}`, description: opts.description ?? "Routes mentions to a Kiln factory" });
  }

  async deleteLabel(repo: RepoRef, name: string) {
    await this.api("DELETE", `${this.pid(repo)}/labels/${encodeURIComponent(name)}`);
  }

  /** GitLab has no check runs; report as a commit status named after the check. */
  async createCheckRun(repo: RepoRef, input: CheckRunInput) {
    const state = input.status !== "completed" ? "running" : input.conclusion === "success" || input.conclusion === "neutral" ? "success" : "failed";
    const r = await this.api<{ id: number }>("POST", `${this.pid(repo)}/statuses/${input.headSha}`, { state, name: input.name, description: input.title.slice(0, 255), ...(input.detailsUrl ? { target_url: input.detailsUrl } : {}) });
    return { id: String(r?.id ?? "") };
  }

  /** A per-factory group webhook (Note, Merge Request and Push events). */
  async createGroupWebhook(group: string, input: { url: string; token: string }) {
    return this.api<{ id: number }>("POST", `/groups/${encodeURIComponent(group)}/hooks`, { url: input.url, token: input.token, note_events: true, merge_requests_events: true, push_events: true, enable_ssl_verification: true });
  }
}
