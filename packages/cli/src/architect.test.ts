import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHITECT_MD, detectAgents, installArchitect } from "./architect";

const tmp = () => mkdtempSync(join(tmpdir(), "kiln-arch-"));

describe("Factory Architect", () => {
  it("always writes the portable instructions and the chosen wrappers", () => {
    const dir = tmp();
    const r = installArchitect(dir, { agents: ["claude", "cursor", "copilot"] });
    expect(r.written.sort()).toEqual([
      ".claude/skills/kiln-architect/SKILL.md",
      ".cursor/rules/kiln-architect.mdc",
      ".github/prompts/kiln-architect.prompt.md",
      ".kiln/architect.md",
    ]);
    expect(readFileSync(join(dir, ".kiln/architect.md"), "utf8")).toBe(ARCHITECT_MD);
    const skill = readFileSync(join(dir, ".claude/skills/kiln-architect/SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: kiln-architect\ndescription: /);
    expect(skill).toContain(".kiln/architect.md");
  });

  it("detects the agents a repo already uses, and defaults to Claude Code", () => {
    const dir = tmp();
    expect(detectAgents(dir)).toEqual(["claude"]);
    mkdirSync(join(dir, ".cursor"));
    writeFileSync(join(dir, "AGENTS.md"), "");
    writeFileSync(join(dir, ".github-copilot-placeholder"), "");
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github/copilot-instructions.md"), "");
    expect(detectAgents(dir)).toEqual(["cursor", "copilot"]);
  });

  it("keeps existing files unless forced", () => {
    const dir = tmp();
    mkdirSync(join(dir, ".kiln"));
    writeFileSync(join(dir, ".kiln/architect.md"), "mine");
    const r = installArchitect(dir, { agents: ["claude"] });
    expect(r.kept).toEqual([".kiln/architect.md"]);
    expect(readFileSync(join(dir, ".kiln/architect.md"), "utf8")).toBe("mine");
    installArchitect(dir, { agents: ["claude"], force: true });
    expect(readFileSync(join(dir, ".kiln/architect.md"), "utf8")).toBe(ARCHITECT_MD);
  });

  it("tells the agent to work from evidence, ask before reading chat and before applying", () => {
    for (const step of ["kiln scan --json", "kiln bench from-prs", "kiln validate", "FACTORY.md", "kiln diff", "kiln apply"])
      expect(ARCHITECT_MD).toContain(step);
    expect(ARCHITECT_MD).toMatch(/ask .*before .*(Slack|tracker)/i);
    expect(ARCHITECT_MD).toMatch(/never copy secrets/i);
    expect(existsSync).toBeTypeOf("function");
  });
});
