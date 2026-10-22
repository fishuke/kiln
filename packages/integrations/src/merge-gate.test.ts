import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeForge, GitHubForge, type Forge } from "./forge";
import { FakeGateMerger, GateMergeConflict, GitHubGateMerger, type GateMerger } from "./merge-gate";

const repo = { owner: "acme", name: "web" };

function push(forge: FakeForge, branch: string, files: Record<string, string>) {
  const work = mkdtempSync(join(tmpdir(), "kiln-clone-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: "human" }, stdio: "pipe" });
  git("clone", "-q", forge.cloneUrl(repo), ".");
  git("checkout", "-q", "-B", branch);
  if (git("ls-remote", "origin", `refs/heads/${branch}`).toString().trim()) git("reset", "-q", "--hard", `origin/${branch}`);
  for (const [path, body] of Object.entries(files)) writeFileSync(join(work, path), body);
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "change");
  git("push", "-q", "origin", branch);
}

type Setup = { merger: GateMerger; forge: Forge; number: number; headSha: string; moveHead: () => Promise<void>; closePr: () => Promise<void> };

/** What every merge gate implementation must do. */
function contract(name: string, make: () => Promise<Setup>) {
  describe(`${name}: merge gate contract`, () => {
    it("merges the pull request at the head the gate checked", async () => {
      const { merger, number, headSha } = await make();
      const pr = await merger.merge({ repo, number, expectedHeadSha: headSha, title: "Change the heading" });
      expect(pr).toMatchObject({ number, state: "merged", mergedBy: merger.identity });
    });

    it("refuses when the head moved after the decision", async () => {
      const { merger, number, headSha, moveHead } = await make();
      await moveHead();
      await expect(merger.merge({ repo, number, expectedHeadSha: headSha, title: "T" })).rejects.toBeInstanceOf(GateMergeConflict);
    });

    it("refuses a pull request that is not open", async () => {
      const { merger, number, headSha, closePr } = await make();
      await closePr();
      await expect(merger.merge({ repo, number, expectedHeadSha: headSha, title: "T" })).rejects.toBeInstanceOf(GateMergeConflict);
    });
  });
}

contract("fake forge", async () => {
  const forge = new FakeForge();
  forge.createRepo(repo, { "README.md": "# web\n" });
  push(forge, "studio/sa_1", { "page.tsx": "export const h = 'Welcome back';\n" });
  const pr = await forge.openPullRequest({ repo, head: "studio/sa_1", title: "Heading", body: "" });
  return {
    merger: new FakeGateMerger(forge),
    forge,
    number: pr.number,
    headSha: pr.headSha!,
    moveHead: async () => push(forge, "studio/sa_1", { "page.tsx": "export const h = 'Hi';\n" }),
    closePr: async () => {
      await forge.close(repo, pr.number);
    },
  };
});

contract("github", async () => {
  const state = { head: "abc", open: true, merged: false };
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (method === "PUT" && path === "/repos/acme/web/pulls/7/merge") {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer gate");
      const body = JSON.parse(String(init.body)) as { sha: string; merge_method: string; commit_title: string };
      expect(body).toMatchObject({ merge_method: "merge", commit_title: expect.stringContaining("#7") });
      if (!state.open) return json({ message: "Pull Request is not mergeable" }, 405);
      if (body.sha !== state.head) return json({ message: "Head branch was modified. Review and try the merge again." }, 409);
      state.merged = true;
      return json({ merged: true, sha: "m1" });
    }
    if (method === "GET" && path === "/repos/acme/web/pulls/7")
      return json({
        number: 7,
        html_url: "https://github.com/acme/web/pull/7",
        title: "Heading",
        body: "",
        head: { ref: "studio/sa_1", sha: state.head },
        base: { ref: "main" },
        state: state.open && !state.merged ? "open" : "closed",
        user: { login: "ana" },
        ...(state.merged ? { merged_at: "2026-10-22T10:00:00Z", merged_by: { login: "kiln-merge-gate" } } : {}),
      });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return {
    merger: new GitHubGateMerger({ token: "gate", identity: "kiln-merge-gate", fetch }),
    forge: new GitHubForge({ token: "app", fetch }),
    number: 7,
    headSha: "abc",
    moveHead: async () => {
      state.head = "def";
    },
    closePr: async () => {
      state.open = false;
    },
  };
});

describe("GitHub merge gate errors", () => {
  it("reports a GitHub error that is not a merge conflict as it is", async () => {
    const fetch = (async () => new Response("bad credentials", { status: 401 })) as unknown as typeof globalThis.fetch;
    const merger = new GitHubGateMerger({ token: "gate", identity: "kiln-merge-gate", fetch });
    const err = await merger.merge({ repo, number: 7, expectedHeadSha: "abc", title: "T" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GateMergeConflict);
    expect(String(err)).toContain("401");
  });
});
