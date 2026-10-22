import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeForge, GitHubForge, RepositoryExistsError, type Forge } from "./forge";

/** What every forge that Studio ships to must do: create an empty repository and close a pull request. */
function contract(name: string, make: () => { forge: Forge; seed: (owner: string, name: string) => Promise<number> }) {
  describe(`${name}: studio contract`, () => {
    it("creates an empty private repository and returns where it is", async () => {
      const { forge } = make();
      const created = await forge.createRepository!({ owner: "acme", name: "daily-done-3f9a1c", private: true });
      expect(created.repo).toMatchObject({ owner: "acme", name: "daily-done-3f9a1c" });
      expect(created.url).toContain("acme/daily-done-3f9a1c");
    });

    it("refuses a name that is taken", async () => {
      const { forge } = make();
      await forge.createRepository!({ owner: "acme", name: "taken", private: true });
      await expect(forge.createRepository!({ owner: "acme", name: "taken", private: true })).rejects.toBeInstanceOf(RepositoryExistsError);
    });

    it("closes a pull request", async () => {
      const { forge, seed } = make();
      const number = await seed("acme", "web");
      const pr = await forge.closePullRequest!({ owner: "acme", name: "web" }, number);
      expect(pr.state).toBe("closed");
    });
  });
}

const commit = (work: string, git: (...a: string[]) => unknown) => {
  writeFileSync(join(work, "a.txt"), "a\n");
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "a");
};

contract("fake forge", () => {
  const forge = new FakeForge();
  return {
    forge,
    seed: async (owner, name) => {
      const repo = { owner, name };
      forge.createRepo(repo);
      const work = mkdtempSync(join(tmpdir(), "kiln-clone-"));
      const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: "agent:run_1" }, stdio: "pipe" });
      git("clone", "-q", forge.cloneUrl(repo), ".");
      git("checkout", "-q", "-b", "kiln/x");
      commit(work, git);
      git("push", "-q", "origin", "kiln/x");
      return (await forge.openPullRequest({ repo, head: "kiln/x", title: "X", body: "" })).number;
    },
  };
});

/** A small GitHub emulator: repositories by full name and one pull request. */
function github() {
  const repos = new Set<string>();
  const orgs = new Set(["acme"]);
  const seen: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let pull = {
    number: 7,
    html_url: "https://github.com/acme/web/pull/7",
    title: "T",
    body: "",
    head: { ref: "studio/x", sha: "abc" },
    base: { ref: "main" },
    state: "open",
    user: { login: "kiln[bot]" },
  };
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    seen.push({ method, path, ...(body ? { body } : {}) });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    const create = (owner: string) => {
      const full = `${owner}/${String(body!.name)}`;
      if (repos.has(full))
        return json({ message: "Repository creation failed.", errors: [{ field: "name", message: "name already exists on this account" }] }, 422);
      repos.add(full);
      return json({ full_name: full, name: body!.name, owner: { login: owner }, html_url: `https://github.com/${full}`, default_branch: "main" }, 201);
    };
    const org = /^\/orgs\/([^/]+)\/repos$/.exec(path);
    if (method === "POST" && org) return orgs.has(org[1]!) ? create(org[1]!) : new Response("not found", { status: 404 });
    if (method === "POST" && path === "/user/repos") return create("me");
    if (method === "PATCH" && path === "/repos/acme/web/pulls/7") {
      pull = { ...pull, state: String(body!.state) };
      return json(pull);
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { forge: new GitHubForge({ token: "app", fetch }), seen };
}

contract("github forge", () => ({ forge: github().forge, seed: async () => 7 }));

describe("github forge: repositories", () => {
  it("creates an empty private repository in the organization", async () => {
    const { forge, seen } = github();
    await forge.createRepository({ owner: "acme", name: "app", private: true, description: "Kiln Studio app" });
    expect(seen).toEqual([
      { method: "POST", path: "/orgs/acme/repos", body: { name: "app", private: true, auto_init: false, description: "Kiln Studio app" } },
    ]);
  });

  it("creates the repository on the token's own account when the owner is not an organization", async () => {
    const { forge, seen } = github();
    const created = await forge.createRepository({ owner: "me", name: "app", private: true });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /orgs/me/repos", "POST /user/repos"]);
    expect(created.repo).toEqual({ owner: "me", name: "app", forge: "github" });
  });

  it("closes a pull request by setting its state", async () => {
    const { forge, seen } = github();
    await forge.closePullRequest({ owner: "acme", name: "web" }, 7);
    expect(seen).toEqual([{ method: "PATCH", path: "/repos/acme/web/pulls/7", body: { state: "closed" } }]);
  });
});

describe("fake forge: repositories", () => {
  it("accepts a push of main to a repository it created (no branch protection yet)", async () => {
    const forge = new FakeForge();
    const { repo } = await forge.createRepository({ owner: "acme", name: "app", private: true });
    const work = mkdtempSync(join(tmpdir(), "kiln-push-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: work, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    commit(work, git);
    git("push", "-q", forge.cloneUrl(repo), "main:refs/heads/main");
    expect(forge.branchSha(repo, "main")).toBeTruthy();
  });
});
