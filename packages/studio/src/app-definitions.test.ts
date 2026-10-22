import { MemoryStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { AppDefinitionError, AppDefinitions, maxShipMode, validateAppTree, type DefinitionTarget } from "./app-definitions";
import { StudioError } from "./types";

const clock = { now: () => new Date("2026-10-22T10:00:00Z") };
const defs = () => new AppDefinitions({ store: new MemoryStore(), clock });

const app: DefinitionTarget = { team: "t1", projectId: "p1", appId: "sa_1" };
const skill = (name: string, body = `Use ${name}.`) => `---\nname: ${name}\ndescription: ${name} rules\n---\n${body}\n`;
const agent = (fm: string, body = "") => `---\n${fm}\n---\n${body}\n`;

describe("validateAppTree", () => {
  it("accepts an App layer in kiln/v1 layout with factory-format agents", () => {
    const r = validateAppTree({
      "app.yaml": "schemaVersion: kiln/v1\nname: Pricing\nskills: { mandatory: [house-style] }\nbudgets: { monthlyUsd: 200 }\n",
      "agents/implementer/agent.md": agent("description: Writes the change\nmodel: claude-sonnet-5-5\nmcpServers: [figma]", "Build it."),
      "agents/reviewer/agent.md": agent("model: claude-opus-5-5\nspawnableBy: [implementer]"),
      "agents/reviewer/skills/checklist/SKILL.md": skill("checklist"),
      "skills/house-style/SKILL.md": skill("house-style"),
      "policies/studio.yaml": "shipMode: { max: review }\nmergeGate: false\n",
      "README.md": "# notes",
    });
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.agents)).toEqual(["implementer", "reviewer"]);
    expect(Object.keys(r.agents.reviewer!.skills)).toEqual(["checklist"]);
  });

  it("rejects what doesn't apply to Apps, with file and line", () => {
    const r = validateAppTree({
      "app.yaml": "schemaVersion: kiln/v1\nskills:\n  mandatory: [missing]\n",
      "pipelines/feature.yaml": "stages: []\n",
      "automations/nightly.md": "---\ntriggers: []\n---\n",
      "agents/a/agent.md": agent("harness: { type: codex }\nmodel: gpt-5"),
      "agents/b/agent.md": agent("model: m\nspawnableBy: [nobody]"),
      "notes.txt": "hi",
    });
    expect(r.errors.map((e) => `${e.file}:${e.line}: ${e.message}`)).toEqual([
      "agents/a/agent.md:3: set exactly one of model or harness, not both",
      "agents/b/agent.md:3: spawnableBy names unknown agent nobody",
      "app.yaml:3: mandatory skill missing is not defined in skills/",
      "automations/nightly.md:1: automations don't apply to Apps",
      "notes.txt:1: notes.txt is not a known App definition file",
      "pipelines/feature.yaml:1: pipelines don't apply to Apps",
    ]);
  });

  it("finds skills and agents in inherited layers and warns about factory-only agent keys", () => {
    const r = validateAppTree(
      {
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [house-style] }\n",
        "agents/x/agent.md": agent("runner: linux\nmodel: m\nspawnableBy: [general]"),
      },
      { inheritedSkills: ["house-style"], inheritedAgents: ["general"] },
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual(["runner doesn't apply to an App and is ignored"]);
  });
});

