import { MemoryStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { AppDefinitionError, AppDefinitions, maxShipMode, validateAppTree, type DefinitionTarget } from "./app-definitions";

const clock = { now: () => new Date("2026-10-22T10:00:00Z") };
const defs = () => new AppDefinitions({ store: new MemoryStore(), clock });

const app: DefinitionTarget = { team: "t1", projectId: "p1", appId: "sa_1" };
const skill = (name: string, body = `Use ${name}.`) => `---\nname: ${name}\ndescription: ${name} rules\n---\n${body}\n`;
const agent = (fm: string, body = "") => `---\n${fm}\n---\n${body}\n`;

describe("validateAppTree", () => {
  it("accepts an App layer in kiln/v1 layout", () => {
    const r = validateAppTree({
      "app.yaml": "schemaVersion: kiln/v1\nname: Pricing\nskills: { mandatory: [house-style] }\nbudgets: { monthlyUsd: 200 }\n",
      "agents/builder/agent.md": agent("model: claude-sonnet-5-5\nmcpServers: [figma]", "Build it."),
      "skills/house-style/SKILL.md": skill("house-style"),
      "policies/studio.yaml": "shipMode: { max: review }\nmergeGate: false\n",
      "README.md": "# notes",
    });
    expect(r.errors).toEqual([]);
  });

  it("rejects what doesn't apply to Apps, with file and line", () => {
    const r = validateAppTree({
      "app.yaml": "schemaVersion: kiln/v1\nskills:\n  mandatory: [missing]\n",
      "pipelines/feature.yaml": "stages: []\n",
      "automations/nightly.md": "---\ntriggers: []\n---\n",
      "agents/a/agent.md": agent("harness: { type: codex }\nmodel: gpt-5"),
      "agents/b/agent.md": agent("model: m"),
      "notes.txt": "hi",
    });
    expect(r.errors.map((e) => `${e.file}:${e.line}: ${e.message}`)).toEqual([
      "agents/:1: an App has at most one agent, the lead; found a, b",
      "agents/a/agent.md:3: set exactly one of model or harness, not both",
      "app.yaml:3: mandatory skill missing is not defined in skills/",
      "automations/nightly.md:1: automations don't apply to Apps",
      "notes.txt:1: notes.txt is not a known App definition file",
      "pipelines/feature.yaml:1: pipelines don't apply to Apps",
    ]);
  });

  it("finds mandatory skills in inherited layers and warns about factory-only agent keys", () => {
    const r = validateAppTree(
      { "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [house-style] }\n", "agents/x/agent.md": agent("runner: linux\nmodel: m") },
      { inheritedSkills: ["house-style"] },
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual(["runner doesn't apply to an App and is ignored"]);
  });
});

describe("AppDefinitions", () => {
  it("resolves a new App from built-in, team and project defaults", () => {
    const d = defs();
    expect(d.resolve(app).lead).toMatchObject({ name: "builder", harness: { type: "claude-code" }, mcpServers: [] });
    d.save(
      { team: "t1" },
      {
        "agents/lead/agent.md": agent("model: claude-sonnet-5-5\nmcpServers: [sentry]", "Team rules."),
        "skills/house-style/SKILL.md": skill("house-style"),
        "app.yaml": "schemaVersion: kiln/v1\nskills: { mandatory: [house-style] }\nbudgets: { monthlyUsd: 500 }\n",
      },
      "ann",
    );
    d.save(
      { team: "t1", projectId: "p1" },
      {
        "agents/lead/agent.md": agent("mcpServers: [figma]"),
        "policies/guard.yaml": "shipMode: { max: review }\n",
        "app.yaml": "schemaVersion: kiln/v1\nbudgets: { monthlyUsd: 900 }\n",
      },
      "ann",
    );
    const r = d.resolve(app);
    expect(r.lead).toMatchObject({
      name: "lead",
      harness: { type: "claude-code", model: "claude-sonnet-5-5" },
      mcpServers: ["figma"],
      instructions: "Team rules.",
    });
    expect(r.mandatorySkills).toEqual(["house-style"]);
    expect(r.policy).toEqual({ maxShipMode: "review", roles: {}, mergeGate: true });
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
        "policies/team.yaml": "shipMode: { max: review, roles: { customer: safe } }\n",
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
      },
      "bob",
    );
    const r = d.resolve(app);
    expect(r.mandatorySkills).toEqual(["a", "b"]);
    expect(r.skills.a).toMatchObject({ body: "App a.", from: "app" });
    expect(r.policy).toEqual({ maxShipMode: "review", roles: { customer: "safe" }, mergeGate: false });
    expect(maxShipMode(r.policy, "customer")).toBe("safe");
    expect(maxShipMode(r.policy)).toBe("review");
  });

  it("stores every change by content hash and moves the ref back with use", () => {
    const d = defs();
    const scope = app;
    const first = d.save(scope, { "app.yaml": "schemaVersion: kiln/v1\nname: One\n" }, "ann");
    expect(first.changed).toBe(true);
    expect(d.save(scope, { "app.yaml": "schemaVersion: kiln/v1\nname: One\n" }, "ann")).toEqual({ sha: first.sha, changed: false });
    const second = d.edit(scope, { name: "Two" }, "ann");
    expect(second.sha).not.toBe(first.sha);
    expect(d.resolve(app).name).toBe("Two");
    d.use(scope, first.sha, "ann");
    expect(d.resolve(app).name).toBe("One");
    expect(d.layer(scope).history.map((h) => h.sha)).toEqual([first.sha, second.sha, first.sha]);
    expect(() => d.use(scope, "0".repeat(40), "ann")).toThrow(/unknown definition/);
  });

  it("rejects an invalid tree and keeps the current one", () => {
    const d = defs();
    const scope = app;
    const ok = d.save(scope, { "app.yaml": "schemaVersion: kiln/v1\n" }, "ann");
    let err: unknown;
    try {
      d.save(scope, { "app.yaml": "schemaVersion: kiln/v1\nbudgets: { perWorkItemUsd: 4 }\n" }, "ann");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppDefinitionError);
    expect((err as AppDefinitionError).message).toBe('app.yaml:2: budgets: Unrecognized key: "perWorkItemUsd"');
    expect(d.layer(scope).sha).toBe(ok.sha);
  });

  it("edits the App layer from settings", () => {
    const d = defs();
    const scope = app;
    d.edit(
      scope,
      {
        lead: { harness: "codex", model: "gpt-5-codex", instructions: "Be brief.", mcpServers: ["figma"] },
        skills: { upsert: [{ name: "tone", description: "Tone", body: "Friendly." }], mandatory: ["tone"] },
        policy: { maxShipMode: "safe", mergeGate: false },
        budgets: { monthlyUsd: 50 },
      },
      "ann",
    );
    const tree = d.layer(scope).tree;
    expect(Object.keys(tree).sort()).toEqual(["agents/builder/agent.md", "app.yaml", "policies/studio.yaml", "skills/tone/SKILL.md"]);
    const s = d.settings(app);
    expect(s.resolved.lead).toMatchObject({ harness: "codex", model: "gpt-5-codex", instructions: "Be brief.", mcpServers: ["figma"] });
    expect(s.resolved).toMatchObject({ maxShipMode: "safe", mergeGate: false, monthlyUsd: 50 });
    expect(s.own).toMatchObject({
      harness: "codex",
      model: "gpt-5-codex",
      mandatory: ["tone"],
      skills: ["tone"],
      maxShipMode: "safe",
      mergeGate: false,
      monthlyUsd: 50,
    });
    d.edit(
      scope,
      {
        lead: { model: "gpt-5", harness: null },
        skills: { remove: ["tone"], mandatory: [] },
        policy: { maxShipMode: null, mergeGate: null },
        budgets: { monthlyUsd: null },
      },
      "ann",
    );
    const after = d.settings(app);
    expect(after.resolved.lead).toMatchObject({ harness: "claude-code", model: "gpt-5" });
    expect(after.resolved).toMatchObject({ maxShipMode: "cowboy", mergeGate: true, skills: [] });
    expect(after.own.monthlyUsd).toBeUndefined();
  });

  it("gives the chat runner the lead's config, mandatory skills in its instructions and the other skills", () => {
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
        "agents/builder/agent.md": agent(
          "harness: { type: claude-code, model: claude-opus-5-5, reasoningLevel: high }\nmcpServers: [figma]\nsecrets: [FIGMA_TOKEN]",
          "Build pages.",
        ),
      },
      "ann",
    );
    const c = d.chatConfig(app);
    expect(c).toMatchObject({
      lead: "builder",
      harness: "claude-code",
      model: "claude-opus-5-5",
      reasoningLevel: "high",
      mandatorySkills: ["house-style"],
      mcpServers: ["figma"],
      secrets: ["FIGMA_TOKEN"],
      maxShipMode: "cowboy",
      mergeGate: true,
    });
    expect(c.instructions).toBe("Build pages.\n\n## house-style\n\nNamed exports.");
    expect(c.skills).toEqual([{ name: "charts", description: "charts rules", body: "Use recharts." }]);
    expect(c.definitionSha).toBe(d.resolve(app).sha);
    expect(d.chatConfig(app, { harness: "codex", model: "gpt-5" })).toMatchObject({ harness: "codex", model: "gpt-5" });
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
    d.edit(app, { name: "Pricing", lead: { model: "claude-sonnet-5-5" } }, "ann");
    const tree = d.export(app);
    expect(Object.keys(tree).sort()).toEqual(["agents/builder/agent.md", "app.yaml", "policies/team-guard.yaml", "skills/a/SKILL.md"]);
    expect(validateAppTree(tree).errors).toEqual([]);
    expect(Object.keys(d.export(app, { resolved: false })).sort()).toEqual(["agents/builder/agent.md", "app.yaml"]);
  });
});
