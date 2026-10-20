import { mentionsIn, uniq, type IncomingEvent } from "./events";
import { repoKey, type CheckStatus, type Forge, type ForgeIssue, type PullRequest, type RepoRef } from "./forge";
import { hmacHex, jsonRequest, resolveToken, safeEqual, type Fetch } from "./http";

type Payload = Record<string, any>;

/** Bitbucket Cloud webhooks with a secret send `X-Hub-Signature: sha256=<hex hmac of body>`. */
export function verifyBitbucket(secret: string, body: string, signature: string | undefined): boolean {
  return Boolean(signature) && safeEqual(`sha256=${hmacHex("sha256", secret, body)}`, signature!);
}

/** pullrequest:created → pull_request_created, pullrequest:comment_created → pull_request_commented, repo:push → push. */
export function normalizeBitbucket(eventKey: string, payload: Payload, deliveryId?: string, options: { selfAccounts?: string[] } = {}): IncomingEvent | undefined {
  const repo = payload.repository?.full_name as string | undefined;
  const actor = (payload.actor?.nickname ?? payload.actor?.username ?? payload.actor?.display_name) as string | undefined;
  const isSelf = Boolean(actor && (options.selfAccounts ?? []).some((a) => a.toLowerCase() === actor.toLowerCase()));
  const common = { repo, repos: repo ? [repo] : [], author: actor, authorIsSelf: isSelf, authorIsBot: isSelf || payload.actor?.type === "app_user" };
  const pr = payload.pullrequest ?? {};
  const prData = { number: pr.id, title: pr.title, body: pr.description ?? "", url: pr.links?.html?.href, base: pr.destination?.branch?.name, head: pr.source?.branch?.name, branch: pr.source?.branch?.name };
  if (eventKey === "pullrequest:created") return { provider: "bitbucket", event: "pull_request_created", deliveryId, data: { ...common, ...prData } };
  if (eventKey === "pullrequest:comment_created") {
    const text = payload.comment?.content?.raw as string | undefined;
    return { provider: "bitbucket", event: "pull_request_commented", deliveryId, data: { ...common, ...prData, text, mentioned: mentionsIn(text) } };
  }
  if (eventKey === "repo:push") {
    const change = payload.push?.changes?.[0] ?? {};
    const branch = change.new?.name as string | undefined;
    return { provider: "bitbucket", event: "push", deliveryId, data: { ...common, branch, head: branch, sha: change.new?.target?.hash, title: `push to ${branch}`, branches: uniq(((payload.push?.changes ?? []) as Payload[]).map((c) => c.new?.name)) } };
  }
  return undefined;
}

/**
 * Bitbucket Cloud REST 2.0. `owner` is the workspace. Auth is an access token (bearer) or
 * `user:app-password` (basic). Bitbucket has no labels; addLabels is a no-op.
 */
export class BitbucketForge implements Forge {
  readonly name = "bitbucket";

  constructor(private readonly options: { token: string | (() => Promise<string> | string); username?: string; baseUrl?: string; fetch?: Fetch }) {}

  private async headers() {
    const t = await resolveToken(this.options.token);
    return { authorization: this.options.username ? `Basic ${Buffer.from(`${this.options.username}:${t}`).toString("base64")}` : `Bearer ${t}` };
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>("Bitbucket", this.options.fetch ?? fetch, method, `${this.options.baseUrl ?? "https://api.bitbucket.org/2.0"}${path}`, await this.headers(), body);
  }

