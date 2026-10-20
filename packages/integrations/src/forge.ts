import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ForgeKind = "github" | "gitlab" | "azure_devops" | "bitbucket";
export type RepoRef = { owner: string; name: string; forge?: ForgeKind };
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

/** One changed file of a pull request; `patch` is the unified diff from the first hunk on. */
export type PullRequestFile = { path: string; previousPath?: string; status: "added" | "modified" | "removed" | "renamed"; additions: number; deletions: number; patch?: string };

export type ReviewComment = { path: string; line: number; side?: "LEFT" | "RIGHT"; body: string };
export type ReviewInput = { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string; comments?: ReviewComment[] };

/**
 * The forge as one person, with their own token: what a review or merge started from Kiln
 * runs as, so the forge records that person. Agent identities are refused (ADR-008, ADR-010).
 */
export interface PersonForge {
  login(): Promise<string>;
  submitReview(repo: RepoRef, number: number, input: ReviewInput): Promise<{ id: string; url: string }>;
  merge(repo: RepoRef, number: number): Promise<PullRequest>;
}

export class AgentIdentityError extends Error {
  constructor(login: string) {
    super(`${login} is an agent identity; agents cannot review or merge`);
  }
}

const isAgentLogin = (login: string, type?: string) => type === "Bot" || /^kiln-agent|\[bot\]$/.test(login);

export type CheckStatus = { status: "success" | "failure" | "pending"; runs: { name: string; conclusion: string }[] };

export interface Forge {
  readonly name: string;
  cloneUrl(repo: RepoRef, token?: string): string;
  /** A short-lived credential a sandbox clones and pushes this repository with (GitHub: a repo-scoped installation token). */
  sandboxToken?(repo: RepoRef): Promise<string | undefined>;
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
  /** Create a repository label if it is missing (routing labels such as factory:<alias>). */
  ensureLabel?(repo: RepoRef, name: string, opts?: { color?: string; description?: string }): Promise<void>;
  deleteLabel?(repo: RepoRef, name: string): Promise<void>;
  /** Report a check (e.g. kiln/factory-config) on a commit. */
  createCheckRun?(repo: RepoRef, input: CheckRunInput): Promise<{ id: string }>;
  /** The changed files of a pull request, read with the forge's own identity. */
  pullRequestFiles?(repo: RepoRef, number: number): Promise<PullRequestFile[]>;
  /** Act as a person with their own token (see PersonForge). */
  asPerson?(token: string): PersonForge;
}

