import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { FakeForge, type Forge } from "@kiln/integrations";
import { LocalSandboxProvider } from "@kiln/sandbox";
import { Studio } from "../studio";
import type { App } from "../types";
import { FakeStudioMergeGate } from "./merge-gate";
import { Shipper, type ShipperOptions } from "./shipper";
import { AppDefinitions, type AppPolicySummary } from "../app-definitions";
import { studioEngineHooks, studioRuns } from "../engine-port";

export type ShipFixtureOptions = {
  source?: App["source"];
  shipMode?: App["shipMode"];
  /** Repositories a factory names; the test may add to it later. */
  linked?: string[];
  forge?: (f: FakeForge) => Forge;
  shipper?: Pick<ShipperOptions, "previews" | "versionPreviewUrl">;
};

/**
 * For tests: Studio on local sandboxes with a scripted agent ("write <file> <text>"), a fake forge
 * with no branch protection (so only Studio's guard stops a push) holding `acme/web`, and a
 * started Shipper. Call `studio.shutdown()` when done.
 */
export async function shipFixture(opts: ShipFixtureOptions = {}) {
  const harness = new FakeHarness(async ({ opts: o, emit }) => {
    const m = /^write (\S+) (.*)$/.exec(o.prompt);
    if (m) await o.sandbox.writeFile(`${o.cwd}/${m[1]}`, `${m[2]}\n`);
    emit({ type: "message", text: o.prompt });
  });
  const linked = opts.linked ?? [];
  const forge = new FakeForge(undefined, []);
  forge.createRepo({ owner: "acme", name: "web" }, { "README.md": "# web\n", "package.json": '{ "name": "web", "private": true }\n' });
  // Turns are runs of the App's agent through a test Kiln (the engine runs only for a team it knows).
  let studio!: Studio;
  const { kiln } = createTestKiln({ harness: () => harness, ...studioEngineHooks(() => studio) });
  const team = kiln.teams.ensureDefaultTeam().id;
  const store = kiln.store;
  const bus = kiln.bus;
  let t = Date.parse("2026-10-22T10:00:00Z");
  const clock = { now: () => new Date((t += 1000)) };
  studio = new Studio({
    store,
    objects: kiln.objects,
    bus,
    clock,
    sandboxes: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-ship-"))),
    definitions: new AppDefinitions({ store, clock }),
    runs: studioRuns(kiln.runs),
    image: "kiln-runner-studio:test",
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 60", egress: [] } },
    previewUrl: (target) => `https://${target}.preview.test`,
    clone: async (source) => {
      const [owner, name] = source.repo.split("/") as [string, string];
      return { url: forge.cloneUrl({ owner, name }) };
    },
  });
  const audit: { actor: string; action: string; target: string; details?: unknown }[] = [];
  const gate = new FakeStudioMergeGate();
  /** The App policy's ship-mode part; tests may change it. */
  const policy: AppPolicySummary = { maxShipMode: "cowboy", roles: {}, pushDefaultBranch: false, mergeGate: false, changedBy: {} };
  const shipper = new Shipper({
    studio,
    store,
    bus,
    clock,
    forge: () => (opts.forge ? opts.forge(forge) : forge),
    newRepo: () => ({ owner: "acme" }),
    linkedToFactory: (repo) => linked.includes(repo),
    policyOf: () => policy,
    mergeGate: gate,
    audit: (actor, action, target, details) => {
      audit.push({ actor, action, target, details });
    },
    ...opts.shipper,
  });
  shipper.start();
  const app = await studio.createApp({
    team,
    by: "creator@x.test",
    name: "Daily Done",
    source: opts.source ?? { kind: "template", template: "test" },
  });
  await studio.ready(app.id);
  if (opts.shipMode) studio.updateApp(app.id, { shipMode: opts.shipMode });
  /** One chat turn by the creator that changes a file, applied (cowboy applies by itself), and its pushes. */
  const change = async (text = "hello") => {
    const { chat } = await studio.newChat(app.id, { by: "creator@x.test", via: "web", prompt: `write note.txt ${text}` });
    await studio.idle(chat.id);
    if (studio.getApp(app.id)!.app.shipMode !== "cowboy") await studio.apply(chat.id, "creator@x.test");
    await shipper.idle(app.id);
  };
  const mainSha = () => studio.withWorkspace(app.id, async (s) => (await s.exec("git rev-parse HEAD", { cwd: "app", trusted: true })).stdout.trim());
  return { studio, shipper, forge, app, audit, change, mainSha, linked, store, bus, gate, policy, team };
}
