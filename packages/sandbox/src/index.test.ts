import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryObjectStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import {
  CommandBlocked,
  dockerRunArgs,
  DockerSandboxProvider,
  FakeCommandRunner,
  NodeCommandRunner,
  SNAPSHOT_TAR,
  hashDir,
  kubernetesManifests,
  KubernetesSandboxProvider,
  LocalSandboxProvider,
  SandboxNotReachable,
  withGuard,
  type SandboxSpec,
  type SnapshotRef,
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
    const sbx = await provider.create({
      runner: { ...runner, setupCommands: ["pwd > .where"], workspaceSetupCommands: ["ls -d */ >> .ws"] },
      repos: [
        { name: "app", url: gitRepo() },
        { name: "api", url: gitRepo() },
      ],
    });
    expect(await sbx.readFile("app/.where")).toMatch(/\/app\n$/);
    expect(await sbx.readFile("api/.where")).toMatch(/\/api\n$/);
    expect(await sbx.readFile(".ws")).toBe("api/\napp/\n");
    await sbx.destroy();
  });

  it("sweeps work directories a restart or a failed setup left behind, never a live one", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-node-sweep-"));
    mkdirSync(join(root, "sbx_old-abc"));
    const provider = new LocalSandboxProvider(root);
    const live = await provider.create({ runner, repos: [{ name: "app", url: gitRepo() }] });
    await expect(provider.create({ runner: { ...runner, setupCommands: ["exit 3"] }, repos: [] })).rejects.toThrow();
    const listed = await provider.list();
    expect(listed.find((s) => s.name === "sbx_old-abc")).toMatchObject({ state: "left behind", live: false });
    expect(listed.find((s) => s.live)?.state).toBe("running");
    expect(await provider.sweep()).toEqual(["sbx_old-abc"]);
    expect(readdirSync(root)).toEqual([live.workdir.split("/").pop()]);
    await live.destroy();
    expect(await provider.sweep()).toEqual([]);
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

  it("puts only Studio sandboxes on the preview network", () => {
    const studio: SandboxSpec = { ...spec, preview: true };
    expect(dockerRunArgs("kiln-p", studio, undefined, "kiln", "kiln-preview")).toEqual(expect.arrayContaining(["--network", "kiln-egress"]));
    // with no egress the preview network is the only one, instead of none
    const offline = dockerRunArgs("kiln-o", { ...studio, repos: [], runner: { ...spec.runner, egress: [] } }, undefined, "kiln", "kiln-preview");
    expect(offline).toEqual(expect.arrayContaining(["--network", "kiln-preview"]));
    expect(offline).not.toContain("none");
    // other sandboxes never join it
    expect(dockerRunArgs("kiln-x", spec, undefined, "kiln", "kiln-preview")).not.toContain("kiln-preview");
  });

  it("connects a Studio sandbox to the preview network and exposes its address there", async () => {
    const fake = new FakeCommandRunner((_cmd, args) =>
      args[0] === "inspect" ? { code: 0, stdout: "kiln-egress=172.18.0.7 kiln-preview=172.30.250.9 \n", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    );
    const sbx = await new DockerSandboxProvider(fake, { previewNetwork: "kiln-preview" }).create({ ...spec, preview: true });
    const run = fake.calls.findIndex((c) => c.args[0] === "run");
    const connect = fake.calls.findIndex((c) => c.args[0] === "network");
    const name = fake.calls[run]!.args[fake.calls[run]!.args.indexOf("--name") + 1]!;
    expect(fake.calls[connect]?.args).toEqual(["network", "connect", "kiln-preview", name]);
    expect(connect).toBeGreaterThan(run);
    expect(await sbx.expose!(4101)).toEqual({ host: "172.30.250.9", port: 4101 });
  });

  it("reconnects a resumed Studio sandbox to the preview network", async () => {
    const fake = new FakeCommandRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const store = new MemoryObjectStore();
    await store.put("snap", new Uint8Array([1]));
    await new DockerSandboxProvider(fake, { previewNetwork: "kiln-preview" }).resume({ key: "snap" } as SnapshotRef, { ...spec, preview: true }, store);
    expect(fake.calls.some((c) => c.args.join(" ").startsWith("network connect kiln-preview kiln-"))).toBe(true);
  });

  it("never connects other sandboxes to the preview network", async () => {
    const fake = new FakeCommandRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    await new DockerSandboxProvider(fake, { previewNetwork: "kiln-preview" }).create(spec);
    expect(fake.calls.some((c) => c.args[0] === "network")).toBe(false);
  });

  it("refuses to expose a Studio sandbox that is not on the preview network", async () => {
    const fake = new FakeCommandRunner((_cmd, args) =>
      args[0] === "inspect" ? { code: 0, stdout: "kiln-egress=172.18.0.7 \n", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    );
    const sbx = await new DockerSandboxProvider(fake, { previewNetwork: "kiln-preview" }).create({ ...spec, preview: true });
    await expect(sbx.expose!(4101)).rejects.toBeInstanceOf(SandboxNotReachable);
  });

  it("makes Node's fetch use the egress proxy (corepack downloads pnpm with it)", () => {
    expect(dockerRunArgs("kiln-x", spec)).toContain("NODE_USE_ENV_PROXY=1");
    expect(dockerRunArgs("kiln-y", { ...spec, repos: [], runner: { ...spec.runner, egress: [] } })).not.toContain("NODE_USE_ENV_PROXY=1");
  });

  it("labels containers with their owner and sweeps only its own leftovers", async () => {
    let created = "";
    const fake = new FakeCommandRunner((_cmd, args) => {
      if (args[0] === "run") created = args[args.indexOf("--name") + 1]!;
      if (args[0] === "ps") return { code: 0, stdout: `kiln-old\tkiln\nkiln-legacy\t\nkiln-w1\tworker:w1\n${created}\tkiln\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    expect(dockerRunArgs("kiln-x", spec, undefined, "worker:w1")).toEqual(expect.arrayContaining(["--label", "kiln.owner=worker:w1"]));
    const provider = new DockerSandboxProvider(fake);
    const sbx = await provider.create(spec);
    expect(await provider.sweep()).toEqual(["kiln-old", "kiln-legacy"]);
    expect(fake.calls.at(-1)?.args).toEqual(["rm", "-f", "-v", "kiln-old", "kiln-legacy"]);
    await sbx.destroy();
    expect(await provider.sweep()).toContain(created);
  });

  it("lists every Kiln container with the CPU and memory of the running ones", async () => {
    const fake = new FakeCommandRunner((_cmd, args) => {
      if (args[0] === "ps")
        return { code: 0, stdout: "kiln-a\trunning\t2026-10-23 10:11:12 +0000 UTC\tkiln\tapp1\nkiln-b\texited\t2026-10-22 09:00:00 +0000 UTC\tworker:w1\t\n", stderr: "" };
      if (args[0] === "stats") return { code: 0, stdout: "kiln-a\t12.50%\t256MiB / 7.6GiB\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const rows = await new DockerSandboxProvider(fake).list();
    expect(rows).toEqual([
      { name: "kiln-a", provider: "docker", state: "running", live: false, owner: "kiln", studioApp: "app1", createdAt: "2026-10-23T10:11:12.000Z", cpuPercent: 12.5, memoryBytes: 256 * 1024 ** 2 },
      { name: "kiln-b", provider: "docker", state: "exited", live: false, owner: "worker:w1", createdAt: "2026-10-22T09:00:00.000Z" },
    ]);
    expect(fake.calls.at(-1)?.args).toEqual(["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", "kiln-a"]);
  });

  it("removes the container when cloning or setup fails", async () => {
    const fake = new FakeCommandRunner((_cmd, args) =>
      args.includes("clone") ? { code: 128, stdout: "", stderr: "no access" } : { code: 0, stdout: "", stderr: "" },
    );
    await expect(new DockerSandboxProvider(fake).create(spec)).rejects.toThrow(/no access/);
    expect(fake.calls.at(-1)?.args.slice(0, 3)).toEqual(["rm", "-f", "-v"]);
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
    expect(fake.calls.at(-1)?.args.slice(0, 3)).toEqual(["rm", "-f", "-v"]);
  });

  it("snapshots a workspace a dev server is still writing to", async () => {
    const fake = new FakeCommandRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const sbx = await new DockerSandboxProvider(fake).create(spec);
    await sbx.snapshot(new MemoryObjectStore());
    const tar = fake.calls.find((c) => c.args.includes(SNAPSHOT_TAR))!;
    expect(tar.args.slice(0, 4)).toEqual(["exec", tar.args[1], "sh", "-c"]);
  });

  it("treats tar's 'file changed as we read it' (exit 1) as success and anything else as failure", async () => {
    const sh = (code: number) => new NodeCommandRunner().run("sh", ["-c", SNAPSHOT_TAR.replace(/^tar .* \|\|/, `(exit ${code}) ||`)]);
    expect((await sh(1)).code).toBe(0);
    expect((await sh(2)).code).not.toBe(0);
  });
});

describe("a guarded view of a sandbox", () => {
  it("runs another owner's guard on agent commands, and lets trusted ones through", async () => {
    const sbx = await new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-g-"))).create({ runner, repos: [] });
    const seen: string[] = [];
    const view = withGuard(
      sbx,
      async (cmd) => (seen.push(cmd), cmd.includes("rm -rf") ? "block" : cmd.includes("push") ? "ask_human" : "allow"),
      async () => false,
    );
    expect((await view.exec("echo ok")).stdout).toBe("ok\n");
    await expect(view.exec("rm -rf /")).rejects.toBeInstanceOf(CommandBlocked);
    await expect(view.exec("git push")).rejects.toThrow("a human declined");
    expect((await view.exec("echo setup", { trusted: true })).stdout).toBe("setup\n");
    expect(seen).toEqual(["echo ok", "rm -rf /", "git push"]);
    expect(view.workdir).toBe(sbx.workdir);
    await sbx.destroy();
  });
});

describe("exposing a port", () => {
  const spec: SandboxSpec = {
    runner: { image: "node:22", backend: "docker", setupCommands: [], egress: ["registry.npmjs.org"] },
    repos: [],
  };

  it("serves a local sandbox's port on the loopback address", async () => {
    const sbx = await new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-x-"))).create({ runner, repos: [] });
    expect(await sbx.expose!(4101)).toEqual({ host: "127.0.0.1", port: 4101 });
    await sbx.destroy();
  });

  it("serves a docker sandbox's port on the container's address", async () => {
    const fake = new FakeCommandRunner((_cmd, args) =>
      args[0] === "inspect" ? { code: 0, stdout: "172.18.0.7\n", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    );
    const sbx = await new DockerSandboxProvider(fake).create(spec);
    expect(await sbx.expose!(3000)).toEqual({ host: "172.18.0.7", port: 3000 });
    expect(fake.calls.at(-1)?.args[0]).toBe("inspect");
  });

  it("refuses a docker sandbox that has no network", async () => {
    const fake = new FakeCommandRunner((_cmd, args) => (args[0] === "inspect" ? { code: 0, stdout: "\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }));
    const sbx = await new DockerSandboxProvider(fake).create({ ...spec, runner: { ...spec.runner, egress: [] } });
    await expect(sbx.expose!(3000)).rejects.toBeInstanceOf(SandboxNotReachable);
  });

  it("refuses ports outside 1–65535", async () => {
    const sbx = await new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-node-x-"))).create({ runner, repos: [] });
    await expect(sbx.expose!(0)).rejects.toThrow(/port/);
    await sbx.destroy();
  });
});

describe("kubernetes sandbox", () => {
  it("serves a pod's port on the pod's address", async () => {
    const fake = new FakeCommandRunner((_cmd, args) =>
      args.includes("get") ? { code: 0, stdout: "10.1.2.3", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    );
    const sbx = await new KubernetesSandboxProvider(fake).create({
      runner: { image: "node:22", backend: "kubernetes", setupCommands: [], egress: [] },
      repos: [],
    });
    expect(await sbx.expose!(3000)).toEqual({ host: "10.1.2.3", port: 3000 });
  });

  it("runs under gVisor with a default-deny network policy", () => {
    const [pod, policy] = kubernetesManifests("kiln-a", "kiln-sandboxes", {
      runner: { image: "node:22", backend: "kubernetes", setupCommands: [], egress: [] },
      repos: [],
    }) as [Record<string, any>, Record<string, any>];
    expect(pod.spec.runtimeClassName).toBe("gvisor");
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(policy.spec.egress).toEqual([]);
    expect(policy.spec.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(pod.metadata.labels["kiln.dev/preview"]).toBeUndefined();
  });

  it("labels a Studio sandbox pod for the preview ingress policy", () => {
    const [pod] = kubernetesManifests("kiln-p", "kiln-sandboxes", {
      runner: { image: "node:22", backend: "kubernetes", setupCommands: [], egress: [] },
      repos: [],
      preview: true,
    }) as [Record<string, any>];
    expect(pod.metadata.labels["kiln.dev/preview"]).toBe("true");
  });
});
