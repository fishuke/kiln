import { describe, expect, it } from "vitest";
import type { App } from "../types";
import { assertPushAllowed, pushTarget, studioBranch, type PushContext } from "./policy";
import { PushRefused, type AppRepo } from "./types";

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

const ctx = (over: Partial<PushContext>): PushContext => ({ app: templateApp, repo: kilnRepo, pushDefaultBranch: false, linkedToFactory: false, ...over });
const optedIn = (over: Partial<PushContext> = {}) => ctx({ app: importedApp, repo: importedRepo, pushDefaultBranch: true, ...over });

describe("where a push may go", () => {
  it("lets a template App push main of the repository Kiln created for it", () => {
    const c = ctx({});
    expect(pushTarget(c)).toBe("main");
    expect(() => assertPushAllowed(c, "main")).not.toThrow();
  });

  it("lets an imported App push its main branch when its policy opts in", () => {
    const c = optedIn();
    expect(pushTarget(c)).toBe("trunk");
    expect(() => assertPushAllowed(c, "trunk")).not.toThrow();
  });

  it("never pushes the main branch of a repository linked to a factory", () => {
    for (const c of [ctx({ linkedToFactory: true }), optedIn({ linkedToFactory: true })]) {
      expect(pushTarget(c)).toBe(studioBranch(c.app.id));
      expect(() => assertPushAllowed(c, c.app.setup!.mainBranch)).toThrow(PushRefused);
      expect(() => assertPushAllowed(c, c.app.setup!.mainBranch)).toThrow(/linked to a factory/);
    }
  });

  it("keeps an imported App in cowboy on its studio branch until its policy opts in", () => {
    const c = ctx({ app: importedApp, repo: importedRepo });
    expect(pushTarget(c)).toBe("studio/sa_i");
    expect(() => assertPushAllowed(c, "trunk")).toThrow(/policy doesn't allow/);
  });

  it("pushes the main branch only in cowboy mode", () => {
    for (const shipMode of ["safe", "review"] as const) {
      const c = optedIn({ app: { ...importedApp, shipMode } });
      expect(pushTarget(c)).toBe("studio/sa_i");
      expect(() => assertPushAllowed(c, "trunk")).toThrow(/only cowboy/);
    }
    expect(pushTarget(ctx({ app: { ...templateApp, shipMode: "review" } }))).toBe("studio/sa_t");
  });

  it("refuses main of a template App's repository that Kiln didn't create", () => {
    const c = ctx({ repo: { ...kilnRepo, createdByKiln: false } });
    expect(pushTarget(c)).toBe("studio/sa_t");
    expect(() => assertPushAllowed(c, "main")).toThrow(/Kiln created/);
  });

  it("refuses every other branch", () => {
    expect(() => assertPushAllowed(ctx({}), "studio/sa_other")).toThrow(/only studio\/sa_t/);
    expect(() => assertPushAllowed(optedIn(), "main")).toThrow(PushRefused);
  });

  it("refuses a repository record of another App", () => {
    expect(() => assertPushAllowed(ctx({ repo: { ...kilnRepo, id: "sa_other" } }), "studio/sa_t")).toThrow(/another App/);
    expect(() => assertPushAllowed(ctx({ app: importedApp, repo: { ...importedRepo, repo: "acme/other" } }), "studio/sa_i")).toThrow(/acme\/web/);
  });
});
