import { describe, expect, it } from "vitest";
import { agentFormFromSource, agentSlug, agentSourceFromForm, emptyAgentForm } from "./agent-file";
import { parseFrontmatter, patchYaml, updateFrontmatter } from "./frontmatter";

const SOURCE = `---
# routes every request
agentType: FOREMAN
description: Routes work
skills: [house-style]
harness: { type: claude-code, model: claude-sonnet-5-5 }
---
# Foreman

You coordinate the factory.
`;

describe("frontmatter", () => {
  it("parses data and body", () => {
    const fm = parseFrontmatter(SOURCE);
    expect(fm.data.agentType).toBe("FOREMAN");
    expect(fm.body.startsWith("# Foreman")).toBe(true);
  });

  it("returns the whole text as body without a fence", () => {
    expect(parseFrontmatter("# Hi\n")).toEqual({ data: {}, body: "# Hi\n", yaml: "" });
  });

  it("keeps comments and unknown keys when patching", () => {
    const out = updateFrontmatter(SOURCE, { description: "New", runner: "linux" });
    expect(out).toContain("# routes every request");
    const fm = parseFrontmatter(out);
    expect(fm.data).toMatchObject({ description: "New", runner: "linux", skills: ["house-style"] });
    expect(fm.body).toContain("You coordinate the factory.");
  });

  it("deletes keys set to undefined and empty parents", () => {
    const y = patchYaml("a: 1\nb:\n  c: 2\n", { "b.c": undefined, a: undefined, d: null });
    expect(y.trim()).toBe("d: null");
  });
});

describe("agent.md round trip", () => {
  it("reads the editor form", () => {
    const f = agentFormFromSource(SOURCE);
    expect(f).toMatchObject({ agentType: "FOREMAN", description: "Routes work", harness: "claude-code", model: "claude-sonnet-5-5", secrets: null, spawnableBy: null, computerUse: true });
    expect(f.prompt).toBe("# Foreman\n\nYou coordinate the factory.");
  });

  it("writes back an unchanged form without losing anything", () => {
    const again = agentSourceFromForm(agentFormFromSource(SOURCE), SOURCE);
    expect(agentFormFromSource(again)).toEqual(agentFormFromSource(SOURCE));
    expect(parseFrontmatter(again).data.skills).toEqual(["house-style"]);
  });

  it("writes harness auth, secrets and inheritance", () => {
    const f = { ...agentFormFromSource(SOURCE), harness: "claude-code", authSecret: "CLAUDE_CODE_OAUTH_TOKEN", secrets: ["GH"], spawnableBy: [], idleTimeoutMinutes: 15, computerUse: false };
    const data = parseFrontmatter(agentSourceFromForm(f, SOURCE)).data;
    expect(data.harness).toEqual({ type: "claude-code", model: "claude-sonnet-5-5", auth: { source: "secret", secretName: "CLAUDE_CODE_OAUTH_TOKEN" } });
    expect(data).toMatchObject({ secrets: ["GH"], spawnableBy: [], idleTimeoutMinutes: 15, computerUse: false });
    const inherit = parseFrontmatter(agentSourceFromForm({ ...f, harness: "", model: "auto", secrets: null, spawnableBy: null, computerUse: true }, SOURCE)).data;
    expect(inherit.harness).toBeUndefined();
    expect(inherit.model).toBe("auto");
    expect("secrets" in inherit).toBe(false);
    expect("computerUse" in inherit).toBe(false);
  });

  it("creates a new custom agent file", () => {
    const out = agentSourceFromForm({ ...emptyAgentForm(), description: "Builds mobile apps", prompt: "# Mobile" });
    expect(out).toBe("---\nagentType: CUSTOM\ndescription: Builds mobile apps\n---\n# Mobile\n");
  });

  it("slugs agent names", () => {
    expect(agentSlug("  Mobile Build Agent! ")).toBe("mobile-build-agent");
  });
});
