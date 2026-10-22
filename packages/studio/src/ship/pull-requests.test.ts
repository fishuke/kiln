import { FakePreview, type RepoRef } from "@kiln/integrations";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../studio";
import { shipFixture, type ShipFixtureOptions } from "./fixture";

const studios: Studio[] = [];
afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

const author = { by: "creator@x.test", role: "member" as const };
const other = { by: "other@x.test", role: "member" as const };
const admin = { by: "admin@x.test", role: "admin" as const };
const web: RepoRef = { owner: "acme", name: "web" };

async function setup(opts: ShipFixtureOptions = {}) {
  const previews = new FakePreview();
  const f = await shipFixture({
    source: { kind: "repo", repo: "acme/web" },
    ...opts,
    shipper: { previews, versionPreviewUrl: (app, versionId) => `https://kiln.test/studio/${app.id}?version=${versionId}` },
  });
  studios.push(f.studio);
  const states: { state: string; priority: string }[] = [];
  f.bus.subscribe("studio.pull_request_state_changed", (e) => {
    states.push({ state: e.payload.state, priority: e.payload.priority });
  });
  return { ...f, previews, states };
}

describe("the App's pull request", () => {
  it("opens one pull request in UAT on the first review push and keeps updating it", async () => {
    const { shipper, forge, app, change, studio, states } = await setup();
    await change("one");
    const first = shipper.pullRequest(app.id)!;
    expect(first).toMatchObject({ state: "uat", branch: `studio/${app.id}`, base: "main", repo: "acme/web", createdBy: "creator@x.test" });
    await change("two");
    const second = shipper.pullRequest(app.id)!;
    expect(second).toMatchObject({ id: first.id, number: first.number, versionId: studio.getApp(app.id)!.versions[0]!.id });
    expect(await forge.listPullRequests(web, { state: "all" })).toHaveLength(1);
    expect(states).toEqual([{ state: "uat", priority: "finished" }]);
  });

  it("records the built-in preview and the deployment preview", async () => {
    const { shipper, app, change } = await setup();
    await change();
    const pr = shipper.pullRequest(app.id)!;
    expect(pr.builtInPreview).toBe(`https://kiln.test/studio/${app.id}?version=${pr.versionId}`);
    expect(pr.previewUrl).toBe(`https://pr-${pr.number}.web.preview.test`);
  });

  it("opens a pull request on ship in safe mode, where nothing pushes by itself", async () => {
    const { shipper, app, change } = await setup({ shipMode: "safe" });
    await change();
    expect(shipper.pullRequest(app.id)).toBeUndefined();
    const pr = await shipper.ship(app.id, { title: "Add a note" }, author);
    expect(pr).toMatchObject({ state: "uat", createdBy: "creator@x.test" });
  });

  it("lets only the author, a person, mark it ready for review", async () => {
    const { shipper, app, change } = await setup();
    await change();
    await expect(shipper.ship(app.id, { state: "ready_for_review" }, other)).rejects.toThrow(/only the author/);
    await expect(shipper.ship(app.id, { state: "ready_for_review" }, { by: "agent:studio" })).rejects.toThrow(/a person/);
    expect(shipper.pullRequest(app.id)!.state).toBe("uat");
  });

  it("asks the merge gate when the author is done, and waits for review when it isn't safe", async () => {
    const { shipper, app, change, gate, states } = await setup();
    await change();
    const pr = await shipper.ship(app.id, { state: "ready_for_review" }, author);
    expect(gate.calls).toEqual([
      expect.objectContaining({
        scope: { kind: "app", appId: app.id, team: "t1" },
        repo: "acme/web",
        number: pr.number,
        by: "creator@x.test",
        pullRequestId: pr.id,
      }),
    ]);
    expect(pr).toMatchObject({ state: "waiting_for_review", reasons: ["a person reviews every change"] });
    // The gate's own event (merge_gate.review_updated) is the one needs-you notification.
    expect(states.map((s) => `${s.state}:${s.priority}`)).toEqual(["uat:finished", "ready_for_review:progress"]);
  });

  it("is merged when the merge gate merges it", async () => {
    const { shipper, app, change, gate } = await setup();
    gate.next = { state: "merged", reasons: [] };
    await change();
    expect(await shipper.ship(app.id, { state: "ready_for_review" }, author)).toMatchObject({ state: "merged" });
  });

  it("follows the merge gate when it decides later", async () => {
    const { shipper, app, change, gate } = await setup();
    gate.next = { state: "deciding", reasons: [] };
    await change();
    const pr = await shipper.ship(app.id, { state: "ready_for_review" }, author);
    expect(pr.state).toBe("ready_for_review");
    expect(shipper.reviewUpdated({ pullRequestId: pr.id, state: "merged" })).toMatchObject({ state: "merged" });
  });

  it("goes back to UAT when a new turn changes it while it waits for review", async () => {
    const { shipper, app, change } = await setup();
    await change("one");
    await shipper.ship(app.id, { state: "ready_for_review" }, author);
    await change("two");
    expect(shipper.pullRequest(app.id)!.state).toBe("uat");
  });

  it("closes the pull request on cancel, and the next ship opens a new one", async () => {
    const { shipper, forge, app, change, gate } = await setup();
    await change();
    await expect(shipper.ship(app.id, { state: "cancelled" }, other)).rejects.toThrow(/author or a team admin/);
    const ready = await shipper.ship(app.id, { state: "ready_for_review" }, author);
    const cancelled = await shipper.ship(app.id, { state: "cancelled" }, admin);
    expect(cancelled.state).toBe("cancelled");
    expect((await forge.getPullRequest(web, ready.number))!.state).toBe("closed");
    expect(gate.closed).toEqual([{ repo: "acme/web", number: ready.number, merged: false, by: "admin@x.test" }]);
    const again = await shipper.ship(app.id, {}, author);
    expect(again.number).not.toBe(ready.number);
    expect(again.state).toBe("uat");
  });

  it("records a person's merge on the forge", async () => {
    const { shipper, forge, app, change } = await setup();
    await change();
    const pr = shipper.pullRequest(app.id)!;
    await forge.merge(web, pr.number, "alice");
    expect(shipper.forgeMerged("acme/web", pr.number)).toMatchObject({ state: "merged" });
  });
});
