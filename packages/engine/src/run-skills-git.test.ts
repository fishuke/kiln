import { execFileSync } from "node:child_process";
import { FakeHarness, writeSkills } from "@kiln/harness";
import { FakeForge } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { createTestKiln } from "./testing";

const repo = { owner: "acme", name: "web" };
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

describe("factory skills in the working copy", () => {
  it("are never committed, and a repository's own skill of the same name is kept and still committed", async () => {
    const forge = new FakeForge();
    forge.createRepo(repo, {
      "README.md": "# web\n",
      "package.json": '{ "name": "web" }\n',
      ".claude/skills/house-style/SKILL.md": "---\nname: house-style\ndescription: the repo's own\n---\nRepo house style.\n",
      ".claude/skills/release/SKILL.md": "---\nname: release\ndescription: release steps\n---\nTag it.\n",
    });
    const harness = new FakeHarness(async (ctx) => {
      const { sandbox, cwd } = ctx.opts;
      await writeSkills({ ...ctx.opts, skills: [...(ctx.opts.skills ?? []), { name: "factory-only", body: "Factory know-how." }] }, ".claude/skills");
      expect(await sandbox.readFile(`${cwd}/.claude/skills/factory-only/SKILL.md`)).toContain("Factory know-how.");
      await sandbox.writeFile(`${cwd}/src/feature.ts`, "export const feature = 1;\n");
      await sandbox.writeFile(`${cwd}/.claude/skills/release/SKILL.md`, "---\nname: release\ndescription: release steps\n---\nTag it and push.\n");
      return { summary: "done" };
    });
    const { kiln } = createTestKiln({ forge, harness: () => harness });
    const run = await kiln.runs.execute({
      factory: "webapp",
      sha: kiln.defs.require("webapp").appliedSha!,
      agent: "implement",
      prompt: "build",
      branch: "kiln/skills-test",
    });
    expect(run.status).toBe("succeeded");
    const opts = harness.started[0]!;
    expect(opts.skills?.map((s) => s.name)).toContain("house-style");

    const bare = forge.createRepo(repo);
    const files = gitIn(bare, "ls-tree", "-r", "--name-only", "kiln/skills-test").split("\n").filter(Boolean);
    expect(files).toContain("src/feature.ts");
    expect(files.filter((f) => f.startsWith(".claude/skills/")).sort()).toEqual([".claude/skills/house-style/SKILL.md", ".claude/skills/release/SKILL.md"]);
    // The repository's own skill is not overwritten by the factory skill of the same name.
    expect(gitIn(bare, "show", "kiln/skills-test:.claude/skills/house-style/SKILL.md")).toContain("Repo house style.");
    // The agent's change to a repository skill is committed.
    expect(gitIn(bare, "show", "kiln/skills-test:.claude/skills/release/SKILL.md")).toContain("Tag it and push.");
  });
});
