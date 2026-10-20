import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RepoRef = { owner: string; name: string; forge?: "github" | "gitlab" };
export const repoKey = (r: RepoRef) => `${r.owner}/${r.name}`;

export type PullRequest = {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  labels: string[];
  author: string;
  mergedBy?: string;
  mergedAt?: string;
  headSha?: string;
};

export type ForgeIssue = { repo: string; number: number; url: string; title: string; body: string; labels: string[]; state: "open" | "closed" };

export type CheckStatus = { status: "success" | "failure" | "pending"; runs: { name: string; conclusion: string }[] };

export interface Forge {
  readonly name: string;
  cloneUrl(repo: RepoRef, token?: string): string;
  openPullRequest(input: { repo: RepoRef; head: string; base?: string; title: string; body: string; labels?: string[]; draft?: boolean; author?: string }): Promise<PullRequest>;
  updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }): Promise<PullRequest>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest | undefined>;
  listPullRequests(repo: RepoRef, filter?: { state?: "open" | "closed" | "merged" | "all"; head?: string }): Promise<PullRequest[]>;
  comment(repo: RepoRef, number: number, body: string): Promise<{ id: string; url: string }>;
  addLabels(repo: RepoRef, number: number, labels: string[]): Promise<void>;
  checks(repo: RepoRef, ref: string): Promise<CheckStatus>;
  createIssue(repo: RepoRef, input: { title: string; body: string; labels?: string[] }): Promise<ForgeIssue>;
  getIssue(repo: RepoRef, number: number): Promise<ForgeIssue | undefined>;
  /** Read every file under `dir` at `ref`: how definition trees are pulled from config repos. */
  readTree(repo: RepoRef, ref?: string, dir?: string): Promise<Record<string, string>>;
}

const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).toString();

/**
 * A code forge backed by real bare git repositories on disk, so tests push, branch and merge
 * actual commits. Agent pushes to protected branches are rejected by a pre-receive hook, the
 * same way branch protection rejects them on GitHub.
 */
export class FakeForge implements Forge {
  readonly name = "fake";
  readonly root: string;
  readonly pulls: PullRequest[] = [];
  readonly issues: ForgeIssue[] = [];
  readonly comments: { repo: string; number: number; body: string; id: string }[] = [];
  private readonly checkStatus = new Map<string, CheckStatus>();
  private readonly counters = new Map<string, number>();
  private readonly listeners: ((e: { type: "merged" | "closed"; pr: PullRequest }) => void)[] = [];

  constructor(root?: string, private readonly protectedBranches = ["main"], private readonly persistState = false) {
    this.root = root ?? mkdtempSync(join(tmpdir(), "kiln-forge-"));
    const state = join(this.root, "forge.json");
    if (persistState && existsSync(state)) {
      const saved = JSON.parse(readFileSync(state, "utf8")) as { pulls: PullRequest[]; issues: ForgeIssue[]; comments: FakeForge["comments"]; counters: [string, number][] };
      this.pulls.push(...saved.pulls);
      this.issues.push(...saved.issues);
      this.comments.push(...saved.comments);
      for (const [k, v] of saved.counters) this.counters.set(k, v);
    }
  }

  private persist() {
    if (!this.persistState) return;
    writeFileSync(join(this.root, "forge.json"), JSON.stringify({ pulls: this.pulls, issues: this.issues, comments: this.comments, counters: [...this.counters] }));
  }

  hasRepo(repo: RepoRef) {
    return existsSync(join(this.bare(repo), "HEAD"));
  }

