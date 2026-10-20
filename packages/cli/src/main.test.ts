import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "./main";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: mkdtempSync(join(tmpdir(), "kiln-cli-")), env: {} } };
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
    writeFileSync(join(t.io.cwd, "b/runners/linux-node.yaml"), readFileSync(join(t.io.cwd, "a/runners/linux-node.yaml"), "utf8").replace("vcpus: 4", "vcpus: 8"));
    expect(await runCli(["diff", "b", "--against", "a"], t.io)).toBe(0);
    expect(t.out.at(-1)).toBe("~ runner/linux-node");
  });

  it("imports a v1alpha1 tree", async () => {
    const t = io();
    const src = fileURLToPath(new URL("../../definitions/fixtures/v1alpha1/full", import.meta.url));
    expect(await runCli(["import", src, join(t.io.cwd, "out")], t.io)).toBe(0);
    expect(t.out.at(-1)).toContain("it validates");
  });

  it("prints help for unknown commands", async () => {
    const t = io();
    expect(await runCli(["nope"], t.io)).toBe(1);
    expect(t.err[0]).toContain("unknown command nope");
  });
});
