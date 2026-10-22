import type { FakeForge, Forge, RepoRef } from "@kiln/integrations";
import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../studio";
import { shipFixture, type ShipFixtureOptions } from "./fixture";
import { SHIP_COLLECTIONS, type AppRepo } from "./types";

const studios: Studio[] = [];
afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

const admin = { by: "admin@x.test", role: "admin" as const };
const member = { by: "member@x.test", role: "member" as const };

async function setup(opts: ShipFixtureOptions = {}) {
  const f = await shipFixture(opts);
  studios.push(f.studio);
  return f;
}

const imported = { kind: "repo" as const, repo: "acme/web" };
const web: RepoRef = { owner: "acme", name: "web" };

describe("pushes per ship mode", () => {
  it("creates a template App's repository on its first push and pushes main in cowboy", async () => {
    const { shipper, forge, app, audit, change, mainSha } = await setup();
    const repoRef = { owner: "acme", name: `daily-done-${app.id.slice(3, 9)}` };
    expect(forge.hasRepo(repoRef)).toBe(false);
    await change();
    expect(shipper.repo(app.id)).toMatchObject({ repo: `acme/${repoRef.name}`, createdByKiln: true });
    expect(forge.branchSha(repoRef, "main")).toBe(await mainSha());
    expect(audit.map((a) => a.action)).toEqual(["studio.repo_created", "studio.push"]);
    expect(audit[1]).toMatchObject({ actor: "agent:studio", target: `acme/${repoRef.name}`, details: { appId: app.id, branch: "main", shipMode: "cowboy" } });
  });

  it("pushes nothing for the initial version or in safe mode", async () => {
    const { forge, app, audit, change } = await setup({ shipMode: "safe" });
    await change();
    expect(forge.hasRepo({ owner: "acme", name: `daily-done-${app.id.slice(3, 9)}` })).toBe(false);
    expect(audit).toEqual([]);
  });

  it("pushes only the studio branch of a template App's repository once it is linked to a factory", async () => {
    const { forge, app, change, linked } = await setup();
    const name = `daily-done-${app.id.slice(3, 9)}`;
    await change("one");
    const before = forge.branchSha({ owner: "acme", name }, "main");
    linked.push(`acme/${name}`);
    await change("two");
    expect(forge.branchSha({ owner: "acme", name }, "main")).toBe(before);
    expect(forge.branchSha({ owner: "acme", name }, `studio/${app.id}`)).toBeTruthy();
  });

  it("keeps an imported App in cowboy on its studio branch until a person chooses cowboy", async () => {
    const { studio, forge, app, change, mainSha } = await setup({ source: imported });
    const before = forge.branchSha(web, "main");
    studio.updateApp(app.id, { shipMode: "cowboy" });
    await change();
    expect(forge.branchSha(web, "main")).toBe(before);
    expect(forge.branchSha(web, `studio/${app.id}`)).toBe(await mainSha());
  });

  it("pushes an imported App's main branch after an admin chose cowboy, and records who and when", async () => {
    const { shipper, forge, app, change, mainSha } = await setup({ source: imported });
    shipper.setShipMode(app.id, "cowboy", admin);
    expect(shipper.choice(app.id)).toMatchObject({ mode: "cowboy", by: "admin@x.test", at: expect.any(String) });
    await change();
    expect(forge.branchSha(web, "main")).toBe(await mainSha());
  });

  it("never pushes main of an imported repository linked to a factory, even after a person chose cowboy", async () => {
    const { shipper, forge, app, change } = await setup({ source: imported, linked: ["acme/web"] });
    const before = forge.branchSha(web, "main");
    shipper.setShipMode(app.id, "cowboy", admin);
    await change();
    expect(forge.branchSha(web, "main")).toBe(before);
    expect(forge.branchSha(web, `studio/${app.id}`)).toBeTruthy();
  });

  it("refuses a ship mode above the person's cap", async () => {
    const { shipper, studio, app } = await setup({ source: imported });
    expect(() => shipper.setShipMode(app.id, "cowboy", member)).toThrow(/at most review/);
    expect(studio.getApp(app.id)!.app.shipMode).toBe("review");
    expect(shipper.choice(app.id)).toBeUndefined();
  });

  it("takes the cap from the App's policy", async () => {
    const { shipper, app, policy } = await setup();
    policy.maxShipMode = "review";
    expect(() => shipper.setShipMode(app.id, "cowboy", admin)).toThrow(/at most review/);
    shipper.setShipMode(app.id, "review", admin);
    expect(shipper.choice(app.id)).toMatchObject({ mode: "review", by: "admin@x.test", role: "admin" });
  });

  it("keeps an imported App on its studio branch when a member's cowboy choice slipped through", async () => {
    const { studio, shipper, forge, app, change, store } = await setup({ source: imported });
    studio.updateApp(app.id, { shipMode: "cowboy" });
    store.put(SHIP_COLLECTIONS.choices, { id: app.id, mode: "cowboy", by: "member@x.test", role: "member", at: "2026-10-22T10:00:00Z" });
    const before = forge.branchSha(web, "main");
    await change();
    expect(forge.branchSha(web, "main")).toBe(before);
    expect(shipper.repo(app.id)).toMatchObject({ createdByKiln: false });
  });

  it("asks for a credential for this one repository on every push", async () => {
    const asked: string[] = [];
    const counting = (f: FakeForge): Forge =>
      Object.assign(Object.create(f) as FakeForge, {
        sandboxToken: async (r: RepoRef) => {
          asked.push(`${r.owner}/${r.name}`);
          return undefined;
        },
      });
    const { shipper, app } = await setup({ source: imported, forge: counting });
    await shipper.push(app.id, admin);
    await shipper.push(app.id, admin);
    expect(asked).toEqual(["acme/web", "acme/web"]);
  });

  it("asks the forge for a credential per push and keeps it out of errors and the workspace", async () => {
    const leaky = (f: FakeForge): Forge =>
      Object.assign(Object.create(f) as FakeForge, {
        sandboxToken: async () => "s3cret-token",
        cloneUrl: (r: RepoRef) => `/nonexistent/s3cret-token/${r.owner}/${r.name}.git`,
      });
    const { shipper, studio, app, audit } = await setup({ source: imported, forge: leaky });
    const error = await shipper.push(app.id, admin).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("s3cret-token");
    expect(JSON.stringify(audit)).not.toContain("s3cret-token");
    const config = await studio.withWorkspace(app.id, async (s) => (await s.exec("git remote -v; cat .git/config", { cwd: "app", trusted: true })).stdout);
    expect(config).not.toContain("s3cret-token");
  });

  it("pushes only the studio branch of a template App pointed at a repository Kiln didn't create", async () => {
    const { shipper, forge, app, store } = await setup();
    store.put<AppRepo>(SHIP_COLLECTIONS.repos, { id: app.id, forge: "fake", repo: "acme/web", createdByKiln: false, createdAt: "2026-10-22T10:00:00Z" });
    const before = forge.branchSha(web, "main");
    expect(await shipper.push(app.id, admin)).toMatchObject({ branch: `studio/${app.id}` });
    expect(forge.branchSha(web, "main")).toBe(before);
  });
});