  listRepos(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).flatMap((owner) => {
      const dir = join(this.root, owner);
      if (!statSync(dir).isDirectory()) return [];
      return readdirSync(dir).filter((n) => n.endsWith(".git")).map((n) => `${owner}/${n.slice(0, -4)}`);
    });
  }

  onEvent(fn: (e: { type: "merged" | "closed"; pr: PullRequest }) => void) {
    this.listeners.push(fn);
  }

  private bare(repo: RepoRef) {
    return join(this.root, repo.owner, `${repo.name}.git`);
  }

  createRepo(repo: RepoRef, files: Record<string, string> = { "README.md": `# ${repo.name}\n` }): string {
    const bare = this.bare(repo);
    if (this.hasRepo(repo)) return bare;
    mkdirSync(bare, { recursive: true });
    git(bare, ["init", "-q", "--bare", "-b", "main"]);
    const hook = join(bare, "hooks", "pre-receive");
    writeFileSync(
      hook,
      `#!/bin/sh
# Branch protection: agents may only push kiln/* branches.
while read old new ref; do
  case "$KILN_PUSH_AS" in agent*)
    case "$ref" in refs/heads/kiln/*) ;; *) echo "protected: agents cannot push $ref" >&2; exit 1 ;; esac ;;
  esac
  ${this.protectedBranches.map((b) => `if [ "$ref" = "refs/heads/${b}" ] && [ "$KILN_PUSH_AS" != "human" ] && [ "$KILN_PUSH_AS" != "merge" ]; then echo "protected: $ref needs a human merge" >&2; exit 1; fi`).join("\n  ")}
done
`,
    );
    chmodSync(hook, 0o755);
    const work = mkdtempSync(join(tmpdir(), "kiln-seed-"));
    git(work, ["init", "-q", "-b", "main"]);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    git(work, ["add", "-A"]);
    git(work, ["-c", "user.name=seed", "-c", "user.email=seed@kiln.test", "commit", "-q", "-m", "initial commit"]);
    git(work, ["push", "-q", bare, "main"], { KILN_PUSH_AS: "human" });
    rmSync(work, { recursive: true, force: true });
    return bare;
  }

  cloneUrl(repo: RepoRef): string {
    return this.bare(repo);
  }

  private next(repo: string) {
    const n = (this.counters.get(repo) ?? 0) + 1;
    this.counters.set(repo, n);
    return n;
  }

  branchSha(repo: RepoRef, branch: string): string | undefined {
    try {
      return git(this.bare(repo), ["rev-parse", `refs/heads/${branch}`]).trim();
    } catch {
      return undefined;
    }
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]): Promise<PullRequest> {
    const key = repoKey(input.repo);
    const headSha = this.branchSha(input.repo, input.head);
    if (!headSha) throw new Error(`branch ${input.head} does not exist in ${key}`);
    const existing = this.pulls.find((p) => p.repo === key && p.head === input.head && p.state === "open");
    if (existing) return existing;
    const number = this.next(key);
    const pr: PullRequest = {
      repo: key,
      number,
      url: `https://forge.test/${key}/pull/${number}`,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base ?? "main",
      state: "open",
      draft: input.draft ?? false,
      labels: input.labels ?? [],
      author: input.author ?? "kiln-agent[bot]",
      headSha,
    };
    this.pulls.push(pr);
    this.persist();
    return pr;
  }

  async updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }) {
    const pr = this.pulls.find((p) => p.repo === repoKey(repo) && p.number === number);
    if (!pr) throw new Error(`no pull request ${number}`);
    Object.assign(pr, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.persist();
    return pr;
  }

  async getPullRequest(repo: RepoRef, number: number) {
    const pr = this.pulls.find((p) => p.repo === repoKey(repo) && p.number === number);
    if (pr) pr.headSha = this.branchSha(repo, pr.head) ?? pr.headSha;
    return pr;
  }

  async listPullRequests(repo: RepoRef, filter: { state?: "open" | "closed" | "merged" | "all"; head?: string } = {}) {
    return this.pulls.filter(
      (p) => p.repo === repoKey(repo) && (!filter.state || filter.state === "all" || p.state === filter.state) && (!filter.head || p.head === filter.head),
    );
  }

  async comment(repo: RepoRef, number: number, body: string) {
    const id = `c${this.comments.length + 1}`;
    this.comments.push({ repo: repoKey(repo), number, body, id });
    this.persist();
    return { id, url: `https://forge.test/${repoKey(repo)}/issues/${number}#${id}` };
  }

  async addLabels(repo: RepoRef, number: number, labels: string[]) {
    const target = this.pulls.find((p) => p.repo === repoKey(repo) && p.number === number) ?? this.issues.find((i) => i.repo === repoKey(repo) && i.number === number);
    if (target) target.labels = [...new Set([...target.labels, ...labels])];
    this.persist();
  }

  setChecks(repo: RepoRef, ref: string, status: CheckStatus) {
    this.checkStatus.set(`${repoKey(repo)}@${ref}`, status);
  }

  async checks(repo: RepoRef, ref: string): Promise<CheckStatus> {
    return this.checkStatus.get(`${repoKey(repo)}@${ref}`) ?? { status: "success", runs: [{ name: "ci", conclusion: "success" }] };
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string; labels?: string[] }) {
    const key = repoKey(repo);
    const number = this.next(key);
    const issue: ForgeIssue = { repo: key, number, url: `https://forge.test/${key}/issues/${number}`, title: input.title, body: input.body, labels: input.labels ?? [], state: "open" };
    this.issues.push(issue);
    this.persist();
    return issue;
  }

  async getIssue(repo: RepoRef, number: number) {
    return this.issues.find((i) => i.repo === repoKey(repo) && i.number === number);
  }

  async readTree(repo: RepoRef, ref = "main", dir = "") {
    const bare = this.bare(repo);
    const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
    const files = git(bare, ["ls-tree", "-r", "--name-only", ref]).split("\n").filter((f) => f && f.startsWith(prefix));
    return Object.fromEntries(files.map((f) => [f.slice(prefix.length), git(bare, ["show", `${ref}:${f}`])]));
  }

  /** A person merges a pull request; agents never can. */
  async merge(repo: RepoRef, number: number, by: string): Promise<PullRequest> {
    if (by.startsWith("kiln-agent")) throw new Error("agents cannot merge pull requests");
    const pr = await this.getPullRequest(repo, number);
    if (!pr || pr.state !== "open") throw new Error(`pull request ${number} is not open`);
    const work = mkdtempSync(join(tmpdir(), "kiln-merge-"));
    git(work, ["clone", "-q", this.bare(repo), "."]);
    git(work, ["checkout", "-q", pr.base]);
    git(work, ["-c", `user.name=${by}`, "-c", "user.email=merge@kiln.test", "merge", "-q", "--no-ff", `origin/${pr.head}`, "-m", `Merge #${number}: ${pr.title}`]);
    git(work, ["push", "-q", "origin", pr.base], { KILN_PUSH_AS: "merge" });
    rmSync(work, { recursive: true, force: true });
    pr.state = "merged";
    pr.mergedBy = by;
    pr.mergedAt = new Date().toISOString();
    for (const l of this.listeners) l({ type: "merged", pr });
    this.persist();
    return pr;
  }

  async close(repo: RepoRef, number: number): Promise<PullRequest> {
    const pr = await this.getPullRequest(repo, number);
    if (!pr) throw new Error(`no pull request ${number}`);
    pr.state = "closed";
    for (const l of this.listeners) l({ type: "closed", pr });
    this.persist();
    return pr;
  }
}

