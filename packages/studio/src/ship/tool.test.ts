import { afterEach, describe, expect, it } from "vitest";
import type { Studio } from "../studio";
import { runTool, STUDIO_TOOLS } from "../tools";
import { shipFixture } from "./fixture";

const studios: Studio[] = [];
afterEach(async () => {
  for (const s of studios.splice(0)) await s.shutdown();
});

const caller = { team: "t1", by: "creator@x.test", via: "voice" as const, role: "member" as const };

async function setup() {
  const f = await shipFixture({ source: { kind: "repo", repo: "acme/web" }, shipMode: "safe" });
  studios.push(f.studio);
  return f;
}

describe("the ship tool", () => {
  it("is a server tool", () => {
    expect(STUDIO_TOOLS.find((t) => t.name === "ship")).toMatchObject({ kind: "server" });
  });

  it("opens the App's pull request, then marks it ready for review as the caller", async () => {
    const { studio, shipper, app, change } = await setup();
    await change();
    const opened = await runTool(studio, "ship", { app: app.id, title: "Add a note" }, caller, shipper);
    expect(opened).toMatchObject({ ok: true, data: { state: "uat", createdBy: "creator@x.test" } });
    const ready = await runTool(studio, "ship", { app: app.id, state: "ready_for_review" }, caller, shipper);
    expect(ready).toMatchObject({ ok: true, data: { state: "waiting_for_review" } });
  });

  it("validates its input", async () => {
    const { studio, shipper, app } = await setup();
    expect(await runTool(studio, "ship", { app: app.id, state: "merged" }, caller, shipper)).toMatchObject({
      ok: false,
      error: expect.stringContaining("state"),
    });
  });

  it("acts only on the caller's team's Apps", async () => {
    const { studio, shipper, app } = await setup();
    expect(await runTool(studio, "ship", { app: app.id }, { ...caller, team: "t2" }, shipper)).toEqual({ ok: false, error: `unknown app ${app.id}` });
  });

  it("answers plainly when the server has no shipping", async () => {
    const { studio, app } = await setup();
    expect(await runTool(studio, "ship", { app: app.id }, caller)).toEqual({ ok: false, error: "shipping isn't configured on this server" });
  });

  it("changes the ship mode through the cap check, as the caller", async () => {
    const { studio, shipper, app, policy } = await setup();
    policy.roles.member = "review";
    expect(await runTool(studio, "set_ship_mode", { app: app.id, mode: "cowboy" }, caller, shipper)).toEqual({
      ok: false,
      error: "creator@x.test may use at most review on this App",
    });
    expect(await runTool(studio, "set_ship_mode", { app: app.id, mode: "review" }, caller, shipper)).toMatchObject({ ok: true, data: { shipMode: "review" } });
    expect(shipper.choice(app.id)).toMatchObject({ mode: "review", by: "creator@x.test", role: "member" });
  });

  it("doesn't let open_app pick a ship mode around the cap check", async () => {
    const { studio, shipper } = await setup();
    const r = await runTool(studio, "open_app", { name: "X", source: { kind: "template", template: "test" }, shipMode: "cowboy" }, caller, shipper);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("shipMode") });
  });
});
