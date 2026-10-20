import { describe, expect, it } from "vitest";
import { buildTree, cleanPath, languageFor, newResource, parseDiagnostic } from "./definition-tree";
import { parseFrontmatter } from "./frontmatter";

describe("definition tree", () => {
  it("builds folders first", () => {
    const t = buildTree(["factory.yaml", "agents/a/agent.md", "agents/b/agent.md", "runners/default.yaml"], ["skills/new"]);
    expect(t.children.map((c) => c.name)).toEqual(["agents", "runners", "skills", "factory.yaml"]);
    expect(t.children[0]!.children.map((c) => c.path)).toEqual(["agents/a", "agents/b"]);
    expect(t.children[2]!.children[0]!.path).toBe("skills/new");
  });

  it("parses diagnostics", () => {
    expect(parseDiagnostic('factory.yaml:1: Unrecognized key: "bogus"', "error")).toEqual({ severity: "error", path: "factory.yaml", line: 1, message: 'Unrecognized key: "bogus"' });
    expect(parseDiagnostic("automations/slack/automation.md:3: triggers.0.provider: Invalid", "error")).toMatchObject({ path: "automations/slack/automation.md", line: 3, message: "triggers.0.provider: Invalid" });
    expect(parseDiagnostic("no factory.yaml at the root", "error")).toEqual({ severity: "error", message: "no factory.yaml at the root" });
  });

  it("cleans paths", () => {
    expect(cleanPath("/skills//x/SKILL.md")).toBe("skills/x/SKILL.md");
    expect(cleanPath("../etc/passwd")).toBeNull();
    expect(cleanPath("  ")).toBeNull();
  });

  it("knows languages", () => {
    expect(languageFor("factory.yaml")).toBe("yaml");
    expect(languageFor("agents/x/agent.md")).toBe("markdown");
    expect(languageFor("skills/github/scripts/resolve-threads")).toBe("shell");
  });

  it("makes valid starter files", () => {
    const s = newResource("scorer", "coverage", { agent: "implement", model: "m" });
    expect(s.path).toBe("scorers/coverage/scorer.md");
    expect(parseFrontmatter(s.content).data).toMatchObject({ name: "coverage", agents: ["implement"], passingScore: 0.5 });
    expect(parseFrontmatter(newResource("automation", "Nightly").content).data.triggers).toHaveLength(1);
  });
});