type Fetch = typeof fetch;

/** GitHub REST v3. Tokens come from the secrets broker and are scoped to kiln/* branches. */
export class GitHubForge implements Forge {
  readonly name = "github";

  constructor(private readonly options: { token: string | (() => Promise<string> | string); baseUrl?: string; fetch?: Fetch }) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(`${this.options.baseUrl ?? "https://api.github.com"}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${typeof this.options.token === "string" ? this.options.token : await this.options.token()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return undefined as T;
    if (!res.ok) throw new Error(`GitHub ${method} ${path} returned ${res.status}: ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private pr(repo: RepoRef, p: Record<string, any>): PullRequest {
    return {
      repo: repoKey(repo),
      number: p.number,
      url: p.html_url,
      title: p.title,
      body: p.body ?? "",
      head: p.head.ref,
      base: p.base.ref,
      state: p.merged_at ? "merged" : p.state,
      draft: Boolean(p.draft),
      labels: (p.labels ?? []).map((l: { name: string }) => l.name),
      author: p.user?.login ?? "",
      mergedBy: p.merged_by?.login,
      mergedAt: p.merged_at ?? undefined,
      headSha: p.head.sha,
    };
  }

  cloneUrl(repo: RepoRef, token?: string) {
    return token ? `https://x-access-token:${token}@github.com/${repoKey(repo)}.git` : `https://github.com/${repoKey(repo)}.git`;
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]) {
    const p = await this.api<Record<string, any>>("POST", `/repos/${repoKey(input.repo)}/pulls`, {
      head: input.head,
      base: input.base ?? "main",
      title: input.title,
      body: input.body,
      draft: input.draft ?? false,
    });
    if (input.labels?.length) await this.addLabels(input.repo, p.number, input.labels);
    return this.pr(input.repo, { ...p, labels: (input.labels ?? []).map((name) => ({ name })) });
  }