export type CheckRunInput = {
  name: string;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "action_required";
  title: string;
  summary: string;
  text?: string;
  detailsUrl?: string;
};

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
  readonly labels = new Map<string, Set<string>>();
  readonly checkRuns: (CheckRunInput & { repo: string; id: string })[] = [];
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

  async ensureLabel(repo: RepoRef, name: string) {
    const set = this.labels.get(repoKey(repo)) ?? new Set<string>();
    set.add(name);
    this.labels.set(repoKey(repo), set);
  }

  async deleteLabel(repo: RepoRef, name: string) {
    this.labels.get(repoKey(repo))?.delete(name);
  }

  async createCheckRun(repo: RepoRef, input: CheckRunInput) {
    const id = `check_${this.checkRuns.length + 1}`;
    this.checkRuns.push({ ...input, repo: repoKey(repo), id });
    return { id };
  }

  /** Reviews people submitted through `asPerson`, for tests. */
  readonly reviews: (ReviewInput & { repo: string; number: number; by: string; id: string })[] = [];

  /** The token `asPerson` accepts for `login`; stands in for a person's OAuth token. */
  static personToken(login: string) {
    return `fake-gh:${login}`;
  }

  async pullRequestFiles(repo: RepoRef, number: number): Promise<PullRequestFile[]> {
    const pr = await this.getPullRequest(repo, number);
    if (!pr) throw new Error(`no pull request ${number} in ${repoKey(repo)}`);
    const bare = this.bare(repo);
    const range = `refs/heads/${pr.base}...${pr.headSha ?? `refs/heads/${pr.head}`}`;
    const STATUS: Record<string, PullRequestFile["status"]> = { A: "added", M: "modified", D: "removed", R: "renamed" };
    const names = git(bare, ["diff", "--name-status", "-M", range]).trim().split("\n").filter(Boolean);
    const counts = git(bare, ["diff", "--numstat", "-M", range]).trim().split("\n").filter(Boolean);
    return names.map((line, i) => {
      const [code, a, b] = line.split("\t");
      const [add, del] = counts[i]!.split("\t");
      const path = b ?? a!;
      const patch = git(bare, ["diff", "-M", range, "--", ...(b ? [a!, b] : [a!])]);
      return {
        path,
        ...(b ? { previousPath: a } : {}),
        status: STATUS[code![0]!] ?? "modified",
        additions: Number(add) || 0,
        deletions: Number(del) || 0,
        patch: patch.slice(patch.indexOf("@@")).trimEnd(),
      };
    });
  }

  asPerson(token: string): PersonForge {
    const m = /^fake-gh:(.+)$/.exec(token);
    if (!m) throw new Error("not a token this forge issued");
    const login = m[1]!;
    const check = () => {
      if (isAgentLogin(login)) throw new AgentIdentityError(login);
    };
    return {
      login: async () => login,
      submitReview: async (repo, number, input) => {
        check();
        if (!(await this.getPullRequest(repo, number))) throw new Error(`no pull request ${number} in ${repoKey(repo)}`);
        const id = `review_${this.reviews.length + 1}`;
        this.reviews.push({ ...input, repo: repoKey(repo), number, by: login, id });
        return { id, url: `https://forge.test/${repoKey(repo)}/pull/${number}#${id}` };
      },
      merge: async (repo, number) => {
        check();
        return this.merge(repo, number, login);
      },
    };
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

  /**
   * `token` gets the request path, so an app can answer with the installation of the repository's
   * owner; `sandboxToken` mints what a sandbox clones and pushes with.
   */
  constructor(private readonly options: { token: string | ((path: string) => Promise<string> | string); sandboxToken?: (repo: RepoRef) => Promise<string>; baseUrl?: string; fetch?: Fetch }) {}

  async sandboxToken(repo: RepoRef): Promise<string | undefined> {
    if (this.options.sandboxToken) return this.options.sandboxToken(repo);
    return typeof this.options.token === "string" ? this.options.token : undefined;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(`${this.options.baseUrl ?? "https://api.github.com"}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${typeof this.options.token === "string" ? this.options.token : await this.options.token(path)}`,
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

  private readonly defaultBranches = new Map<string, string>();

  /** The repository's default branch (main, master, prod …), looked up once. */
  async defaultBranch(repo: RepoRef): Promise<string> {
    const key = repoKey(repo);
    if (!this.defaultBranches.has(key)) this.defaultBranches.set(key, (await this.api<{ default_branch?: string } | undefined>("GET", `/repos/${key}`))?.default_branch ?? "main");
    return this.defaultBranches.get(key)!;
  }

  async openPullRequest(input: Parameters<Forge["openPullRequest"]>[0]) {
    const p = await this.api<Record<string, any>>("POST", `/repos/${repoKey(input.repo)}/pulls`, {
      head: input.head,
      base: input.base ?? (await this.defaultBranch(input.repo)),
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

  async ensureLabel(repo: RepoRef, name: string, opts: { color?: string; description?: string } = {}) {
    const existing = await this.api<{ name: string } | undefined>("GET", `/repos/${repoKey(repo)}/labels/${encodeURIComponent(name)}`);
    if (existing) return;
    await this.api("POST", `/repos/${repoKey(repo)}/labels`, { name, color: opts.color ?? "5319e7", description: opts.description ?? "Routes mentions to a Kiln factory" });
  }

  async deleteLabel(repo: RepoRef, name: string) {
    await this.api("DELETE", `/repos/${repoKey(repo)}/labels/${encodeURIComponent(name)}`);
  }

  async createCheckRun(repo: RepoRef, input: CheckRunInput) {
    const r = await this.api<{ id: number }>("POST", `/repos/${repoKey(repo)}/check-runs`, {
      name: input.name,
      head_sha: input.headSha,
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title, summary: input.summary, ...(input.text ? { text: input.text } : {}) },
    });
    return { id: String(r.id) };
  }

  async pullRequestFiles(repo: RepoRef, number: number): Promise<PullRequestFile[]> {
    const out: PullRequestFile[] = [];
    // GitHub lists at most 3000 files, 100 per page.
    for (let page = 1; page <= 30; page++) {
      const list = await this.api<Record<string, any>[] | undefined>("GET", `/repos/${repoKey(repo)}/pulls/${number}/files?per_page=100&page=${page}`);
      for (const f of list ?? []) {
        out.push({
          path: f.filename,
          ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
          status: f.status === "removed" || f.status === "added" || f.status === "renamed" ? f.status : "modified",
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          ...(f.patch ? { patch: f.patch } : {}),
        });
      }
      if (!list || list.length < 100) break;
    }
    return out;
  }

  asPerson(token: string): PersonForge {
    const as = new GitHubForge({ token, baseUrl: this.options.baseUrl, fetch: this.options.fetch });
    let me: Promise<string> | undefined;
    const login = () =>
      (me ??= as.api<{ login: string; type?: string }>("GET", "/user").then((u) => {
        if (!u) throw new Error("GitHub did not accept this account's token; link GitHub again");
        if (isAgentLogin(u.login, u.type)) throw new AgentIdentityError(u.login);
        return u.login;
      }));
    return {
      login,
      submitReview: async (repo, number, input) => {
        await login();
        const r = await as.api<{ id: number; html_url: string }>("POST", `/repos/${repoKey(repo)}/pulls/${number}/reviews`, {
          event: input.event,
          ...(input.body ? { body: input.body } : {}),
          ...(input.comments?.length ? { comments: input.comments.map((c) => ({ path: c.path, line: c.line, side: c.side ?? "RIGHT", body: c.body })) } : {}),
        });
        if (!r) throw new Error(`pull request ${number} was not found in ${repoKey(repo)}`);
        return { id: String(r.id), url: r.html_url };
      },
      merge: async (repo, number) => {
        await login();
        await as.api("PUT", `/repos/${repoKey(repo)}/pulls/${number}/merge`, {});
        const pr = await as.getPullRequest(repo, number);
        if (!pr) throw new Error(`pull request ${number} was not found in ${repoKey(repo)}`);
        return pr;
      },
    };
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
