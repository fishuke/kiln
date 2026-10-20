import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { AUTOMATION_TEMPLATES, availableTemplates, buildFactoryTree, MODEL_PRESETS, type WizardInput } from "./factory-template";
import { parseFrontmatter } from "./frontmatter";

const base: WizardInput = {
  name: "Web App",
  alias: "webapp",
  description: "The storefront",
  forge: "github",
  repositories: [{ owner: "acme", name: "web" }],
  setupCommands: [],
  agents: ["triage", "implement", "review"],
  chat: [{ type: "slack", channels: ["C123"] }],
  tracker: { type: "linear", keys: [] },
  selfImprovement: true,
  preset: "quality",
  models: { ...MODEL_PRESETS.quality, review: "gpt-6" },
  automations: ["github-issues", "ci-failures", "unknown"],
};

describe("buildFactoryTree", () => {
  const tree = buildFactoryTree(base);

  it("writes factory.yaml", () => {
    const f = parse(tree["factory.yaml"]!);
    expect(f).toMatchObject({ schemaVersion: "kiln/v1", name: "Web App", alias: "webapp", repositories: [{ owner: "acme", name: "web" }], agentDefaults: { runner: "default" } });
    expect(f.integrations).toEqual(["github", { type: "slack", slack: { channels: ["C123"] } }, "linear"]);
    expect(f.selfImprovement.failedRunThreshold).toBe(10);
  });

  it("writes the foreman and the chosen agents with harness per model", () => {
    expect(Object.keys(tree).filter((p) => p.startsWith("agents/")).sort()).toEqual(["agents/foreman/agent.md", "agents/implement/agent.md", "agents/review/agent.md", "agents/triage/agent.md"]);
    const review = parseFrontmatter(tree["agents/review/agent.md"]!);
    expect(review.data).toMatchObject({ agentType: "REVIEW", harness: { type: "codex", model: "gpt-6" } });
    expect(parseFrontmatter(tree["agents/foreman/agent.md"]!).body).toContain("factory:webapp");
  });

  it("seeds scorers only with self-improvement, and automations from templates", () => {
    expect(parseFrontmatter(tree["scorers/code-quality/scorer.md"]!).data.agents).toEqual(["implement"]);
    const ci = parseFrontmatter(tree["automations/ci-failures/automation.md"]!).data as { triggers: { filter: { labels: string[] } }[] };
    expect(ci.triggers[0]!.filter.labels).toEqual(["factory:webapp"]);
    expect(tree["automations/unknown/automation.md"]).toBeUndefined();
    const noSi = buildFactoryTree({ ...base, selfImprovement: false, agents: [] });
    expect(Object.keys(noSi).some((p) => p.startsWith("scorers/"))).toBe(false);
  });

  it("filters templates by integrations", () => {
    expect(availableTemplates(AUTOMATION_TEMPLATES, ["github"]).map((t) => t.provider)).not.toContain("linear");
    expect(availableTemplates(AUTOMATION_TEMPLATES, ["github", "linear"]).length).toBe(AUTOMATION_TEMPLATES.length);
  });
});
