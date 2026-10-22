import { createTestKiln, waitFor } from "@kiln/engine";
import { normalizeGitHub, normalizeSlack } from "@kiln/integrations";
import { describe, expect, it } from "vitest";

describe("work item lifecycle, end to end", () => {
  it("takes a labeled GitHub issue to a merged PR with spec and preview approvals", async () => {
    const { kiln, forge, chat, preview: previews } = createTestKiln();
    const repo = { owner: "acme", name: "web" };
    // The project's preview variables go to the PR preview.
    kiln.teams.ensureDefaultTeam();
    const project = kiln.planning.createProject({ name: "Web", owner: "po@acme.test", factories: ["webapp"] });
    kiln.variables.set({ scope: "project", owner: project.id, environment: "preview", variables: [{ key: "API_URL", value: "https://api.preview.test" }] }, "po@acme.test");
    const issue = await forge.createIssue(repo, { title: "Add a dark mode toggle to settings", body: "Users want dark mode.\n- The settings page has a dark mode switch\n- The choice is remembered after reload", labels: ["kiln-ready"] });
    const stages: string[] = [];
    kiln.bus.subscribe("work_item.stage_changed", (e) => void stages.push(e.payload.to));

    const { started } = await kiln.automations.handle(
      normalizeGitHub("issues", { action: "labeled", label: { name: "kiln-ready" }, repository: { full_name: "acme/web" }, issue: { number: issue.number, title: issue.title, body: issue.body, labels: [{ name: "kiln-ready" }], html_url: issue.url }, sender: { login: "alice" } }, "delivery-1")!,
    );
    expect(started).toHaveLength(1);
    const id = started[0]!.id;

    // Large enough to need a spec: it stops at spec approval with a draft PR.
    let wi = await waitFor(kiln, id, ["awaiting_spec", "building", "blocked"]);
    expect(wi.state).toBe("awaiting_spec");
    expect(wi.pr).toBeDefined();
    expect((await forge.getPullRequest(repo, wi.pr!.number))?.draft).toBe(true);
    expect(wi.spec?.criteria).toEqual(["AC1: The settings page has a dark mode switch", "AC2: The choice is remembered after reload"]);

    const spec = kiln.gates.inbox("alice").find((g) => g.kind === "spec")!;
    await kiln.gates.decide(spec.id, { decision: "approve", by: "alice", via: "web" });

    wi = await waitFor(kiln, id, ["awaiting_preview", "blocked", "handed_off"]);
    expect(wi.state).toBe("awaiting_preview");
    expect(wi.previewUrl).toMatch(/^https:\/\/pr-\d+\.web\.preview\.test$/);
    expect([...previews.deployments.values()][0]!.env).toEqual({ API_URL: "https://api.preview.test" });
    const preview = kiln.gates.inbox("po@acme.test").find((g) => g.kind === "preview")!;
    expect(preview.question).toContain("| AC1 | passed |");
    await kiln.gates.decide(preview.id, { decision: "approve", by: "po@acme.test", via: "web" });

    wi = await waitFor(kiln, id, ["handed_off", "blocked"]);
    expect(wi.state).toBe("handed_off");
    const pr = (await forge.getPullRequest(repo, wi.pr!.number))!;
    expect(pr).toMatchObject({ draft: false, labels: ["factory:webapp"], state: "open" });
    expect(forge.comments.some((c) => c.number === issue.number && c.body.startsWith("Ready to merge"))).toBe(true);

    // The factory never merges; a person does, and the merge completes the item.
    await forge.merge(repo, pr.number, "alice");
    await kiln.automations.handle(normalizeGitHub("pull_request", { action: "closed", repository: { full_name: "acme/web" }, pull_request: { number: pr.number, merged: true, head: { ref: pr.head }, merged_by: { login: "alice" } } }, "delivery-2")!);
    wi = kiln.workflow.get(id)!;
    expect(wi.state).toBe("complete");
    expect(wi.completion).toMatchObject({ by: "merge" });
    expect(stages).toEqual(["triaging", "planning", "awaiting_spec", "building", "awaiting_preview", "reviewing", "handed_off", "complete"]);
    const tree = await forge.readTree(repo, "main");
    expect(Object.keys(tree).some((f) => f.startsWith("src/kiln/"))).toBe(true);
    expect(Object.keys(tree)).toContain(`docs/specs/${id}.md`);
    expect(chat.messages).toHaveLength(0);
  });

  it("skips the spec for a small, clear Slack request and replies in the thread", async () => {
    const { kiln, chat } = createTestKiln({ preview: false });
    const { started } = await kiln.automations.handle(normalizeSlack({ type: "event_callback", event_id: "Ev1", event: { type: "app_mention", channel: "C1", ts: "100.1", user: "U2", text: "<@UBOT> @webapp fix typo in footer" } })!);
    const wi = await waitFor(kiln, started[0]!.id, ["handed_off", "blocked", "awaiting_spec"]);
    expect(wi.state).toBe("handed_off");
    expect(wi.spec).toBeUndefined();
    expect(chat.inThread("C1", "100.1").some((m) => m.text.startsWith("Ready to merge"))).toBe(true);
  });

  it("ignores a retried delivery", async () => {
    const { kiln } = createTestKiln();
    const ev = normalizeSlack({ type: "event_callback", event_id: "Ev9", event: { type: "app_mention", channel: "C1", ts: "1.1", text: "@webapp hi" } })!;
    expect((await kiln.automations.handle(ev)).started).toHaveLength(1);
    expect((await kiln.automations.handle(ev)).duplicate).toBe(true);
  });
});
