import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeForge, GitHubForge, type Forge } from "./forge";

const repo = { owner: "acme", name: "web" };

function push(forge: FakeForge, branch: string, files: Record<string, string>) {
  const work = mkdtempSync(join(tmpdir(), "kiln-clone-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: "agent:run_1" }, stdio: "pipe" });
  git("clone", "-q", forge.cloneUrl(repo), ".");
  git("checkout", "-q", "-B", branch);
  for (const [path, body] of Object.entries(files)) writeFileSync(join(work, path), body);
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "change");
  git("push", "-q", "origin", branch);
}

async function fakeWithPr() {
  const forge = new FakeForge();
  forge.createRepo(repo, { "README.md": "# web\nold line\n" });
  push(forge, "kiln/x", { "README.md": "# web\nnew line\n", "added.ts": "export const a = 1;\n" });
  const pr = await forge.openPullRequest({ repo, head: "kiln/x", title: "X", body: "" });
  return { forge, pr };
}

/** What every forge that supports review in Kiln must do. */
function contract(name: string, make: () => Promise<{ forge: Forge; number: number; person: string; agent: string }>) {
  describe(`${name}: review contract`, () => {
    it("lists the changed files with line counts and a patch", async () => {
      const { forge, number } = await make();
      const files = await forge.pullRequestFiles!(repo, number);
      const readme = files.find((f) => f.path === "README.md")!;
      expect(readme).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
      expect(readme.patch).toContain("-old line");
      expect(readme.patch).toContain("+new line");
      expect(files.find((f) => f.path === "added.ts")).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    });

    it("submits a review with line comments as the person", async () => {
      const { forge, number, person } = await make();
      const me = forge.asPerson!(person);
      const r = await me.submitReview(repo, number, { event: "REQUEST_CHANGES", body: "Please fix", comments: [{ path: "README.md", line: 2, body: "Typo" }] });
      expect(r.id).toBeTruthy();
    });

    it("merges as the person", async () => {
      const { forge, number, person } = await make();
      const pr = await forge.asPerson!(person).merge(repo, number);
      expect(pr.state).toBe("merged");
    });

    it("refuses an agent identity", async () => {
      const { forge, number, agent } = await make();
      await expect(forge.asPerson!(agent).merge(repo, number)).rejects.toThrow(/agent/);
      await expect(forge.asPerson!(agent).submitReview(repo, number, { event: "APPROVE" })).rejects.toThrow(/agent/);
    });
  });
}

contract("fake forge", async () => {
  const { forge, pr } = await fakeWithPr();
  return { forge, number: pr.number, person: FakeForge.personToken("alice"), agent: FakeForge.personToken("kiln-agent[bot]") };
});

contract("github forge", async () => {
  const seen: { url: string; method: string; auth: string; body?: unknown }[] = [];
  const pull = {
    number: 7,
    html_url: "https://github.com/acme/web/pull/7",
    title: "T",
    body: "",
    head: { ref: "kiln/x", sha: "abc" },
    base: { ref: "main" },
    state: "open",
    user: { login: "kiln[bot]" },
  };
  let merged = false;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = String((init.headers as Record<string, string>).authorization);
    const path = new URL(url).pathname;
    seen.push({ url, method, auth, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === "/user") return json({ login: auth === "Bearer agent" ? "kiln-agent[bot]" : "alice", type: auth === "Bearer agent" ? "Bot" : "User" });
    if (path.endsWith("/pulls/7/files"))
      return json([
        { filename: "README.md", status: "modified", additions: 1, deletions: 1, patch: "@@ -1,2 +1,2 @@\n # web\n-old line\n+new line" },
        { filename: "added.ts", status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+export const a = 1;" },
      ]);
    if (path.endsWith("/pulls/7/reviews")) return json({ id: 99, html_url: "https://github.com/acme/web/pull/7#pullrequestreview-99" });
    if (path.endsWith("/pulls/7/merge")) {
      merged = true;
      return json({ merged: true });
    }
    if (path.endsWith("/pulls/7")) return json({ ...pull, ...(merged ? { merged_at: "2026-10-20T10:00:00Z", merged_by: { login: "alice" } } : {}) });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { forge: new GitHubForge({ token: "app", fetch }), number: 7, person: "person", agent: "agent" };
});

describe("github forge: whose token", () => {
  it("reads files with the app token and reviews with the person's", async () => {
    const seen: string[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      seen.push(`${init.method ?? "GET"} ${new URL(url).pathname} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(
        JSON.stringify(new URL(url).pathname === "/user" ? { login: "alice", type: "User" } : url.includes("/files") ? [] : { id: 1, html_url: "u" }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;
    const gh = new GitHubForge({ token: "app", fetch });
    await gh.pullRequestFiles(repo, 7);
    await gh.asPerson("person").submitReview(repo, 7, { event: "APPROVE", body: "LGTM" });
    expect(seen).toEqual(["GET /repos/acme/web/pulls/7/files Bearer app", "GET /user Bearer person", "POST /repos/acme/web/pulls/7/reviews Bearer person"]);
  });
});

describe("fake forge reviews", () => {
  it("records reviews so tests can assert on them", async () => {
    const { forge, pr } = await fakeWithPr();
    await forge.asPerson(FakeForge.personToken("alice")).submitReview(repo, pr.number, { event: "APPROVE", body: "LGTM" });
    expect(forge.reviews).toEqual([expect.objectContaining({ repo: "acme/web", number: pr.number, by: "alice", event: "APPROVE", body: "LGTM" })]);
  });

  it("rejects a token it did not issue", () => {
    expect(() => new FakeForge().asPerson("nope")).toThrow(/token/);
  });
});
