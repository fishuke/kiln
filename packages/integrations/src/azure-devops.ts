import { mentionsIn, uniq, type IncomingEvent } from "./events";
import { repoKey, type CheckStatus, type Forge, type ForgeIssue, type PullRequest, type RepoRef } from "./forge";
import { jsonRequest, resolveToken, safeEqual, type Fetch } from "./http";

type Payload = Record<string, any>;

/** Service hooks authenticate with HTTP basic auth that you set on the subscription. */
export function verifyAzureDevOps(expected: { username?: string; password: string }, authorization: string | undefined): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":");
  const pass = rest.join(":");
  return safeEqual(pass, expected.password) && (!expected.username || user === expected.username);
}

export type AzureDevOpsNormalizeOptions = {
  /** Display names, unique names (emails) or ids of the factory identities; mentions and assignments to them route work. */
  identities?: string[];
};

const stripRef = (r: string | undefined) => (r ?? "").replace(/^refs\/heads\//, "");
const who = (u: Payload | string | undefined): string | undefined => (typeof u === "string" ? u.replace(/\s*<.*>$/, "") : (u?.uniqueName ?? u?.displayName));

/** ADO mentions are `@<GUID>` (or `<at id="…">`); plain `@name` text is accepted too. */
function adoMentions(text: string | undefined): string[] {
  const t = text ?? "";
  return uniq([...[...t.matchAll(/@<([0-9a-f-]{36})>/gi)].map((m) => m[1]!.toLowerCase()), ...[...t.matchAll(/<at[^>]*id="([^"]+)"/gi)].map((m) => m[1]!.toLowerCase()), ...mentionsIn(t.replace(/@<[^>]+>/g, ""))]);
}

/**
 * Service hook events → automation events: git.pullrequest.created/updated/merged, pull request
 * comments (and mentions of the factory identity), git.push, workitem.created/updated/commented.
 */
export function normalizeAzureDevOps(payload: Payload, deliveryId = payload.id as string | undefined, options: AzureDevOpsNormalizeOptions = {}): IncomingEvent[] {
  const ids = new Set((options.identities ?? []).map((i) => i.toLowerCase()));
  const r = payload.resource ?? {};
  const type = String(payload.eventType ?? "");
  const out: IncomingEvent[] = [];
  const ev = (event: string, data: IncomingEvent["data"]) => out.push({ provider: "azure_devops", event, deliveryId, data });
  const isFactory = (x: string | undefined) => Boolean(x) && (ids.has(x!.toLowerCase()) || [...ids].some((i) => x!.toLowerCase().includes(i)));

  if (type.startsWith("git.pullrequest") || type === "ms.vss-code.git-pullrequest-comment-event") {
    const pr = type === "ms.vss-code.git-pullrequest-comment-event" ? (r.pullRequest ?? {}) : r;
    const repo = pr.repository ? `${pr.repository.project?.name}/${pr.repository.name}` : undefined;
    const base = {
      repo,
      repos: repo ? [repo] : [],
      number: pr.pullRequestId,
      title: pr.title,
      body: pr.description ?? "",
      url: pr._links?.web?.href ?? pr.url,
      base: stripRef(pr.targetRefName),
      head: stripRef(pr.sourceRefName),
      branch: stripRef(pr.sourceRefName),
      source_repo: pr.forkSource?.repository?.name ? `${pr.forkSource.repository.project?.name ?? pr.repository?.project?.name}/${pr.forkSource.repository.name}` : repo,
      labels: ((pr.labels ?? []) as { name: string }[]).map((l) => l.name),
      author: who(pr.createdBy),
    };
    if (type === "git.pullrequest.created") ev("pull_request_created", base);
    else if (type === "git.pullrequest.merged" || (type === "git.pullrequest.updated" && pr.status === "completed")) ev("pull_request_merged", { ...base, merged: true });
    else if (type === "git.pullrequest.updated" && pr.status === "abandoned") ev("pull_request_closed", base);
    else if (type === "git.pullrequest.updated") ev("pull_request_updated", base);
    else if (type === "ms.vss-code.git-pullrequest-comment-event") {
      const c = r.comment ?? {};
      const mentioned = adoMentions(c.content);
      const extra = { text: c.content, author: who(c.author), mentioned, threadId: r.comment?._links?.threads?.href };
      ev("pull_request_commented", { ...base, ...extra });
      if (mentioned.some(isFactory) || (ids.size === 0 && mentioned.length)) ev("pull_request_mentioned", { ...base, ...extra });
    }
    return out;
  }
  if (type === "git.push") {
    const repo = r.repository ? `${r.repository.project?.name}/${r.repository.name}` : undefined;
    const branch = stripRef(r.refUpdates?.[0]?.name);
    ev("push", { repo, repos: repo ? [repo] : [], branch, head: branch, sha: r.refUpdates?.[0]?.newObjectId, author: who(r.pushedBy), title: `push to ${branch}` });
    return out;
  }
  if (type.startsWith("workitem.")) {
    const fields = (r.revision?.fields ?? r.fields ?? {}) as Record<string, any>;
    const val = (f: string) => (typeof fields[f] === "object" && fields[f] !== null && "newValue" in fields[f] ? fields[f].newValue : fields[f]);
    const id = r.workItemId ?? r.id;
    const assigned = who(val("System.AssignedTo"));
    const base = {
      issueId: String(id),
      number: id,
      title: val("System.Title"),
      body: String(val("System.Description") ?? "").replace(/<[^>]+>/g, " "),
      url: r._links?.html?.href ?? r.url,
      repo: val("System.TeamProject"),
      work_item_type: val("System.WorkItemType"),
      labels: String(val("System.Tags") ?? "").split(";").map((s) => s.trim()).filter(Boolean),
      assignees: uniq([assigned]),
      author: who(val("System.CreatedBy")) ?? who(r.revisedBy),
    };
    const changed = (f: string) => Boolean(r.fields && f in r.fields);
    if (type === "workitem.created") {
      ev("work_item_created", base);
      if (isFactory(assigned)) ev("work_item_assigned", base);
    } else if (type === "workitem.updated") {
      if (changed("System.AssignedTo")) ev("work_item_assigned", base);
      if (changed("System.Tags")) ev("work_item_labeled", base);
    } else if (type === "workitem.commented") {
      const text = String(r.fields?.["System.History"] ?? payload.message?.text ?? "");
      const mentioned = adoMentions(text);
      if (mentioned.some(isFactory) || (ids.size === 0 && mentioned.length)) ev("work_item_mentioned", { ...base, text: text.replace(/<[^>]+>/g, " "), mentioned });
    }
    return out;
  }
  return out;
}

/**
 * Azure DevOps Services REST 7.1. A repository is `{ owner: <project>, name: <repo> }` within the
 * configured organization. Auth is a PAT (basic) or an Entra access token (bearer).
 */
export class AzureDevOpsForge implements Forge {
  readonly name = "azure_devops";

  constructor(private readonly options: { organization: string; token: string | (() => Promise<string> | string); auth?: "pat" | "bearer"; baseUrl?: string; fetch?: Fetch }) {}

  private get base() {
    return `${(this.options.baseUrl ?? "https://dev.azure.com").replace(/\/$/, "")}/${this.options.organization}`;
  }

  private async headers() {
    const t = await resolveToken(this.options.token);
    return { authorization: this.options.auth === "bearer" ? `Bearer ${t}` : `Basic ${Buffer.from(`:${t}`).toString("base64")}` };
  }

  private async api<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    return jsonRequest<T>("Azure DevOps", this.options.fetch ?? fetch, method, `${this.base}${path}${sep}api-version=7.1`, await this.headers(), body, contentType);
  }

  private repoPath(repo: RepoRef) {
    return `/${encodeURIComponent(repo.owner)}/_apis/git/repositories/${encodeURIComponent(repo.name)}`;
  }

  private pr(repo: RepoRef, p: Payload): PullRequest {
    return {
      repo: repoKey(repo),
      number: p.pullRequestId,
      url: `${this.base}/${encodeURIComponent(repo.owner)}/_git/${encodeURIComponent(repo.name)}/pullrequest/${p.pullRequestId}`,
      title: p.title,
      body: p.description ?? "",
      head: stripRef(p.sourceRefName),
      base: stripRef(p.targetRefName),
      state: p.status === "completed" ? "merged" : p.status === "abandoned" ? "closed" : "open",
      draft: Boolean(p.isDraft),
      labels: ((p.labels ?? []) as { name: string }[]).map((l) => l.name),
      author: p.createdBy?.uniqueName ?? "",
      mergedBy: p.closedBy?.uniqueName,
      mergedAt: p.closedDate,
      headSha: p.lastMergeSourceCommit?.commitId,
    };
  }

  cloneUrl(repo: RepoRef, token?: string) {
    const host = (this.options.baseUrl ?? "https://dev.azure.com").replace(/^https?:\/\//, "");
    const path = `${this.options.organization}/${encodeURIComponent(repo.owner)}/_git/${encodeURIComponent(repo.name)}`;
    return token ? `https://kiln:${token}@${host}/${path}` : `https://${host}/${path}`;
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]) {
    const p = await this.api<Payload>("POST", `${this.repoPath(input.repo)}/pullrequests`, {
      sourceRefName: `refs/heads/${input.head}`,
      targetRefName: `refs/heads/${input.base ?? "main"}`,
      title: input.title,
      description: input.body.slice(0, 4000),
      isDraft: input.draft ?? false,
      labels: (input.labels ?? []).map((name) => ({ name })),
    });
    return this.pr(input.repo, p);
  }

  async updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }) {
    const p = await this.api<Payload>("PATCH", `${this.repoPath(repo)}/pullrequests/${number}`, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { description: patch.body.slice(0, 4000) } : {}),
      ...(patch.draft !== undefined ? { isDraft: patch.draft } : {}),
    });
    return this.pr(repo, p);
  }

  async getPullRequest(repo: RepoRef, number: number) {
    const p = await this.api<Payload | undefined>("GET", `${this.repoPath(repo)}/pullrequests/${number}`);
    return p ? this.pr(repo, p) : undefined;
  }

  async listPullRequests(repo: RepoRef, filter: { state?: "open" | "closed" | "merged" | "all"; head?: string } = {}) {
    const status = { open: "active", closed: "abandoned", merged: "completed", all: "all" }[filter.state ?? "open"];
    const head = filter.head ? `&searchCriteria.sourceRefName=${encodeURIComponent(`refs/heads/${filter.head}`)}` : "";
    const r = await this.api<{ value: Payload[] }>("GET", `${this.repoPath(repo)}/pullrequests?searchCriteria.status=${status}${head}`);
    return (r?.value ?? []).map((p) => this.pr(repo, p));
  }

  async comment(repo: RepoRef, number: number, body: string) {
    const t = await this.api<{ id: number }>("POST", `${this.repoPath(repo)}/pullRequests/${number}/threads`, { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 });
    return { id: String(t.id), url: `${this.base}/${encodeURIComponent(repo.owner)}/_git/${encodeURIComponent(repo.name)}/pullrequest/${number}?discussionId=${t.id}` };
  }

  /** Comment on a work item (Boards). */
  async commentOnWorkItem(project: string, id: number, text: string) {
    const url = `${this.base}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`;
    return jsonRequest<{ id: number }>("Azure DevOps", this.options.fetch ?? fetch, "POST", url, await this.headers(), { text });
  }

  async addLabels(repo: RepoRef, number: number, labels: string[]) {
    for (const name of labels) await this.api("POST", `${this.repoPath(repo)}/pullRequests/${number}/labels`, { name });
  }

  async checks(repo: RepoRef, ref: string): Promise<CheckStatus> {
    const r = await this.api<{ value: { state: string; context: { name: string } }[] }>("GET", `${this.repoPath(repo)}/commits/${encodeURIComponent(ref)}/statuses?latestOnly=true`);
    const runs = (r?.value ?? []).map((s) => ({ name: s.context.name, conclusion: s.state }));
    const status = runs.some((x) => ["failed", "error"].includes(x.conclusion)) ? "failure" : runs.every((x) => ["succeeded", "notApplicable"].includes(x.conclusion)) ? "success" : "pending";
    return { status, runs };
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string; labels?: string[] }): Promise<ForgeIssue> {
    const ops = [
      { op: "add", path: "/fields/System.Title", value: input.title },
      { op: "add", path: "/fields/System.Description", value: input.body },
      ...(input.labels?.length ? [{ op: "add", path: "/fields/System.Tags", value: input.labels.join("; ") }] : []),
    ];
    const w = await this.api<Payload>("POST", `/${encodeURIComponent(repo.owner)}/_apis/wit/workitems/$Task`, ops, "application/json-patch+json");
    return { repo: repoKey(repo), number: w.id, url: w._links?.html?.href ?? w.url, title: input.title, body: input.body, labels: input.labels ?? [], state: "open" };
  }

  async getIssue(repo: RepoRef, number: number): Promise<ForgeIssue | undefined> {
    const w = await this.api<Payload | undefined>("GET", `/_apis/wit/workitems/${number}`);
    if (!w) return undefined;
    const f = w.fields ?? {};
    return { repo: repoKey(repo), number: w.id, url: w._links?.html?.href ?? w.url, title: f["System.Title"], body: f["System.Description"] ?? "", labels: String(f["System.Tags"] ?? "").split(";").map((s: string) => s.trim()).filter(Boolean), state: ["Closed", "Done", "Removed"].includes(f["System.State"]) ? "closed" : "open" };
  }

  async readTree(repo: RepoRef, ref = "main", dir = "") {
    const scope = `/${dir.replace(/^\/|\/$/g, "")}`;
    const list = await this.api<{ value: { path: string; isFolder?: boolean }[] }>("GET", `${this.repoPath(repo)}/items?recursionLevel=Full&scopePath=${encodeURIComponent(scope)}&versionDescriptor.version=${encodeURIComponent(ref)}`);
    const out: Record<string, string> = {};
    const prefix = scope === "/" ? "/" : `${scope}/`;
    for (const item of list?.value ?? []) {
      if (item.isFolder || !item.path.startsWith(prefix)) continue;
      const res = await (this.options.fetch ?? fetch)(`${this.base}${this.repoPath(repo)}/items?path=${encodeURIComponent(item.path)}&versionDescriptor.version=${encodeURIComponent(ref)}&$format=text&api-version=7.1`, { headers: await this.headers() });
      out[item.path.slice(prefix.length)] = await res.text();
    }
    return out;
  }
}
