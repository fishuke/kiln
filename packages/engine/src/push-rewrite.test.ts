import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHarness, type FakeScriptContext } from "@kiln/harness";
import { describe, expect, it } from "vitest";
import { createTestKiln } from "./testing";

const branch = "kiln/rewrite-test";
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** A run whose agent does `step` in its working copy; Kiln then commits and pushes the branch. */
function setup(steps: ((ctx: FakeScriptContext, sh: (cmd: string) => Promise<string>) => Promise<void>)[]) {
  const harness = new FakeHarness(async (ctx) => {
    const step = steps.shift()!;
    const sh = async (cmd: string) => (await ctx.opts.sandbox.exec(cmd, { cwd: ctx.opts.cwd, trusted: true })).stdout;
    await step(ctx, sh);
    return { summary: "done" };
  });
  const t = createTestKiln({ harness: () => harness });
  const execute = () =>
    t.kiln.runs.execute({ factory: "webapp", sha: t.kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "build", branch });
  return { ...t, execute, bare: t.forge.createRepo({ owner: "acme", name: "web" }) };
}

describe("pushing a follow-up run", () => {
  it("builds on the PR branch even when the agent rewrote its history, without force-pushing", async () => {
    const { execute, bare } = setup([
      async (ctx) => {
        await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/fix.ts`, "export const fix = 1;\n");
        await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/junk.md`, "unrelated\n");
      },
      // The review asked to drop the unrelated file: the agent rebases it out of the branch history.
      async (ctx, sh) => {
        await sh(`git rm -q junk.md && git commit -q --amend -m "fix without junk"`);
        await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/fix.ts`, "export const fix = 2;\n");
        await sh(`git commit -q -am "review feedback"`);
      },
    ]);
    const build = await execute();
    expect(build.status).toBe("succeeded");
    const built = gitIn(bare, "rev-parse", branch);

    const followUp = await execute();
    expect(followUp.error).toBeUndefined();
    expect(followUp.status).toBe("succeeded");
    const tip = gitIn(bare, "rev-parse", branch);
    expect(tip).not.toBe(built);
    // A fast-forward: the PR branch's earlier commit is still in its history.
    expect(() => gitIn(bare, "merge-base", "--is-ancestor", built, tip)).not.toThrow();
    expect(gitIn(bare, "show", `${tip}:fix.ts`)).toBe("export const fix = 2;");
    expect(gitIn(bare, "ls-tree", "--name-only", tip)).not.toContain("junk.md");
    expect(gitIn(bare, "log", "-1", "--format=%B", tip)).toContain("review feedback");
  });

  it("still fails when someone else pushed to the branch during the run", async () => {
    let bareDir = "";
    const { execute, bare } = setup([
      async (ctx) => void (await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/fix.ts`, "export const fix = 1;\n")),
      async (ctx, sh) => {
        // A person pushes to the branch while the agent works and rewrites history.
        const other = mkdtempSync(join(tmpdir(), "kiln-person-"));
        gitIn(other, "clone", "-q", "-b", branch, bareDir, ".");
        gitIn(other, "-c", "user.name=p", "-c", "user.email=p@acme.test", "commit", "-q", "--allow-empty", "-m", "person");
        execFileSync("git", ["push", "-q", "origin", branch], { cwd: other, env: { ...process.env, KILN_PUSH_AS: "human" } });
        await sh(`git commit -q --amend -m "rewritten"`);
      },
    ]);
    bareDir = bare;
    await execute();
    const followUp = await execute();
    expect(followUp.status).toBe("failed");
    expect(followUp.error?.message).toMatch(/git push failed/);
    // The person's commit is not overwritten.
    expect(gitIn(bare, "log", "-1", "--format=%s", branch)).toBe("person");
  });
});
