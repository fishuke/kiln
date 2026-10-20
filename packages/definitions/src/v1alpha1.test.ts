import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTree } from "./tree";
import { importV1alpha1 } from "./v1alpha1";
import { formatErrors, validateTree } from "./validate";

const fixtures = fileURLToPath(new URL("../fixtures/v1alpha1/", import.meta.url));

describe("kiln import (v1alpha1 → kiln/v1)", () => {
  it.each(readdirSync(fixtures))("converts and validates %s", (name) => {
    const { tree } = importV1alpha1(loadTree(`${fixtures}${name}`));
    const result = validateTree(tree);
    expect(result.ok ? "" : formatErrors(result.errors)).toBe("");
  });

  it("keeps integration settings, cloud providers, Teams/ADO triggers and automation overrides", () => {
    const { tree, warnings } = importV1alpha1({
      "factory.yaml": [
        "schemaVersion: v1alpha1",
        "name: Ops",
        "codeForges: [AZURE_DEVOPS]",
        "repositories: [{ owner: acme, name: api }]",
        "agentDefaults: { model: claude-sonnet-5-5 }",
        "integrations:",
        "  - type: microsoft-teams",
        "    microsoft-teams: { autoRespondToThreadReplies: false }",
        "  - type: jira",
        "github: { factoryConfigChecks: all }",
        "providers: { aws: { roleArn: 'arn:aws:iam::123456789012:role/kiln' } }",
      ].join("\n"),
      "agents/foreman/agent.md": "---\nagentType: MAIN\n---\nLead.\n",
      "automations/teams.md": "---\nidleTimeoutMinutes: 20\nworkerHost: gpu\nrequired_repos: [{ owner: acme, name: docs }]\ntriggers:\n  - provider: teams\n    event: app_mention\n  - provider: azure_devops\n    event: work_item_assigned\n---\nGo.\n",
    });
    const result = validateTree(tree);
    if (!result.ok) throw new Error(formatErrors(result.errors));
    const r = result.resolved;
    expect(r.factory.repositories[0]!.forge).toBe("azure_devops");
    expect(r.factory.integrations).toEqual([{ type: "microsoft-teams", "microsoft-teams": { autoRespondToThreadReplies: false } }, { type: "jira" }]);
    expect(r.factory.cloudProviders?.aws?.roleArn).toMatch(/role\/kiln/);
    expect(r.parsed.automations.teams!.frontmatter).toMatchObject({ idleTimeoutMinutes: 20, workerHost: "gpu", required_repos: ["acme/docs"] });
    expect(warnings).toContain("factory.yaml: providers renamed to cloudProviders");
  });

  it("maps names, harnesses, credentials and runners, and reports what it dropped", () => {
    const { tree, warnings } = importV1alpha1(loadTree(`${fixtures}full`));
    const result = validateTree(tree);
    if (!result.ok) throw new Error(formatErrors(result.errors));
    const r = result.resolved;
    expect(r.factory).toMatchObject({ name: "Web Platform", alias: "Web Platform", credentialStrategy: "EXECUTOR", integrations: [{ type: "slack" }, { type: "linear" }] });
    expect(r.factory.selfImprovement?.reviewers).toEqual({ type: "custom", emails: ["lead@acme.test"] });
    expect(r.agents["Web Implement"]!.harness).toEqual({ type: "claude-code", model: "frontier-high", auth: { source: "secret", secretName: "TEAM_ANTHROPIC" } });
    expect(r.agents["Local Builder"]!.harness.type).toBe("opencode");
    expect(r.agents["Web Foreman"]!.agentType).toBe("FOREMAN");
    expect(r.parsed.scorers["Code Quality"]!.frontmatter).toMatchObject({ name: "Code Quality", agents: ["Web Implement"] });
    expect(r.parsed.runners.default!.image).toBe("ubuntu:24.04");
    expect(r.parsed.benchmarks.core!.tasks["fix-typo"]!.successCriteria).toEqual(["README has no typo"]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        "factory.yaml: dropped secrets (not supported by kiln/v1)",
        "runners/mac.yaml: macos runners are not supported; using linux",
        "routers/auto.yaml: added a complexity router to stand in for the auto model",
      ]),
    );
  });
});
