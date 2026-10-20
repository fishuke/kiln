import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryObjectStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import {
  CommandBlocked,
  dockerRunArgs,
  DockerSandboxProvider,
  FakeCommandRunner,
  hashDir,
  kubernetesManifests,
  LocalSandboxProvider,
  type SandboxSpec,
} from "./index";

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kiln-origin-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "t");
  execFileSync("sh", ["-c", "echo hello > README.md && mkdir -p src && echo 'export const x = 1;' > src/x.ts"], { cwd: dir });
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

const runner = { image: "node:22", backend: "local" as const, setupCommands: ["echo ready > .setup-done"], egress: [] };

describe("local sandbox", () => {
  it("clones repos, runs setup, starts fast and tears down", async () => {
    const provider = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-a-")));
    const sbx = await provider.create({ runner, repos: [{ name: "app", url: gitRepo(), branch: "kiln/test" }] });
    expect(sbx.startedInMs).toBeLessThan(15_000);
    expect(await sbx.readFile("app/README.md")).toBe("hello\n");
    // Setup runs in the cloned repository, where its package.json (and packageManager) is.
    expect(await sbx.readFile("app/.setup-done")).toBe("ready\n");
    const branch = await sbx.exec("git rev-parse --abbrev-ref HEAD", { cwd: "app" });
    expect(branch.stdout.trim()).toBe("kiln/test");
    await sbx.destroy();
    expect(existsSync(sbx.workdir)).toBe(false);
  });

  it("runs setup in each repository, then workspace-wide setup once at the root", async () => {
    const provider = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-a-")));
    const sbx = await provider.create({ runner: { ...runner, setupCommands: ["pwd > .where"], workspaceSetupCommands: ["ls -d */ >> .ws"] }, repos: [{ name: "app", url: gitRepo() }, { name: "api", url: gitRepo() }] });
    expect(await sbx.readFile("app/.where")).toMatch(/\/app\n$/);
    expect(await sbx.readFile("api/.where")).toMatch(/\/api\n$/);
    expect(await sbx.readFile(".ws")).toBe("api/\napp/\n");
    await sbx.destroy();
  });

  it("runs every command through the guardrail", async () => {
    const seen: string[] = [];
    const spec: SandboxSpec = {
      runner: { ...runner, setupCommands: [] },
      repos: [],
      guard: async (cmd) => {
        seen.push(cmd);
        return cmd.includes("rm -rf") ? "block" : cmd.includes("push") ? "ask_human" : "allow";
      },
      askHuman: async () => false,
    };
    const sbx = await new LocalSandboxProvider().create(spec);
    expect((await sbx.exec("echo ok")).stdout).toBe("ok\n");
    await expect(sbx.exec("rm -rf /")).rejects.toBeInstanceOf(CommandBlocked);
    await expect(sbx.exec("git push")).rejects.toThrow("a human declined");
    expect(seen).toEqual(["echo ok", "rm -rf /", "git push"]);
    await sbx.destroy();
  });

  it("pauses to object storage and resumes on another node with the same workspace", async () => {
    const store = new MemoryObjectStore();
    const nodeA = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-a-")));
    const nodeB = new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-b-")));
    const spec = { runner, repos: [{ name: "app", url: gitRepo() }] };
    const a = await nodeA.create(spec);
    await a.writeFile("app/src/work-in-progress.ts", "export const wip = true;\n");
    const ref = await a.snapshot(store);
    await a.destroy();
    const b = await nodeB.resume(ref, spec, store);
    expect(b.workdir).not.toBe(a.workdir);
    expect(hashDir(b.workdir)).toBe(ref.workspaceSha);
    expect(await b.readFile("app/src/work-in-progress.ts")).toContain("wip");
    await b.destroy();
  });
});

describe("docker sandbox", () => {
  const spec: SandboxSpec = {
    runner: { image: "node:22", backend: "docker", shape: { vcpus: 2, memoryGb: 4 }, setupCommands: ["corepack enable"], egress: ["registry.npmjs.org"] },
    repos: [{ name: "app", url: "https://example.test/app.git" }],
    env: { CI: "1" },
  };

  it("builds locked-down docker run args with an egress allowlist", () => {
    const args = dockerRunArgs("kiln-x", spec);
    expect(args).toEqual(expect.arrayContaining(["--cpus", "2", "--memory", "4g", "--network", "kiln-egress", "--cap-drop", "ALL"]));
    expect(args).toContain("KILN_EGRESS_ALLOW=registry.npmjs.org,example.test");
    expect(dockerRunArgs("kiln-y", { ...spec, repos: [], runner: { ...spec.runner, egress: [] } })).toEqual(expect.arrayContaining(["--network", "none"]));
    // repos are cloned inside the container, so their host is reachable even with no egress list
    expect(dockerRunArgs("kiln-z", { ...spec, runner: { ...spec.runner, egress: [] } })).toContain("KILN_EGRESS_ALLOW=example.test");
    const custom = dockerRunArgs("kiln-c", spec, { network: "coolify-egress", proxy: "http://egress:3128" });
    expect(custom).toEqual(expect.arrayContaining(["--network", "coolify-egress", "HTTPS_PROXY=http://egress:3128"]));
  });

  it("makes Node's fetch use the egress proxy (corepack downloads pnpm with it)", () => {
    expect(dockerRunArgs("kiln-x", spec)).toContain("NODE_USE_ENV_PROXY=1");
    expect(dockerRunArgs("kiln-y", { ...spec, repos: [], runner: { ...spec.runner, egress: [] } })).not.toContain("NODE_USE_ENV_PROXY=1");
  });

  it("uses a cached image, clones, runs setup and destroys", async () => {
    const fake = new FakeCommandRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const sbx = await new DockerSandboxProvider(fake).create(spec);
    await sbx.destroy();
    const verbs = fake.calls.map((c) => c.args.slice(0, 2).join(" "));
    expect(verbs[0]).toBe("image inspect");
    expect(verbs).not.toContain("pull node:22");
    expect(verbs[1]).toBe("run -d");
    expect(fake.calls.some((c) => c.args.includes("clone"))).toBe(true);
    const setup = fake.calls.find((c) => c.args.includes("corepack enable"))!;
    expect(setup.args.slice(0, 3)).toEqual(["exec", "-w", "/workspace/app"]);
    expect(fake.calls.at(-1)?.args.slice(0, 2)).toEqual(["rm", "-f"]);
  });
});

describe("kubernetes sandbox", () => {
  it("runs under gVisor with a default-deny network policy", () => {
    const [pod, policy] = kubernetesManifests("kiln-a", "kiln-sandboxes", {
      runner: { image: "node:22", backend: "kubernetes", setupCommands: [], egress: [] },
      repos: [],
    }) as [Record<string, any>, Record<string, any>];
    expect(pod.spec.runtimeClassName).toBe("gvisor");
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(policy.spec.egress).toEqual([]);
    expect(policy.spec.policyTypes).toEqual(["Ingress", "Egress"]);
  });
});
