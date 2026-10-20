import { FakeForge } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { ReviewError } from "./reviews";
import { createTestKiln, waitFor } from "./testing";

const repo = { owner: "acme", name: "web" };

async function handedOff(title: string) {
  const t = createTestKiln({ preview: false });
  const wi = await t.kiln.workflow.create({ factory: "webapp", title, body: "", source: { provider: "api" }, requester: "po@acme.test" });
  void t.kiln.workflow.advance(wi.id);
  return { ...t, wi: await waitFor(t.kiln, wi.id, ["handed_off"]) };
}

function linkGitHub(kiln: ReturnType<typeof createTestKiln>["kiln"], email: string, login: string) {
  const user = kiln.users.byEmail(email) ?? kiln.users.create({ email });
  const state = kiln.identities.startOAuthLink("github", user.id);
  kiln.identities.completeOAuthLink(state, "github", login, login, FakeForge.personToken(login));
  return user;
}

describe("review risk", () => {
  it("sees the pull request's real changed files", async () => {
    const { kiln, wi } = await handedOff("Fix the checkout button");
    const log = kiln.store
      .list<{ id: string; decision: string; workItemId?: string; state: { files: string[]; additions: number } }>("decision_logs")
      .find((d) => d.decision === "review-risk" && d.workItemId === wi.id)!;
    expect(log.state.files.length).toBeGreaterThan(0);
    expect(log.state.additions).toBeGreaterThan(0);
  });

  it("low risk: no inbox item, the task is ready to merge", async () => {
    const { kiln, wi } = await handedOff("Fix the checkout button");
    expect(wi.review?.needsHuman).toBe(false);
    expect(kiln.gates.list({ workItemId: wi.id, state: "open" })).toEqual([]);
    expect(kiln.inbox.list({ user: "po@acme.test", scope: "team" }).items.filter((i) => i.taskId === wi.id)).toEqual([]);
    expect(kiln.reviews.readyToMerge().map((w) => w.id)).toEqual([wi.id]);
  });

  it("sensitive change: a review item for the code owners", async () => {
    const { kiln, wi } = await handedOff("Fix the login form");
    expect(wi.review?.needsHuman).toBe(true);
    const gate = kiln.gates.list({ workItemId: wi.id, state: "open" })[0]!;
    expect(gate).toMatchObject({ kind: "merge", title: 'Review "Fix the login form"', assignees: ["lead@acme.test"] });
    expect(kiln.reviews.readyToMerge()).toEqual([]);
  });
});

describe("reviewing in Kiln", () => {
  it("shows the diff with the forge's identity", async () => {
    const { kiln, wi } = await handedOff("Fix the login form");
    const files = await kiln.reviews.files(wi.id);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.patch).toContain("@@");
  });

  it("needs the person's linked GitHub account", async () => {
    const { kiln, wi } = await handedOff("Fix the login form");
    const user = kiln.users.create({ email: "lead@acme.test" });
    expect(kiln.reviews.account(user.id)).toEqual({ linked: false });
    await expect(kiln.reviews.submit(wi.id, user.id, { event: "APPROVE" })).rejects.toThrow(ReviewError);
    await expect(kiln.reviews.submit(wi.id, user.id, { event: "APPROVE" })).rejects.toThrow(/Link your GitHub account/);
  });

  it("request changes posts the review as the person and sends the work back once", async () => {
    const { kiln, forge, wi } = await handedOff("Fix the login form");
    const user = linkGitHub(kiln, "lead@acme.test", "lead");
    expect(kiln.reviews.account(user.id)).toEqual({ linked: true, login: "lead" });
    await kiln.reviews.submit(wi.id, user.id, {
      event: "REQUEST_CHANGES",
      body: "Validate the email",
      comments: [{ path: "README.md", line: 1, body: "Mention it here" }],
    });
    expect(forge.reviews).toEqual([expect.objectContaining({ by: "lead", event: "REQUEST_CHANGES", body: "Validate the email" })]);
    const asked = kiln.workflow.get(wi.id)!.conversation.find((m) => m.from === "lead")!;
    expect(asked.text).toContain("README.md:1: Mention it here");
    await waitFor(kiln, wi.id, ["handed_off"]);
    const implementRuns = () => kiln.runs.list({ workItemId: wi.id }).filter((r) => r.agent === "implement").length;
    const before = implementRuns();
    expect(before).toBe(2);
    // The forge's webhook for the same review does not start a second revision.
    await kiln.workflow.onReviewSubmitted("acme/web", wi.pr!.number, "Validate the email", "lead");
    expect(implementRuns()).toBe(before);
    expect(kiln.workflow.get(wi.id)!.conversation.filter((m) => m.text.includes("Validate the email"))).toHaveLength(1);
  });

  it("merges as the person and completes the task", async () => {
    const { kiln, forge, wi } = await handedOff("Fix the checkout button");
    const user = linkGitHub(kiln, "po@acme.test", "po");
    await kiln.reviews.merge(wi.id, user.id);
    expect((await forge.getPullRequest(repo, wi.pr!.number))!).toMatchObject({ state: "merged", mergedBy: "po" });
    expect(kiln.workflow.get(wi.id)!.state).toBe("complete");
  });

  it("keeps the person's token out of named secrets", async () => {
    const { kiln } = await handedOff("Fix the checkout button");
    const user = linkGitHub(kiln, "po@acme.test", "po");
    expect(kiln.secrets.listSecretNames().join(" ")).not.toMatch(/github|fake-gh/i);
    expect(kiln.secrets.getSecret(`${user.id}:github`)).toBeUndefined();
  });

  it("forgets the token when GitHub is unlinked", async () => {
    const { kiln } = await handedOff("Fix the checkout button");
    const user = linkGitHub(kiln, "po@acme.test", "po");
    kiln.identities.unlinkUser(user.id, "github");
    expect(kiln.reviews.account(user.id)).toEqual({ linked: false });
  });
});