  private path(repo: RepoRef) {
    return `/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  private pr(repo: RepoRef, p: Payload): PullRequest {
    return {
      repo: repoKey(repo),
      number: p.id,
      url: p.links?.html?.href,
      title: p.title,
      body: p.description ?? "",
      head: p.source?.branch?.name,
      base: p.destination?.branch?.name,
      state: p.state === "MERGED" ? "merged" : p.state === "OPEN" ? "open" : "closed",
      draft: Boolean(p.draft),
      labels: [],
      author: p.author?.nickname ?? "",
      mergedBy: p.closed_by?.nickname,
      headSha: p.source?.commit?.hash,
    };
  }

  cloneUrl(repo: RepoRef, token?: string) {
    return token ? `https://x-token-auth:${token}@bitbucket.org/${repoKey(repo)}.git` : `https://bitbucket.org/${repoKey(repo)}.git`;
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]) {
    const p = await this.api<Payload>("POST", `${this.path(input.repo)}/pullrequests`, {
      title: input.title,
      description: input.body,
      source: { branch: { name: input.head } },
      destination: { branch: { name: input.base ?? "main" } },
      draft: input.draft ?? false,
      close_source_branch: true,
    });
    return this.pr(input.repo, p);
  }

  async updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }) {
    const p = await this.api<Payload>("PUT", `${this.path(repo)}/pullrequests/${number}`, { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.body !== undefined ? { description: patch.body } : {}), ...(patch.draft !== undefined ? { draft: patch.draft } : {}) });
    return this.pr(repo, p);
  }

  async getPullRequest(repo: RepoRef, number: number) {
    const p = await this.api<Payload | undefined>("GET", `${this.path(repo)}/pullrequests/${number}`);
    return p ? this.pr(repo, p) : undefined;
  }

  async listPullRequests(repo: RepoRef, filter: { state?: "open" | "closed" | "merged" | "all"; head?: string } = {}) {
    const states = { open: ["OPEN"], closed: ["DECLINED", "SUPERSEDED"], merged: ["MERGED"], all: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] }[filter.state ?? "open"];
    const q = states.map((s) => `state=${s}`).join("&");
    const r = await this.api<{ values: Payload[] }>("GET", `${this.path(repo)}/pullrequests?${q}&pagelen=50`);
    return (r?.values ?? []).map((p) => this.pr(repo, p)).filter((p) => !filter.head || p.head === filter.head);
  }

  async comment(repo: RepoRef, number: number, body: string) {
    const c = await this.api<Payload>("POST", `${this.path(repo)}/pullrequests/${number}/comments`, { content: { raw: body } });
    return { id: String(c.id), url: c.links?.html?.href ?? "" };
  }

  async addLabels() {
    /* Bitbucket pull requests have no labels. */
  }

  async checks(repo: RepoRef, ref: string): Promise<CheckStatus> {
    const r = await this.api<{ values: { key: string; state: string }[] }>("GET", `${this.path(repo)}/commit/${encodeURIComponent(ref)}/statuses`);
    const runs = (r?.values ?? []).map((s) => ({ name: s.key, conclusion: s.state }));
    const status = runs.some((x) => ["FAILED", "STOPPED"].includes(x.conclusion)) ? "failure" : runs.every((x) => x.conclusion === "SUCCESSFUL") ? "success" : "pending";
    return { status, runs };
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string }): Promise<ForgeIssue> {
    const i = await this.api<Payload>("POST", `${this.path(repo)}/issues`, { title: input.title, content: { raw: input.body } });
    return { repo: repoKey(repo), number: i.id, url: i.links?.html?.href, title: i.title, body: input.body, labels: [], state: "open" };
  }

  async getIssue(repo: RepoRef, number: number): Promise<ForgeIssue | undefined> {
    const i = await this.api<Payload | undefined>("GET", `${this.path(repo)}/issues/${number}`);
    return i ? { repo: repoKey(repo), number: i.id, url: i.links?.html?.href, title: i.title, body: i.content?.raw ?? "", labels: [], state: ["resolved", "closed", "invalid", "wontfix"].includes(i.state) ? "closed" : "open" } : undefined;
  }

  async readTree(repo: RepoRef, ref = "main", dir = "") {
    const out: Record<string, string> = {};
    const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
    const walk = async (path: string) => {
      let next: string | undefined = `${this.path(repo)}/src/${encodeURIComponent(ref)}/${path}?pagelen=100`;
      while (next) {
        const page: { values: { path: string; type: string }[]; next?: string } | undefined = await this.api("GET", next.replace(this.options.baseUrl ?? "https://api.bitbucket.org/2.0", ""));
        for (const item of page?.values ?? []) {
          if (item.type === "commit_directory") await walk(`${item.path}/`);
          else if (item.type === "commit_file") {
            const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl ?? "https://api.bitbucket.org/2.0"}${this.path(repo)}/src/${encodeURIComponent(ref)}/${item.path}`, { headers: await this.headers() });
            out[item.path.slice(prefix.length)] = await res.text();
          }
        }
        next = page?.next;
      }
    };
    await walk(prefix);
    return out;
  }
}
