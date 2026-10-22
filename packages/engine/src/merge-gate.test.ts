import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeForge, FakeGateMerger, type GateMerger } from "@kiln/integrations";
import type { KilnEventMap } from "@kiln/events";
import { describe, expect, it } from "vitest";
import { MergeGateError, type MergeReview } from "./merge-gate";
import { createTestKiln, sampleTree } from "./testing";

const repo = { owner: "acme", name: "web" };

function push(forge: FakeForge, branch: string, files: Record<string, string>) {
  const work = mkdtempSync(join(tmpdir(), "kiln-gate-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env: { ...process.env, KILN_PUSH_AS: "human" }, stdio: "pipe" }).toString();
  git("clone", "-q", forge.cloneUrl(repo), ".");
  git("checkout", "-q", "-B", branch);
  if (git("ls-remote", "origin", `refs/heads/${branch}`).trim()) git("reset", "-q", "--hard", `origin/${branch}`);
  for (const [path, body] of Object.entries(files)) writeFileSync(join(work, path), body);
  git("add", "-A");
  git("-c", "user.name=a", "-c", "user.email=a@t.test", "commit", "-q", "-m", "change");
  git("push", "-q", "origin", branch);
}

async function setup(
  opts: { merger?: (forge: FakeForge) => GateMerger | undefined; files?: Record<string, string>; draft?: boolean; tree?: Record<string, string> } = {},
) {
  const forge = new FakeForge();
  const { kiln } = createTestKiln({
    forge,
    gateMerger: opts.merger ? opts.merger(forge) : new FakeGateMerger(forge),
    ...(opts.tree ? { tree: sampleTree(opts.tree) } : {}),
  });
  const owner = kiln.users.create({ email: "owner@acme.test" });
  const admin = kiln.users.create({ email: "admin2@acme.test" });
  const member = kiln.users.create({ email: "ana@acme.test" });
  const team = kiln.teams.create({ name: "Acme" }, owner.id);
  kiln.teams.addMember(team.id, admin.id, "admin", "test");
  kiln.teams.addMember(team.id, member.id, "member", "test");
  push(forge, "studio/sa_1", opts.files ?? { "page.tsx": "export const h = 'Welcome back';\n" });
  const pr = await forge.openPullRequest({ repo, head: "studio/sa_1", title: "Change the heading", body: "", author: "ana", draft: opts.draft });
  const scope = { kind: "app" as const, appId: "sa_1", team: team.id };
  const ready = async (extra: Record<string, unknown> = {}) =>
    (
      await kiln.mergeGate.readyForReview({
        scope,
        repo: "acme/web",
        number: pr.number,
        by: "ana@acme.test",
        pullRequestId: "sp_1",
        link: "https://kiln.test/studio/sa_1",
        ...extra,
      })
    ).review;
  return { kiln, forge, pr, team, scope, ready };
}

const events = (kiln: ReturnType<typeof createTestKiln>["kiln"]) => {
  const seen: KilnEventMap["merge_gate.review_updated"][] = [];
  kiln.bus.subscribe("merge_gate.review_updated", (e) => {
    seen.push(e.payload);
  });
  return seen;
};

describe("merge gate", () => {
  it("sends every pull request to a person while the gate is off, without running the decision", async () => {
    const { kiln, ready } = await setup();
    const review = await ready();
    expect(review).toMatchObject({ state: "needs_review", reasons: ["The merge gate is off, so a person reviews every pull request."] });
    expect(review.decision).toBeUndefined();
    expect(kiln.store.list<{ id: string; decision: string }>("decision_logs", (d) => d.decision === "merge-safety")).toEqual([]);
    expect(kiln.auditLog().find((a) => a.action === "merge_gate.sent_to_review")).toMatchObject({ actor: "kiln", target: review.id });
  });

  it("merges a safe pull request as the gate and audits the decision's inputs and answer", async () => {
    const { kiln, forge, pr, scope, team, ready } = await setup();
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    const seen = events(kiln);
    const review = await ready();
    expect(review).toMatchObject({ state: "merged", mergedBy: "kiln-merge-gate", decision: { action: "merge" } });
    expect((await forge.getPullRequest(repo, pr.number))?.state).toBe("merged");
    const entry = kiln.auditLog().find((a) => a.action === "merge_gate.merged")!;
    expect(entry).toMatchObject({ actor: "kiln-merge-gate", target: review.id, team: team.id });
    expect(entry.details).toMatchObject({
      repo: "acme/web",
      number: pr.number,
      headSha: pr.headSha,
      decision: "merge-safety",
      action: "merge",
      readyBy: "ana@acme.test",
      decisionLogId: review.decision!.logId,
      state: { files: ["page.tsx"], checks: "success", title: "Change the heading" },
      answers: { safe_to_merge: expect.any(Number) },
    });
    expect(seen).toEqual([
      { reviewId: review.id, appId: "sa_1", pullRequestId: "sp_1", repo: "acme/web", number: pr.number, state: "merged", priority: "finished" },
    ]);
    expect(kiln.inbox.all().filter((i) => i.mergeReviewId)).toEqual([]);
  });

  it("sends a pull request with failing checks to the team's owners and admins with the reasons", async () => {
    const { kiln, forge, pr, scope, team, ready } = await setup();
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    forge.setChecks(repo, pr.headSha!, { status: "failure", runs: [{ name: "ci", conclusion: "failure" }] });
    const review = await ready();
    expect(review.state).toBe("needs_review");
    expect(review.reasons).toContain("CI failed.");
    expect((await forge.getPullRequest(repo, pr.number))?.state).toBe("open");
    const item = kiln.inbox.all().find((i) => i.mergeReviewId === review.id)!;
    expect(item).toMatchObject({
      id: `merge:${review.id}`,
      kind: "studio_pr_review",
      title: "Review: Change the heading",
      team: team.id,
      appId: "sa_1",
      url: "https://kiln.test/studio/sa_1",
      urls: [pr.url],
      actions: ["view"],
      reasons: review.reasons,
    });
    expect(item.factory).toBeUndefined();
    expect(item.recipients.sort()).toEqual(["admin2@acme.test", "owner@acme.test"]);
    expect(kiln.auditLog().find((a) => a.action === "merge_gate.sent_to_review")?.details).toMatchObject({ reasons: review.reasons, action: "review" });
  });

  it("sends a change to a sensitive file to review", async () => {
    const { kiln, scope, ready } = await setup({ files: { "auth.ts": "export const session = 1;\n" } });
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    const review = await ready();
    expect(review.state).toBe("needs_review");
    expect(review.reasons.some((r) => r === "Touches sensitive area: 0.80.")).toBe(true);
  });

  it("does not merge when the pull request changed after the decision", async () => {
    let forgeRef: FakeForge | undefined;
    const { kiln, scope, ready } = await setup({
      merger: (forge) => {
        forgeRef = forge;
        const inner = new FakeGateMerger(forge);
        return {
          identity: inner.identity,
          merge: async (input) => {
            push(forgeRef!, "studio/sa_1", { "page.tsx": "export const h = 'changed';\n" });
            return inner.merge(input);
          },
        };
      },
    });
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    const review = await ready();
    expect(review.state).toBe("needs_review");
    expect(review.reasons.at(-1)).toMatch(/changed after the merge-safety decision/);
    expect(kiln.auditLog().find((a) => a.action === "merge_gate.merge_failed")?.details).toMatchObject({ error: expect.stringMatching(/changed after/) });
  });

  it("sends the pull request to review when the server has no merge credential", async () => {
    const { kiln, scope, ready } = await setup({ merger: () => undefined });
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    const review = await ready();
    expect(review).toMatchObject({ state: "needs_review", decision: { action: "merge" } });
    expect(review.reasons).toEqual(["This server has no merge credential for the gate (KILN_MERGE_GATE_TOKEN)."]);
  });

  it("returns the same review when the same head is marked ready twice", async () => {
    const { kiln, ready } = await setup();
    const first = await ready();
    const second = await ready();
    expect(second.id).toBe(first.id);
    expect(kiln.mergeGate.list({}).length).toBe(1);
  });

  it("refuses a draft pull request", async () => {
    const { ready } = await setup({ draft: true });
    await expect(ready()).rejects.toBeInstanceOf(MergeGateError);
  });

  it("clears the inbox item when a person merges the pull request later", async () => {
    const { kiln, pr, ready } = await setup();
    const review = await ready();
    const seen = events(kiln);
    const [updated] = kiln.mergeGate.pullRequestClosed({ repo: "acme/web", number: pr.number, merged: true, by: "owner@acme.test" });
    expect(updated).toMatchObject({ id: review.id, state: "merged", mergedBy: "owner@acme.test" });
    expect(kiln.inbox.all().find((i) => i.mergeReviewId === review.id)).toBeUndefined();
    expect(seen.map((e) => e.state)).toEqual(["merged"]);
  });

  it("follows the forge's merge webhook", async () => {
    const { kiln, pr, ready } = await setup();
    const review = await ready();
    await kiln.automations.handle({ provider: "github", event: "pull_request_merged", data: { repo: "acme/web", number: pr.number, mergedBy: "owner" } });
    expect(kiln.mergeGate.get(review.id)).toMatchObject({ state: "merged", mergedBy: "owner" });
  });

  it("closes the review when the author cancels the pull request", async () => {
    const { kiln, pr, ready } = await setup();
    await ready();
    const [updated] = kiln.mergeGate.pullRequestClosed({ repo: "acme/web", number: pr.number, merged: false });
    expect((updated as MergeReview).state).toBe("closed");
  });

  it("reads an App's switch from its definition's policy, and is off without one", async () => {
    const { kiln, scope } = await setup();
    expect(kiln.mergeGate.enabled(scope)).toBe(false);
    kiln.mergeGate.useAppPolicy((id) => id === scope.appId);
    expect(kiln.mergeGate.enabled(scope)).toBe(true);
    expect(kiln.mergeGate.enabled({ ...scope, appId: "sa_2" })).toBe(false);
  });

  it("answers Studio's shipping with the outcome only", async () => {
    const { kiln, pr, scope, forge } = await setup();
    kiln.mergeGate.useAppPolicy(() => true);
    forge.setChecks(repo, pr.headSha!, { status: "failure", runs: [{ name: "ci", conclusion: "failure" }] });
    const result = await kiln.mergeGate.readyForReview({ scope, repo: "acme/web", number: pr.number, by: "ana@acme.test", pullRequestId: "sp_1" });
    expect(result).toMatchObject({ outcome: "review", reasons: expect.arrayContaining(["CI failed."]) });
  });

  it("reads a factory's setting from its policies, where false wins", async () => {
    const on = await setup({ tree: { "policies/merge.yaml": "mergeGate: true\n" } });
    expect(on.kiln.mergeGate.enabled({ kind: "factory", factory: "webapp" })).toBe(true);
    const off = await setup({ tree: { "policies/merge.yaml": "mergeGate: true\n", "policies/strict.yaml": "mergeGate: false\n" } });
    expect(off.kiln.mergeGate.enabled({ kind: "factory", factory: "webapp" })).toBe(false);
    const unset = await setup();
    expect(unset.kiln.mergeGate.enabled({ kind: "factory", factory: "webapp" })).toBe(false);
  });

  it("sends a factory pull request to the admins as a pr_review item", async () => {
    const { kiln, pr } = await setup();
    const review = await kiln.mergeGate.readyForReview({
      scope: { kind: "factory", factory: "webapp" },
      repo: "acme/web",
      number: pr.number,
      by: "lead@acme.test",
    });
    expect(kiln.inbox.all().find((i) => i.mergeReviewId === review.review.id)).toMatchObject({
      kind: "pr_review",
      factory: "webapp",
      recipients: ["admin@acme.test"],
    });
  });
});

describe("merge capability boundary", () => {
  it("is not kept on kiln.options, which every service and run reads", () => {
    const forge = new FakeForge();
    const { kiln } = createTestKiln({ forge, gateMerger: new FakeGateMerger(forge) });
    expect(Object.values(kiln.options).some((v) => v instanceof FakeGateMerger)).toBe(false);
    expect("gateMerger" in kiln.options).toBe(false);
  });

  it("is referenced only by the merge gate service and the server wiring", () => {
    const root = join(__dirname, "../../..");
    const sources = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === "node_modules"
            ? []
            : sources(join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const users = ["packages", "apps"]
      .flatMap(sources)
      .filter((f) => !f.startsWith(join("apps", "web")) && /\b(GateMerger|gateMerger)\b/.test(readFileSync(join(root, f), "utf8")));
    expect(users.sort()).toEqual(
      [
        join("apps", "api", "src", "config.ts"),
        join("packages", "engine", "src", "kiln.ts"),
        join("packages", "engine", "src", "merge-gate.ts"),
        join("packages", "integrations", "src", "merge-gate.ts"),
      ].sort(),
    );
  });
});