  async updatePullRequest(repo: RepoRef, number: number, patch: { title?: string; body?: string; draft?: boolean }) {
    return this.pr(repo, await this.api("PATCH", `/repos/${repoKey(repo)}/pulls/${number}`, patch));
  }

  async getPullRequest(repo: RepoRef, number: number) {
    const p = await this.api<Record<string, any> | undefined>("GET", `/repos/${repoKey(repo)}/pulls/${number}`);
    return p ? this.pr(repo, p) : undefined;
  }

  async listPullRequests(repo: RepoRef, filter: { state?: "open" | "closed" | "merged" | "all"; head?: string } = {}) {
    const state = filter.state === "merged" ? "closed" : (filter.state ?? "open");
    const head = filter.head ? `&head=${repo.owner}:${encodeURIComponent(filter.head)}` : "";
    const list = await this.api<Record<string, any>[]>("GET", `/repos/${repoKey(repo)}/pulls?state=${state}${head}&per_page=100`);
    return (list ?? []).map((p) => this.pr(repo, p)).filter((p) => filter.state !== "merged" || p.state === "merged");
  }

  async comment(repo: RepoRef, number: number, body: string) {
    const c = await this.api<{ id: number; html_url: string }>("POST", `/repos/${repoKey(repo)}/issues/${number}/comments`, { body });
    return { id: String(c.id), url: c.html_url };
  }

  async addLabels(repo: RepoRef, number: number, labels: string[]) {
    await this.api("POST", `/repos/${repoKey(repo)}/issues/${number}/labels`, { labels });
  }

  async checks(repo: RepoRef, ref: string): Promise<CheckStatus> {
    const r = await this.api<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(
      "GET",
      `/repos/${repoKey(repo)}/commits/${encodeURIComponent(ref)}/check-runs`,
    );
    const runs = (r?.check_runs ?? []).map((c) => ({ name: c.name, conclusion: c.conclusion ?? c.status }));
    const status = runs.some((c) => ["failure", "cancelled", "timed_out"].includes(c.conclusion))
      ? "failure"
      : runs.every((c) => ["success", "neutral", "skipped"].includes(c.conclusion))
        ? "success"
        : "pending";
    return { status, runs };
  }

  async createIssue(repo: RepoRef, input: { title: string; body: string; labels?: string[] }) {
    const i = await this.api<Record<string, any>>("POST", `/repos/${repoKey(repo)}/issues`, input);
    return { repo: repoKey(repo), number: i.number, url: i.html_url, title: i.title, body: i.body ?? "", labels: input.labels ?? [], state: "open" as const };
  }

  async getIssue(repo: RepoRef, number: number) {
    const i = await this.api<Record<string, any> | undefined>("GET", `/repos/${repoKey(repo)}/issues/${number}`);
    return i
      ? { repo: repoKey(repo), number: i.number, url: i.html_url, title: i.title, body: i.body ?? "", labels: (i.labels ?? []).map((l: { name: string }) => l.name), state: i.state }
      : undefined;
  }

  async readTree(repo: RepoRef, ref = "main", dir = "") {
    const tree = await this.api<{ tree: { path: string; type: string; sha: string }[] }>("GET", `/repos/${repoKey(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
    const out: Record<string, string> = {};
    for (const item of tree?.tree ?? []) {
      if (item.type !== "blob" || !item.path.startsWith(prefix)) continue;
      const blob = await this.api<{ content: string; encoding: string }>("GET", `/repos/${repoKey(repo)}/git/blobs/${item.sha}`);
      out[item.path.slice(prefix.length)] = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    }
    return out;
  }
}
