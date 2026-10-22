import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventBus } from "@kiln/events";
import { FakeHarness } from "@kiln/harness";
import { FakeForge, type Forge, type RepoRef } from "@kiln/integrations";
import { LocalSandboxProvider } from "@kiln/sandbox";
import { MemoryObjectStore, MemoryStore } from "@kiln/store";
import { afterEach, describe, expect, it } from "vitest";
import { Studio } from "../studio";
import type { App } from "../types";
import { Shipper, type ShipperOptions } from "./shipper";
import { SHIP_COLLECTIONS, type AppRepo } from "./types";

const studios: Studio[] = [];
afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

const admin = { by: "admin@x.test", role: "admin" as const };
const member = { by: "member@x.test", role: "member" as const };

/** Studio, a fake forge with no branch protection (so only Studio's guard stops a push), and a shipper. */
async function setup(opts: { source?: App["source"]; linked?: string[]; forge?: (f: FakeForge) => Forge; shipMode?: App["shipMode"] } = {}) {
  const harness = new FakeHarness(async ({ opts: o, emit }) => {
    const m = /^write (\S+) (.*)$/.exec(o.prompt);
    if (m) await o.sandbox.writeFile(`${o.cwd}/${m[1]}`, `${m[2]}\n`);
    emit({ type: "message", text: o.prompt });
  });
  const linked = opts.linked ?? [];
  const forge = new FakeForge(undefined, []);
  forge.createRepo({ owner: "acme", name: "web" }, { "README.md": "# web\n", "package.json": '{ "name": "web", "private": true }\n' });
  const store = new MemoryStore();
  const bus = new InMemoryEventBus();
  let t = Date.parse("2026-10-22T10:00:00Z");
  const clock = { now: () => new Date((t += 1000)) };
  const studio = new Studio({
    store,
    objects: new MemoryObjectStore(),
    bus,
    clock,
    sandboxes: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-ship-"))),
    harness: () => harness,
    image: "node:22",
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 60", egress: [] } },
    previewUrl: (target) => `https://${target}.preview.test`,
    clone: async (source) => ({ url: forge.cloneUrl({ owner: source.repo.split("/")[0]!, name: source.repo.split("/")[1]! }) }),
  });
  studios.push(studio);
  const audit: { actor: string; action: string; target: string; details?: unknown }[] = [];
  const options: ShipperOptions = {
    studio,
    store,
    bus,
    clock,
    forge: () => (opts.forge ? opts.forge(forge) : forge),
    newRepo: () => ({ owner: "acme" }),
    linkedToFactory: (repo) => linked.includes(repo),
    audit: (actor, action, target, details) => audit.push({ actor, action, target, details }),
  };
  const shipper = new Shipper(options);
  shipper.start();
  const app = await studio.createApp({
    team: "t1",
    by: "creator@x.test",
    name: "Daily Done",
    source: opts.source ?? { kind: "template", template: "test" },
    ...(opts.shipMode ? { shipMode: opts.shipMode } : {}),
  });
  await studio.ready(app.id);
  /** One chat turn that changes a file, applied (cowboy applies by itself). */
  const change = async (text = "hello") => {
    const { chat } = await studio.newChat(app.id, { by: "creator@x.test", via: "web", prompt: `write note.txt ${text}` });
    await studio.idle(chat.id);
    if (studio.getApp(app.id)!.app.shipMode !== "cowboy") await studio.apply(chat.id, "creator@x.test");
    await shipper.idle(app.id);
  };
  const mainSha = async () =>
    await studio.withWorkspace(app.id, async (s) => (await s.exec("git rev-parse HEAD", { cwd: "app", trusted: true })).stdout.trim());
  return { studio, shipper, forge, app, audit, change, mainSha, linked, store };
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

  it("lets only owners and admins change the App's policy", async () => {
    const { shipper, app } = await setup({ source: imported });
    expect(() => shipper.setPolicy(app.id, { member: "cowboy" }, member)).toThrow(/owners and admins/);
    shipper.setPolicy(app.id, { member: "cowboy" }, admin);
    shipper.setShipMode(app.id, "cowboy", member);
    expect(shipper.choice(app.id)).toMatchObject({ mode: "cowboy", by: "member@x.test" });
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
