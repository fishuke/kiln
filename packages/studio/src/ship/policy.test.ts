import { describe, expect, it } from "vitest";
import type { App } from "../types";
import { assertPushAllowed, maxShipMode, pushTarget, studioBranch, type PushContext } from "./policy";
import { PushRefused, type AppRepo, type ShipModeChoice } from "./types";

const at = "2026-10-22T10:00:00.000Z";
const base = {
  team: "t1",
  harness: "claude-code",
  status: "ready",
  createdBy: "creator@x.test",
  createdAt: at,
  updatedAt: at,
} as const;
const setup = { packageManager: "pnpm" as const, install: [], envRequired: [], envMissing: [] };

const templateApp: App = {
  ...base,
  id: "sa_t",
  name: "Daily Done",
  source: { kind: "template", template: "nextjs" },
  setup: { ...setup, mainBranch: "main" },
  shipMode: "cowboy",
};
const importedApp: App = {
  ...base,
  id: "sa_i",
  name: "Web",
  source: { kind: "repo", repo: "acme/web" },
  setup: { ...setup, mainBranch: "trunk" },
  shipMode: "cowboy",
};
const kilnRepo: AppRepo = { id: "sa_t", forge: "github", repo: "acme/daily-done-3f9a1c", createdByKiln: true, createdAt: at };
const importedRepo: AppRepo = { id: "sa_i", forge: "github", repo: "acme/web", createdByKiln: false, createdAt: at };
const choice: ShipModeChoice = { id: "sa_i", mode: "cowboy", by: "admin@x.test", role: "admin", at };

const ctx = (over: Partial<PushContext>): PushContext => ({ app: templateApp, repo: kilnRepo, linkedToFactory: false, ...over });

describe("where a push may go", () => {
  it("lets a template App push main of the repository Kiln created for it", () => {
    const c = ctx({});
    expect(pushTarget(c)).toBe("main");
    expect(() => assertPushAllowed(c, "main")).not.toThrow();
  });

  it("lets an imported App push its main branch once a person chose cowboy", () => {
    const c = ctx({ app: importedApp, repo: importedRepo, choice });
    expect(pushTarget(c)).toBe("trunk");
    expect(() => assertPushAllowed(c, "trunk")).not.toThrow();
  });

  it("never pushes the main branch of a repository linked to a factory", () => {
    for (const c of [ctx({ linkedToFactory: true }), ctx({ app: importedApp, repo: importedRepo, choice, linkedToFactory: true })]) {
      expect(pushTarget(c)).toBe(studioBranch(c.app.id));
      expect(() => assertPushAllowed(c, c.app.setup!.mainBranch)).toThrow(PushRefused);
      expect(() => assertPushAllowed(c, c.app.setup!.mainBranch)).toThrow(/linked to a factory/);
    }
  });

  it("keeps an imported App in cowboy without a person's recorded choice on its studio branch", () => {
    const c = ctx({ app: importedApp, repo: importedRepo });
    expect(pushTarget(c)).toBe("studio/sa_i");
    expect(() => assertPushAllowed(c, "trunk")).toThrow(/chose cowboy/);
  });

  it("needs a team owner or admin's cowboy choice for an imported App's main branch", () => {
    const c = ctx({ app: importedApp, repo: importedRepo, choice: { ...choice, by: "m@x.test", role: "member" } });
    expect(pushTarget(c)).toBe("studio/sa_i");
    expect(() => assertPushAllowed(c, "trunk")).toThrow(/owner or admin/);
  });

  it("ignores a cowboy choice once the App's ship mode changed again", () => {
    const c = ctx({ app: { ...importedApp, shipMode: "review" }, repo: importedRepo, choice });
    expect(pushTarget(c)).toBe("studio/sa_i");
    expect(() => assertPushAllowed(c, "trunk")).toThrow(PushRefused);
  });

  it("refuses main of a template App's repository that Kiln didn't create", () => {
    const c = ctx({ repo: { ...kilnRepo, createdByKiln: false } });
    expect(pushTarget(c)).toBe("studio/sa_t");
    expect(() => assertPushAllowed(c, "main")).toThrow(/Kiln created/);
  });

  it("pushes the studio branch in safe and review mode", () => {
    expect(pushTarget(ctx({ app: { ...templateApp, shipMode: "review" } }))).toBe("studio/sa_t");
    expect(pushTarget(ctx({ app: { ...templateApp, shipMode: "safe" } }))).toBe("studio/sa_t");
  });

  it("refuses every other branch", () => {
    expect(() => assertPushAllowed(ctx({}), "studio/sa_other")).toThrow(/only studio\/sa_t/);
    expect(() => assertPushAllowed(ctx({ app: importedApp, repo: importedRepo, choice }), "main")).toThrow(PushRefused);
  });

  it("refuses a repository record of another App", () => {
    expect(() => assertPushAllowed(ctx({ repo: { ...kilnRepo, id: "sa_other" } }), "studio/sa_t")).toThrow(/another App/);
    expect(() => assertPushAllowed(ctx({ app: importedApp, repo: { ...importedRepo, repo: "acme/other" } }), "studio/sa_i")).toThrow(/acme\/web/);
  });
});

describe("ship-mode caps", () => {
  const open = { maxShipMode: "cowboy" as const, roles: {} };

  it("lets owners and admins use cowboy anywhere", () => {
    expect(maxShipMode(importedApp, open, { by: "a@x.test", role: "admin" })).toBe("cowboy");
    expect(maxShipMode(importedApp, open, { by: "o@x.test", role: "owner" })).toBe("cowboy");
  });

  it("lets the creator of a template App use cowboy", () => {
    expect(maxShipMode(templateApp, open, { by: "creator@x.test", role: "member" })).toBe("cowboy");
  });

  it("caps other members and every non-admin on an imported App at review", () => {
    expect(maxShipMode(templateApp, open, { by: "other@x.test", role: "member" })).toBe("review");
    expect(maxShipMode(importedApp, open, { by: "creator@x.test", role: "member" })).toBe("review");
    expect(maxShipMode(importedApp, open, { by: "nobody@x.test" })).toBe("safe");
  });

  it("lowers the cap to the App policy's highest mode and its cap for the role", () => {
    expect(maxShipMode(templateApp, { maxShipMode: "review", roles: {} }, { by: "a@x.test", role: "admin" })).toBe("review");
    expect(maxShipMode(templateApp, { maxShipMode: "cowboy", roles: { member: "safe" } }, { by: "creator@x.test", role: "member" })).toBe("safe");
  });

  it("never raises a member above ADR-012's default", () => {
    expect(maxShipMode(importedApp, { maxShipMode: "cowboy", roles: { member: "cowboy" } }, { by: "m@x.test", role: "member" })).toBe("review");
  });
});