describe("AppDefinitions", () => {
  it("gives a new App one general agent, then layers team and project defaults", () => {
    const d = defs();
    expect(Object.keys(d.resolve(app).agents)).toEqual(["general"]);
    expect(d.resolve(app).agents.general).toMatchObject({ harness: { type: "claude-code" }, mcpServers: [] });
    d.save(
      { team: "t1" },
      {
        "agents/general/agent.md": agent("model: claude-sonnet-5-5\nmcpServers: [sentry]", "Team rules."),
        "skills/house-style/SKILL.md": skill("house-style"),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [house-style] }\nbudgets: { monthlyUsd: 500 }\n",
      },
      "ann",
    );
    d.save(
      { team: "t1", projectId: "p1" },
      {
        "agents/general/agent.md": agent("mcpServers: [figma]"),
        "agents/reviewer/agent.md": agent("description: Reviews\nmodel: claude-opus-5-5"),
        "policies/guard.yaml": "shipMode: { max: review }\n",
        "app.yaml": "schemaVersion: kiln/v1\nbudgets: { monthlyUsd: 900 }\n",
      },
      "ann",
    );
    const r = d.resolve(app);
    expect(r.agents.general).toMatchObject({
      harness: { type: "claude-code", model: "claude-sonnet-5-5" },
      mcpServers: ["figma"],
      instructions: "Team rules.",
      skills: ["house-style"],
      spawnableBy: ["reviewer"],
      from: "project",
    });
    expect(r.agents.reviewer).toMatchObject({ description: "Reviews", harness: { type: "claude-code", model: "claude-opus-5-5" }, skills: ["house-style"] });
    expect(r.mandatorySkills).toEqual(["house-style"]);
    expect(r.policy).toMatchObject({ maxShipMode: "review", roles: {}, pushDefaultBranch: false, mergeGate: false });
    expect(r.monthlyUsd).toBe(500);
    expect(r.layers.map((l) => l.kind)).toEqual(["builtin", "team", "project", "app"]);
  });

  it("lets a later layer override but never drop a mandatory skill or loosen a cap", () => {
    const d = defs();
    d.save(
      { team: "t1" },
      {
        "skills/a/SKILL.md": skill("a", "Team a."),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [a] }\n",
        "policies/team.yaml": "shipMode: { max: review, roles: { member: safe } }\n",
        "agents/general/agent.md": agent("harness: { type: codex, model: gpt-5 }"),
      },
      "ann",
    );
    d.save(
      app,
      {
        "skills/a/SKILL.md": skill("a", "App a."),
        "skills/b/SKILL.md": skill("b"),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [b] }\n",
        "policies/studio.yaml": "shipMode: { max: cowboy }\nmergeGate: false\n",
        "agents/general/agent.md": agent("model: gpt-5-codex"),
      },
      "bob",
    );
    const r = d.resolve(app);
    expect(r.mandatorySkills).toEqual(["a", "b"]);
    expect(r.skills.a).toMatchObject({ body: "App a.", from: "app" });
    expect(r.agents.general!.harness).toEqual({ type: "codex", model: "gpt-5-codex" });
    expect(r.policy).toMatchObject({ maxShipMode: "review", roles: { member: "safe" }, mergeGate: false });
    expect(maxShipMode(r.policy, "member")).toBe("safe");
    expect(maxShipMode(r.policy, "admin")).toBe("review");
    expect(maxShipMode(r.policy)).toBe("review");
  });

  it("keeps the merge gate and default-branch pushes off until a person turns them on, and records who did", () => {
    let now = "2026-10-22T10:00:00.000Z";
    const d = new AppDefinitions({ store: new MemoryStore(), clock: { now: () => new Date(now) } });
    expect(d.policy(app)).toMatchObject({ mergeGate: false, pushDefaultBranch: false, changedBy: {} });
    d.edit(app, { policy: { mergeGate: true, pushDefaultBranch: true } }, "olga@acme.test");
    expect(d.policy(app)).toMatchObject({
      mergeGate: true,
      pushDefaultBranch: true,
      changedBy: { mergeGate: { by: "olga@acme.test", at: now, layer: "app" }, pushDefaultBranch: { by: "olga@acme.test", at: now, layer: "app" } },
    });
    now = "2026-10-22T11:00:00.000Z";
    d.edit({ team: "t1" }, { policy: { mergeGate: false } }, "ada@acme.test");
    d.edit(app, { name: "Unrelated" }, "max@acme.test");
    const p = d.policy(app);
    expect(p.mergeGate).toBe(false);
    expect(p.changedBy.mergeGate).toEqual({ by: "ada@acme.test", at: now, layer: "team" });
    expect(p.changedBy.pushDefaultBranch?.by).toBe("olga@acme.test");
  });

  it("stores every change by content hash and moves the ref back with use", () => {
    const d = defs();
    const first = d.save(app, { "app.yaml": "schemaVersion: kiln/v1\nname: One\n" }, "ann");
    expect(first.changed).toBe(true);
    expect(d.save(app, { "app.yaml": "schemaVersion: kiln/v1\nname: One\n" }, "ann")).toEqual({ sha: first.sha, changed: false });
    const second = d.edit(app, { name: "Two" }, "ann");
    expect(second.sha).not.toBe(first.sha);
    expect(d.resolve(app).name).toBe("Two");
    d.use(app, first.sha, "ann");
    expect(d.resolve(app).name).toBe("One");
    expect(d.layer(app).history.map((h) => h.sha)).toEqual([first.sha, second.sha, first.sha]);
    expect(() => d.use(app, "0".repeat(40), "ann")).toThrow(StudioError);
  });

  it("rejects an invalid tree and keeps the current one", () => {
    const d = defs();
    const ok = d.save(app, { "app.yaml": "schemaVersion: kiln/v1\n" }, "ann");
    let err: unknown;
    try {
      d.save(app, { "app.yaml": "schemaVersion: kiln/v1\nbudgets: { perWorkItemUsd: 4 }\n" }, "ann");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppDefinitionError);
    expect((err as AppDefinitionError).message).toBe('app.yaml:2: budgets: Unrecognized key: "perWorkItemUsd"');
    expect(d.layer(app).sha).toBe(ok.sha);
  });

  it("edits the App layer from settings", () => {
    const d = defs();
    d.edit(
      app,
      {
        agents: {
          general: { harness: "codex", model: "gpt-5-codex", instructions: "Be brief.", mcpServers: ["figma"] },
          reviewer: { description: "Reviews", model: "claude-opus-5-5", spawnableBy: ["general"] },
        },
        skills: { upsert: [{ name: "tone", description: "Tone", body: "Friendly." }], mandatory: ["tone"] },
        policy: { maxShipMode: "safe", roles: { member: "safe" }, mergeGate: false },
        budgets: { monthlyUsd: 50 },
      },
      "ann",
    );
    expect(Object.keys(d.layer(app).tree).sort()).toEqual([
      "agents/general/agent.md",
      "agents/reviewer/agent.md",
      "app.yaml",
      "policies/studio.yaml",
      "skills/tone/SKILL.md",
    ]);
    const s = d.settings(app);
    expect(s.resolved.agents).toEqual([
      {
        name: "general",
        harness: "codex",
        model: "gpt-5-codex",
        instructions: "Be brief.",
        mcpServers: ["figma"],
        skills: ["tone"],
        spawnableBy: ["reviewer"],
        from: "app",
      },
      {
        name: "reviewer",
        description: "Reviews",
        harness: "claude-code",
        model: "claude-opus-5-5",
        instructions: "",
        mcpServers: [],
        skills: ["tone"],
        spawnableBy: ["general"],
        from: "app",
      },
    ]);
    expect(s.resolved).toMatchObject({ policy: { maxShipMode: "safe", roles: { member: "safe" }, mergeGate: false }, monthlyUsd: 50 });
    expect(s.own).toMatchObject({
      agents: { general: { harness: "codex", model: "gpt-5-codex" }, reviewer: { description: "Reviews" } },
      mandatory: ["tone"],
      skills: ["tone"],
      policy: { maxShipMode: "safe", roles: { member: "safe" }, mergeGate: false },
      monthlyUsd: 50,
    });
    d.edit(
      app,
      {
        agents: { general: { model: "gpt-5", harness: null }, reviewer: null },
        skills: { remove: ["tone"], mandatory: [] },
        policy: { maxShipMode: null, roles: { member: null }, mergeGate: null },
        budgets: { monthlyUsd: null },
      },
      "ann",
    );
    const after = d.settings(app);
    expect(after.resolved.agents.map((a) => [a.name, a.harness, a.model])).toEqual([["general", "claude-code", "gpt-5"]]);
    expect(after.resolved).toMatchObject({ policy: { maxShipMode: "cowboy", roles: {}, mergeGate: false }, skills: [] });
    expect(d.layer(app).tree["policies/studio.yaml"]).toBeUndefined();
    expect(after.own.monthlyUsd).toBeUndefined();
  });

  it("gives the chat runner an agent's config with the mandatory skills in its instructions", () => {
    const d = defs();
    d.save(
      { team: "t1" },
      {
        "skills/house-style/SKILL.md": skill("house-style", "Named exports."),
        "skills/charts/SKILL.md": skill("charts", "Use recharts."),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [house-style] }\n",
      },
      "ann",
    );
    d.save(
      app,
      {
        "agents/general/agent.md": agent(
          "harness: { type: claude-code, model: claude-opus-5-5, reasoningLevel: high }\nmcpServers: [figma]\nsecrets: [FIGMA_TOKEN]",
          "Build pages.",
        ),
        "agents/reviewer/agent.md": agent("description: Reviews\nmodel: claude-sonnet-5-5"),
        "agents/reviewer/skills/checklist/SKILL.md": skill("checklist", "Check tests."),
      },
      "ann",
    );
    const c = d.chatConfig(app);
    expect(c).toMatchObject({
      agent: "general",
      harness: "claude-code",
      model: "claude-opus-5-5",
      reasoningLevel: "high",
      mandatorySkills: ["house-style"],
      mcpServers: ["figma"],
      secrets: ["FIGMA_TOKEN"],
      maxShipMode: "cowboy",
      mergeGate: false,
    });
    expect(c.instructions).toBe("Build pages.\n\n## house-style\n\nNamed exports.");
    expect(c.skills).toEqual([{ name: "charts", description: "charts rules", body: "Use recharts." }]);
    expect(c.definitionSha).toBe(d.resolve(app).sha);
    const reviewer = d.chatConfig(app, { agent: "reviewer" });
    expect(reviewer).toMatchObject({
      agent: "reviewer",
      description: "Reviews",
      model: "claude-sonnet-5-5",
      instructions: "## house-style\n\nNamed exports.",
      spawnableBy: ["general"],
    });
    expect(reviewer.skills.map((s) => s.name)).toEqual(["charts", "checklist"]);
    const switched = d.chatConfig(app, { harness: "codex" });
    expect([switched.harness, switched.model]).toEqual(["codex", undefined]);
    expect(() => d.chatConfig(app, { agent: "nobody" })).toThrow("unknown agent nobody; this App has general, reviewer");
  });

  it("exports the resolved definition in kiln/v1 layout that validates as an App tree", () => {
    const d = defs();
    d.save(
      { team: "t1" },
      {
        "skills/a/SKILL.md": skill("a"),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [a] }\n",
        "policies/guard.yaml": "shipMode: { max: review }\n",
      },
      "ann",
    );
    d.edit(app, { name: "Pricing", agents: { general: { model: "claude-sonnet-5-5" } } }, "ann");
    const tree = d.export(app);
    expect(Object.keys(tree).sort()).toEqual(["agents/general/agent.md", "app.yaml", "policies/team-guard.yaml", "skills/a/SKILL.md"]);
    expect(validateAppTree(tree).errors).toEqual([]);
    expect(Object.keys(d.export(app, { resolved: false })).sort()).toEqual(["agents/general/agent.md", "app.yaml"]);
  });
});
