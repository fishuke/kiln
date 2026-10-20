import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { agents, factory, milestones, workItemStates } from "@/lib/factory";

const root = new URL("../../../../", import.meta.url);
const factoryDir = new URL("factory/", root);

function readYaml(path: URL) {
  return parse(readFileSync(path, "utf8"));
}

function frontmatter(path: URL) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  return match ? parse(match[1]) : {};
}

describe("build plan data", () => {
  it("has 49 tasks across 8 milestones", () => {
    expect(milestones).toHaveLength(8);
    expect(milestones.reduce((sum, m) => sum + m.tasks, 0)).toBe(49);
  });

  it("matches the task count in docs/plan/PLAN.md", () => {
    const plan = readFileSync(new URL("docs/plan/PLAN.md", root), "utf8");
    const taskLines = plan.split("\n").filter((line) => /^[-*] \[[ x]\] \*\*M\d-T\d/.test(line));
    expect(taskLines.length).toBe(49);
  });
});

describe("work item lifecycle", () => {
  it("lists the nine documented states in order", () => {
    expect(workItemStates).toEqual([
      "received",
      "triaging",
      "planning",
      "awaiting_spec",
      "building",
      "reviewing",
      "awaiting_preview",
      "handed_off",
      "complete",
    ]);
  });
});

describe("factory definition", () => {
  it("factory.yaml uses schema v1alpha1 and the same name and alias as the app", () => {
    const def = readYaml(new URL("factory.yaml", factoryDir));
    expect(def.schemaVersion).toBe("v1alpha1");
    expect(def.name).toBe(factory.name);
    expect(def.alias).toBe(factory.alias);
    expect(`${def.repositories[0].owner}/${def.repositories[0].name}`).toBe(factory.repository);
  });

  it("every agent folder has an agent.md whose agentType matches the app", () => {
    for (const agent of agents) {
      const path = new URL(`agents/${agent.name}/agent.md`, factoryDir);
      expect(existsSync(path), `${agent.name}/agent.md`).toBe(true);
      expect(frontmatter(path).agentType).toBe(agent.agentType);
    }
  });

  it("has no agent folder that the app does not list", () => {
    const folders = readdirSync(new URL("agents/", factoryDir));
    expect(folders.sort()).toEqual(agents.map((a) => a.name).sort());
  });

  it("runner image and automation trigger are present", () => {
    const runner = readYaml(new URL("runners/linux-node.yaml", factoryDir));
    expect(runner.platform.linux.dockerImage).toBe("node:22-bookworm");
    const automation = frontmatter(new URL("automations/kiln-ready/automation.md", factoryDir));
    expect(automation.triggers[0].filter.labels).toEqual(["kiln-ready"]);
  });
});
