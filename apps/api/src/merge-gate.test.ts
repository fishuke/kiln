import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueToken } from "@kiln/auth";
import { C, createTestKiln } from "@kiln/engine";
import { FakeForge, FakeGateMerger } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { ROUTES } from "./openapi";
import { agentMayCall } from "./run-auth";
import { appDefinitionsFor } from "./routes/studio-definitions";

const repo = { owner: "acme", name: "web" };

function push(forge: FakeForge, branch: string) {
  const work = mkdtempSync(join(tmpdir(), "kiln-gate-api-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: "human" }, stdio: "pipe" });
  git("clone", "-q", forge.cloneUrl(repo), ".");
  git("checkout", "-q", "-B", branch);
  writeFileSync(join(work, "page.tsx"), "export const h = 'Welcome back';\n");
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "change");
  git("push", "-q", "origin", branch);
}

async function setup() {
  const forge = new FakeForge();
  const t = createTestKiln({ forge, gateMerger: new FakeGateMerger(forge), preview: false });
  const app = createApp(t.kiln, {});
  const signup = await app.request("/api/v1/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@acme.test", password: "correct horse battery" }),
  });
  const { token: ownerToken } = (await signup.json()) as { token: string };
  const team = t.kiln.teams.ensureDefaultTeam();
  const member = t.kiln.users.create({ email: "ana@acme.test" });
  t.kiln.teams.addMember(team.id, member.id, "member", "test");
  const memberToken = issueToken(t.kiln.store, { name: "ana", subject: member.email, grants: [], type: "personal", userId: member.id }).token;
  const agentKey = issueToken(t.kiln.store, {
    name: "bot",
    subject: "agent:bot",
    grants: [
      { scope: "read", factory: "*" },
      { scope: "send", factory: "*" },
    ],
    type: "agent",
    teamId: team.id,
  }).token;
  t.kiln.store.put(C.runs, { id: "run_x", factory: "webapp", agent: "implement", startedAt: new Date().toISOString(), status: "running" });
  const runToken = t.kiln.secrets.issueRunToken("run_x", ["acme/web"]);
  t.kiln.store.put("studio_apps", { id: "sa_1", team: team.id, name: "Shop" });
  t.kiln.store.put("studio_apps", { id: "sa_other", team: "team_other", name: "Other" });
  push(forge, "studio/sa_1");
  const pr = await forge.openPullRequest({ repo, head: "studio/sa_1", title: "Change the heading", body: "", author: "ana" });
  const call = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  return { ...t, call, ownerToken, memberToken, agentKey, runToken, pr, team };
}

const ready = (t: Awaited<ReturnType<typeof setup>>, appId = "sa_1", team = t.team.id) =>
  t.kiln.mergeGate.readyForReview({ scope: { kind: "app", appId, team }, repo: "acme/web", number: t.pr.number, by: "ana@acme.test", pullRequestId: "sp_1" });

describe("merge gate API", () => {
  it("lists and reads the team's reviews", async () => {
    const t = await setup();
    appDefinitionsFor(t.kiln).save({ team: t.team.id, appId: "sa_1" }, { "policies/studio.yaml": "mergeGate: true\n" }, "owner@acme.test");
    const { outcome, review } = await ready(t);
    expect(outcome).toBe("merged");
    expect((await t.forge.getPullRequest(repo, t.pr.number))?.state).toBe("merged");
    expect(await (await t.call(t.memberToken, `/api/v1/merge-gate/reviews/${review.id}`)).json()).toMatchObject({ id: review.id, state: "merged" });
    expect(((await (await t.call(t.memberToken, "/api/v1/merge-gate/reviews?state=merged")).json()) as { reviews: unknown[] }).reviews).toHaveLength(1);
  });

  it("keeps the gate off until the App's policy turns it on", async () => {
    const t = await setup();
    expect(await ready(t)).toMatchObject({ outcome: "review", reasons: ["The merge gate is off, so a person reviews every pull request."] });
    expect(t.kiln.mergeGate.enabled({ kind: "app", appId: "sa_1", team: t.team.id })).toBe(false);
    appDefinitionsFor(t.kiln).save({ team: t.team.id, appId: "sa_1" }, { "policies/studio.yaml": "mergeGate: true\n" }, "owner@acme.test");
    expect(t.kiln.mergeGate.enabled({ kind: "app", appId: "sa_1", team: t.team.id })).toBe(true);
    expect(t.kiln.mergeGate.enabled({ kind: "app", appId: "sa_1", team: "team_other" })).toBe(false);
  });

  it("hides another team's review", async () => {
    const t = await setup();
    const { review } = await ready(t, "sa_other", "team_other");
    expect((await t.call(t.memberToken, `/api/v1/merge-gate/reviews/${review.id}`)).status).toBe(404);
    expect(((await (await t.call(t.memberToken, "/api/v1/merge-gate/reviews")).json()) as { reviews: unknown[] }).reviews).toEqual([]);
  });

  it("shows a pull request the gate did not merge in the team owners' inbox", async () => {
    const t = await setup();
    await ready(t);
    const inbox = (await (await t.call(t.ownerToken, "/api/v1/inbox/items?kind=studio_pr_review")).json()) as {
      items: { kind: string; appId: string; reasons: string[] }[];
    };
    expect(inbox.items).toEqual([
      expect.objectContaining({ kind: "studio_pr_review", appId: "sa_1", reasons: ["The merge gate is off, so a person reviews every pull request."] }),
    ]);
    const other = await ready(t, "sa_other", "team_other");
    const team = (await (await t.call(t.ownerToken, "/api/v1/inbox/items?scope=team&kind=studio_pr_review")).json()) as { items: { mergeReviewId: string }[] };
    expect(team.items.map((i) => i.mergeReviewId)).not.toContain(other.review.id);
  });

  it("refuses run tokens and agent keys", async () => {
    const t = await setup();
    for (const token of [t.runToken, t.agentKey]) expect((await t.call(token, "/api/v1/merge-gate/reviews")).status).toBe(403);
  });

  it("gives run tokens no route that merges, approves or decides a merge", () => {
    const principal = { runId: "run_x", factory: "webapp", agent: "implement", rootRunId: "run_x" };
    const kiln = createTestKiln().kiln;
    const merging = ROUTES.filter((r) => r.method !== "get" && (/merge|approve/.test(r.path) || r.scope === "decide:merge"));
    expect(merging.length).toBeGreaterThan(0);
    for (const r of merging)
      expect(agentMayCall(kiln, principal, r.method.toUpperCase(), r.path.replace(/\{[^}]+\}/g, "x")), `${r.method} ${r.path}`).toBeDefined();
  });
});
