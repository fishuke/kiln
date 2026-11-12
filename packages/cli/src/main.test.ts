import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakePullRequestSource } from "./backtest";
import { runCli, type CliIO } from "./main";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  const cliIo: CliIO = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: mkdtempSync(join(tmpdir(), "kiln-cli-")), env: {} };
  return { out, err, io: cliIo };
}

describe("kiln CLI", () => {
  it("init scaffolds a template that validates", async () => {
    const t = io();
    expect(await runCli(["init", "factory", "--template", "po-feature"], t.io)).toBe(0);
    expect(await runCli(["validate", "factory"], t.io)).toBe(0);
    expect(t.out.at(-1)).toMatch(/^ok Product features \([0-9a-f]{12}\): 8 agents, 3 automations$/);
  });

  it("validate exits non-zero with file:line errors", async () => {
    const t = io();
    await runCli(["init", "f"], t.io);
    writeFileSync(join(t.io.cwd, "f/agents/triage/agent.md"), "---\nagentType: TRIAGE\nrunner: gpu\n---\n");
    expect(await runCli(["validate", "f"], t.io)).toBe(1);
    expect(t.err.join("\n")).toContain("agents/triage/agent.md:3: runner gpu is not defined in runners/");
  });

  it("diff prints added, changed and removed resources", async () => {
    const t = io();
    await runCli(["init", "a"], t.io);
    await runCli(["init", "b"], t.io);
    writeFileSync(join(t.io.cwd, "b/agents/docs.md"), "");
    writeFileSync(
      join(t.io.cwd, "b/runners/linux-node.yaml"),
      readFileSync(join(t.io.cwd, "a/runners/linux-node.yaml"), "utf8").replace("vcpus: 4", "vcpus: 8"),
    );
    expect(await runCli(["diff", "b", "--against", "a"], t.io)).toBe(0);
    expect(t.out.at(-1)).toBe("~ runner/linux-node");
  });

  it("imports a v1alpha1 tree", async () => {
    const t = io();
    const src = fileURLToPath(new URL("../../definitions/fixtures/v1alpha1/full", import.meta.url));
    expect(await runCli(["import", src, join(t.io.cwd, "out")], t.io)).toBe(0);
    expect(t.out.at(-1)).toContain("it validates");
  });

  it("scan --json profiles the repository", async () => {
    const t = io();
    writeFileSync(join(t.io.cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    writeFileSync(join(t.io.cwd, "pnpm-lock.yaml"), "");
    expect(await runCli(["scan", "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.out.at(-1)!)).toMatchObject({ packageManager: "pnpm", commands: { test: "pnpm test" } });
  });

  it("architect installs the instructions and wrappers, and --print writes them to stdout", async () => {
    const t = io();
    expect(await runCli(["architect", "--agent", "claude,cursor"], t.io)).toBe(0);
    expect(readFileSync(join(t.io.cwd, ".kiln/architect.md"), "utf8")).toContain("# Kiln Factory Architect");
    expect(readFileSync(join(t.io.cwd, ".cursor/rules/kiln-architect.mdc"), "utf8")).toContain(".kiln/architect.md");
    expect(t.out.join("\n")).toContain("/kiln-architect");
    const p = io();
    expect(await runCli(["architect", "--print"], p.io)).toBe(0);
    expect(p.out[0]).toContain("# Kiln Factory Architect");
    expect(await runCli(["architect", "--agent", "vim"], p.io)).toBe(1);
  });

  it("bench from-prs writes a backtest suite that validates", async () => {
    const t = io();
    await runCli(["init", "kiln"], t.io);
    const sha = "a".repeat(40);
    t.io.prs = new FakePullRequestSource([
      {
        number: 9,
        title: "Fix Safari checkout",
        body: "## Acceptance criteria\n- Pay works on Safari 18",
        url: "https://github.com/acme/web/pull/9",
        baseSha: sha,
        author: "sam",
        additions: 12,
        deletions: 3,
      },
      {
        number: 10,
        title: "Bump deps",
        body: "",
        url: "https://github.com/acme/web/pull/10",
        baseSha: sha,
        author: "dependabot[bot]",
        additions: 4,
        deletions: 4,
      },
    ]);
    expect(await runCli(["bench", "from-prs", "--repo", "acme/web", "--dir", "kiln"], t.io)).toBe(0);
    expect(t.out.join("\n")).toContain("1 task");
    expect(t.out.join("\n")).toContain("#10 skipped: opened by dependabot[bot]");
    expect(await runCli(["validate", "kiln"], t.io)).toBe(0);
  });

  it("prints help for unknown commands", async () => {
    const t = io();
    expect(await runCli(["nope"], t.io)).toBe(1);
    expect(t.err[0]).toContain("unknown command nope");
  });
});
