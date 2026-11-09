import { describe, expect, it } from "vitest";
import { connectionProviders } from "./connections";
import { GitHubForge, githubHosts } from "./forge";
import { githubAppInstallUrl, githubExchangeCode, githubManifestAction } from "./github";
import { GitHubGateMerger } from "./merge-gate";

const GHE = "https://ghe.example.com";

/** Records every URL a client calls and answers with a minimal GitHub body. */
function recorder(body: unknown = { default_branch: "main" }) {
  const urls: string[] = [];
  const fetch = (async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

describe("githubHosts", () => {
  it("defaults to github.com and api.github.com", () => {
    expect(githubHosts()).toEqual({ web: "https://github.com", api: "https://api.github.com" });
    expect(githubHosts({ api: "https://api.github.com" })).toEqual({ web: "https://github.com", api: "https://api.github.com" });
  });

  it("derives the Enterprise Server API from the web host, and the web host from the API", () => {
    expect(githubHosts({ web: `${GHE}/` })).toEqual({ web: GHE, api: `${GHE}/api/v3` });
    expect(githubHosts({ api: `${GHE}/api/v3/` })).toEqual({ web: GHE, api: `${GHE}/api/v3` });
    expect(githubHosts({ web: GHE, api: "https://api.ghe.example.com" })).toEqual({ web: GHE, api: "https://api.ghe.example.com" });
  });
});

describe("GitHubForge on GitHub Enterprise Server", () => {
  const repo = { owner: "acme", name: "web" };

  it("clones from the Enterprise host and calls its API", async () => {
    const { urls, fetch } = recorder();
    const forge = new GitHubForge({ token: "t", baseUrl: `${GHE}/api/v3`, fetch });
    expect(forge.cloneUrl(repo)).toBe(`${GHE}/acme/web.git`);
    expect(forge.cloneUrl(repo, "tok")).toBe("https://x-access-token:tok@ghe.example.com/acme/web.git");
    expect(await forge.defaultBranch(repo)).toBe("main");
    expect(urls).toEqual([`${GHE}/api/v3/repos/acme/web`]);
  });

  it("people's forges keep the host", () => {
    const forge = new GitHubForge({ token: "t", baseUrl: `${GHE}/api/v3`, webUrl: GHE });
    expect(forge.cloneUrl(repo)).toBe(`${GHE}/acme/web.git`);
  });

  it("stays on github.com by default", async () => {
    const { urls, fetch } = recorder();
    const forge = new GitHubForge({ token: "t", fetch });
    expect(forge.cloneUrl(repo)).toBe("https://github.com/acme/web.git");
    expect(forge.cloneUrl(repo, "tok")).toBe("https://x-access-token:tok@github.com/acme/web.git");
    await forge.defaultBranch(repo);
    expect(urls).toEqual(["https://api.github.com/repos/acme/web"]);
  });
});

describe("GitHub links and clients on Enterprise Server", () => {
  it("install and manifest links use the configured host", () => {
    expect(githubAppInstallUrl("kiln", "s", GHE)).toBe(`${GHE}/apps/kiln/installations/new?state=s`);
    expect(githubAppInstallUrl("kiln", "s")).toBe("https://github.com/apps/kiln/installations/new?state=s");
    expect(githubManifestAction("s", "acme", GHE)).toBe(`${GHE}/organizations/acme/settings/apps/new?state=s`);
  });

  it("the GitHub connection installs on the configured host", () => {
    const github = connectionProviders({ github: { appSlug: "kiln", webUrl: GHE, apiUrl: `${GHE}/api/v3` } }).github;
    const started = github.start({ state: "s", redirectUri: "https://kiln.test/cb", webhookUrl: "https://kiln.test/webhooks/x" } as never);
    expect(started.url).toBe(`${GHE}/apps/kiln/installations/new?state=s`);
  });

  it("linking a person's account exchanges the code on the configured host", async () => {
    const { urls, fetch } = recorder({ access_token: "u", login: "ann" });
    const user = await githubExchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://kiln.test/cb", webUrl: GHE, fetch });
    expect(user.login).toBe("ann");
    expect(urls).toEqual([`${GHE}/login/oauth/access_token`, `${GHE}/api/v3/user`]);
  });

  it("the merge gate reads pull requests from the Enterprise API", async () => {
    const { urls, fetch } = recorder({ merged: true, sha: "abc" });
    const gate = new GitHubGateMerger({ token: "t", identity: "kiln-merge-gate", baseUrl: `${GHE}/api/v3`, fetch });
    await gate.merge({ repo: { owner: "acme", name: "web" }, number: 1, method: "squash" } as never).catch(() => undefined);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith(`${GHE}/api/v3/`))).toBe(true);
  });
});
