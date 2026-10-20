import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeCommandRunner } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import { FakeForge, GitHubForge } from "./forge";
import { KubernetesPreview, SlackChat } from "./chat";
import { JiraTracker, LinearTracker } from "./tracker";
import { DeliveryDedupe, normalizeGitHub, normalizeJira, normalizeLinear, normalizeSlack, verifyGitHub, verifySlack, verifyStandardWebhook } from "./webhooks";

const repo = { owner: "acme", name: "web" };

function pushFromClone(forge: FakeForge, branch: string, as: string) {
  const work = mkdtempSync(join(tmpdir(), "kiln-clone-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: as }, stdio: "pipe" });
  git("clone", "-q", forge.cloneUrl(repo), ".");
  git("checkout", "-q", "-B", branch);
  writeFileSync(join(work, "change.txt"), branch);
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "change");
  git("push", "-q", "origin", branch);
}

describe("fake forge", () => {
  it("lets agents push kiln/* branches but never main", () => {
    const forge = new FakeForge();
    forge.createRepo(repo);
    expect(() => pushFromClone(forge, "kiln/feature", "agent:run_1")).not.toThrow();
    expect(() => pushFromClone(forge, "main", "agent:run_1")).toThrow(/protected/);
    expect(() => pushFromClone(forge, "feature", "agent:run_1")).toThrow(/agents cannot push/);
  });

  it("opens a PR, refuses agent merges and records a human merge", async () => {
    const forge = new FakeForge();
    forge.createRepo(repo);
    pushFromClone(forge, "kiln/x", "agent:run_1");
    const events: string[] = [];
    forge.onEvent((e) => events.push(`${e.type}:${e.pr.number}`));
    const pr = await forge.openPullRequest({ repo, head: "kiln/x", title: "X", body: "", labels: ["factory:web"] });
    await expect(forge.merge(repo, pr.number, "kiln-agent[bot]")).rejects.toThrow("agents cannot merge");
    await forge.merge(repo, pr.number, "alice");
    expect(events).toEqual(["merged:1"]);
    expect((await forge.readTree(repo, "main"))["change.txt"]).toBe("kiln/x");
  });
});

function fakeFetch(routes: Record<string, unknown>, seen: { url: string; method: string; body?: unknown }[] = []) {
  return (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("github forge", () => {
  it("opens a PR with labels and aggregates checks", async () => {
    const seen: { url: string; method: string; body?: unknown }[] = [];
    const gh = new GitHubForge({
      token: "t",
      fetch: fakeFetch(
        {
          "/pulls": { number: 7, html_url: "https://github.com/acme/web/pull/7", title: "T", body: "B", head: { ref: "kiln/a", sha: "abc" }, base: { ref: "main" }, state: "open", user: { login: "kiln[bot]" } },
          "/labels": [],
          "/check-runs": { check_runs: [{ name: "ci", status: "completed", conclusion: "success" }, { name: "lint", status: "completed", conclusion: "failure" }] },
        },
        seen,
      ),
    });
    const pr = await gh.openPullRequest({ repo, head: "kiln/a", title: "T", body: "B", labels: ["factory:web"] });
    expect(pr).toMatchObject({ number: 7, labels: ["factory:web"], state: "open" });
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual(["POST /repos/acme/web/pulls", "POST /repos/acme/web/issues/7/labels"]);
    expect((await gh.checks(repo, "kiln/a")).status).toBe("failure");
    expect(gh.cloneUrl(repo, "tok")).toBe("https://x-access-token:tok@github.com/acme/web.git");
  });
});

describe("trackers and chat", () => {
  it("creates a Linear issue through GraphQL", async () => {
    const seen: { url: string; method: string; body?: any }[] = [];
    const linear = new LinearTracker({
      apiKey: "k",
      teamId: "team-1",
      fetch: fakeFetch({ graphql: { data: { issueCreate: { issue: { id: "i1", identifier: "KIL-1", title: "T", description: "B", url: "https://linear.app/x/KIL-1", createdAt: "2026-10-20", state: { type: "unstarted" }, labels: { nodes: [] } } } } } }, seen),
    });
    const issue = await linear.createIssue({ title: "T", body: "B" });
    expect(issue).toMatchObject({ key: "KIL-1", state: "todo" });
    expect(seen[0]!.body.variables.input.teamId).toBe("team-1");
  });

  it("creates a Jira issue with an ADF description", async () => {
    const seen: { url: string; method: string; body?: any }[] = [];
    const jira = new JiraTracker({
      baseUrl: "https://acme.atlassian.net",
      email: "a@acme.test",
      apiToken: "t",
      projectKey: "KIL",
      fetch: fakeFetch({ "/issue/KIL-3": { id: "10", key: "KIL-3", fields: { summary: "T", status: { statusCategory: { key: "new" } }, labels: [] } }, "/issue": { id: "10", key: "KIL-3" } }, seen),
    });
    const issue = await jira.createIssue({ title: "T", body: "Para one\n\nPara two" });
    expect(issue).toMatchObject({ key: "KIL-3", url: "https://acme.atlassian.net/browse/KIL-3" });
    expect(seen[0]!.body.fields.description.content).toHaveLength(2);
  });

  it("posts to a Slack thread", async () => {
    const seen: { url: string; method: string; body?: any }[] = [];
    const slack = new SlackChat({ botToken: "x", fetch: fakeFetch({ "chat.postMessage": { ok: true, ts: "1.2" } }, seen) });
    expect((await slack.post({ channel: "C1", thread: "9.9", text: "PR ready" })).ts).toBe("1.2");
    expect(seen[0]!.body).toMatchObject({ channel: "C1", thread_ts: "9.9" });
  });

  it("builds a namespace per PR for Kubernetes previews", async () => {
    const runner = new FakeCommandRunner();
    const preview = new KubernetesPreview({ runner, domain: "preview.acme.dev", image: (r, b) => `ghcr.io/${r}:${b.replace("/", "-")}` });
    const out = await preview.deploy({ repo: "acme/web", branch: "kiln/a", pr: 4 });
    expect(out).toEqual({ id: "preview-web-pr-4", url: "https://pr-4.web.preview.acme.dev" });
    expect(runner.calls[0]!.opts?.stdin).toContain('"kind":"Ingress"');
  });
});

describe("webhooks", () => {
  it("verifies GitHub, Slack and standard webhook signatures", () => {
    const body = '{"a":1}';
    expect(verifyGitHub("s", body, `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`)).toBe(true);
    expect(verifyGitHub("s", body, "sha256=00")).toBe(false);
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlack("s", body, ts, `v0=${createHmac("sha256", "s").update(`v0:${ts}:${body}`).digest("hex")}`)).toBe(true);
    expect(verifySlack("s", body, "1000", "v0=x")).toBe(false);
    const key = Buffer.from("secret").toString("base64");
    const sig = createHmac("sha256", Buffer.from("secret")).update(`m1.${ts}.${body}`).digest("base64");
    expect(verifyStandardWebhook(`whsec_${key}`, "m1", ts, body, `v1,${sig}`)).toBe(true);
  });

  it("normalizes provider payloads for automation filters", () => {
    expect(
      normalizeGitHub("issues", { action: "labeled", label: { name: "kiln-ready" }, repository: { full_name: "acme/web" }, issue: { number: 3, title: "Bug", body: "x", labels: [{ name: "kiln-ready" }] } }, "d1"),
    ).toMatchObject({ event: "issue_labeled", deliveryId: "d1", data: { repo: "acme/web", labels: ["kiln-ready"], number: 3 } });
    expect(normalizeGitHub("pull_request", { action: "closed", repository: { full_name: "acme/web" }, pull_request: { number: 4, merged: true, head: { ref: "kiln/a" } } })?.event).toBe(
      "pull_request_merged",
    );
    expect(normalizeSlack({ type: "event_callback", event_id: "E1", event: { type: "app_mention", channel: "C", ts: "1.1", text: "<@U1> @webapp fix login" } })).toMatchObject({
      event: "app_mention",
      data: { channel: "C", thread: "1.1", mentioned: ["webapp"] },
    });
    expect(normalizeLinear({ type: "AgentSessionEvent", action: "created", agentSession: { id: "s", issue: { id: "i", title: "T", teamId: "t1" } } })?.data.team_ids).toEqual(["t1"]);
    expect(normalizeJira({ webhookEvent: "jira:issue_created", issue: { key: "KIL-1", fields: { summary: "T", description: "@webapp please", labels: [] } } })?.data.mentioned).toEqual(["webapp"]);
  });

  it("dedupes retried deliveries", () => {
    const d = new DeliveryDedupe();
    expect(d.firstTime("x")).toBe(true);
    expect(d.firstTime("x")).toBe(false);
    expect(d.firstTime(undefined)).toBe(true);
  });
});
