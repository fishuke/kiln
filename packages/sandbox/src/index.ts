import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { Runner } from "@kiln/schema";
import type { ObjectStore } from "@kiln/store";
import { NodeCommandRunner, type CommandRunner, type ExecResult, type Proc } from "./process";

export * from "./process";

export type GuardVerdict = "allow" | "ask_human" | "block";

export type SandboxSpec = {
  runner: Runner;
  repos: { name: string; url: string; branch?: string }[];
  env?: Record<string, string>;
  /** Pre-exec hook: every shell command passes through it before running. */
  guard?: (command: string) => Promise<GuardVerdict>;
  /** Called for "ask_human" verdicts; resolve true to run the command. */
  askHuman?: (command: string) => Promise<boolean>;
  labels?: Record<string, string>;
  /** Hosts the egress proxy always blocks (an agent's networkPolicy.deniedHosts). */
  deniedHosts?: string[];
};

export type SnapshotRef = {
  key: string;
  provider: string;
  sandboxId: string;
  createdAt: string;
  workspaceSha: string;
  processState: boolean;
};

export interface Sandbox {
  readonly id: string;
  readonly provider: string;
  /** Path of the workspace inside the sandbox; each repo is cloned into <workdir>/<repo name>. */
  readonly workdir: string;
  readonly startedInMs: number;
  /** Shell command. Agent commands pass the guardrail; `trusted` marks Kiln's own commands (push, setup). */
  exec(command: string, opts?: { cwd?: string; env?: Record<string, string>; trusted?: boolean }): Promise<ExecResult>;
  spawn(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Proc;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | undefined>;
  /** Binary read, for videos and other artifacts. */
  readBytes(path: string): Promise<Uint8Array | undefined>;
  /** Binary write, for attachments such as images. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  snapshot(store: ObjectStore): Promise<SnapshotRef>;
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  create(spec: SandboxSpec): Promise<Sandbox>;
  resume(ref: SnapshotRef, spec: SandboxSpec, store: ObjectStore): Promise<Sandbox>;
}

export class CommandBlocked extends Error {
  constructor(readonly command: string, readonly verdict: GuardVerdict) {
    super(verdict === "block" ? `blocked by guardrail: ${command}` : `a human declined: ${command}`);
  }
}

async function guarded(spec: SandboxSpec, command: string): Promise<void> {
  if (!spec.guard) return;
  const verdict = await spec.guard(command);
  if (verdict === "allow") return;
  if (verdict === "ask_human" && spec.askHuman && (await spec.askHuman(command))) return;
  throw new CommandBlocked(command, verdict);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Content hash of a directory tree, used to prove a resumed workspace is byte for byte the same. */
export function hashDir(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === ".git") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        hash.update(relative(root, full));
        hash.update(readFileSync(full));
      }
    }
  };
  if (existsSync(root)) walk(root);
  return hash.digest("hex");
}

const newId = () => `sbx_${randomBytes(5).toString("hex")}`;

/**
 * Runs the workspace in a host directory. Used for development and for tests; it applies the
 * guardrail and setup commands but cannot enforce egress or resource limits.
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly name = "local";

  constructor(
    private readonly root = join(tmpdir(), "kiln-sandboxes"),
    private readonly runner: CommandRunner = new NodeCommandRunner(),
  ) {
    mkdirSync(root, { recursive: true });
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const id = newId();
    const workdir = mkdtempSync(join(this.root, `${id}-`));
    const sandbox = new LocalSandbox(id, workdir, spec, this.runner, started);
    for (const repo of spec.repos) {
      const args = ["clone", "--quiet", repo.url, repo.name];
      const r = await this.runner.run("git", args, { cwd: workdir });
      if (r.code !== 0) throw new Error(`git clone ${repo.url} failed: ${r.stderr}`);
      if (repo.branch) await this.runner.run("git", ["checkout", "-q", "-B", repo.branch], { cwd: join(workdir, repo.name) });
    }
    for (const cmd of spec.runner.setupCommands) {
      const r = await sandbox.exec(cmd, { trusted: true });
      if (r.code !== 0) throw new Error(`setup command failed: ${cmd}\n${r.stderr}`);
    }
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }

  async resume(ref: SnapshotRef, spec: SandboxSpec, store: ObjectStore): Promise<Sandbox> {
    const started = Date.now();
    const body = await store.get(ref.key);
    if (!body) throw new Error(`snapshot ${ref.key} not found`);
    const id = newId();
    const workdir = mkdtempSync(join(this.root, `${id}-`));
    const archive = join(workdir, "..", `${id}.tgz`);
    writeFileSync(archive, body);
    const r = await this.runner.run("tar", ["-xzf", archive, "-C", workdir]);
    rmSync(archive, { force: true });
    if (r.code !== 0) throw new Error(`restoring snapshot failed: ${r.stderr}`);
    const sandbox = new LocalSandbox(id, workdir, spec, this.runner, started);
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }
}

class LocalSandbox implements Sandbox {
  readonly provider = "local";
  startedInMs = 0;

  constructor(
    readonly id: string,
    readonly workdir: string,
    private readonly spec: SandboxSpec,
    private readonly runner: CommandRunner,
    readonly createdAt: number,
  ) {}

  private resolvePath(path: string) {
    return path.startsWith("/") ? path : join(this.workdir, path);
  }

  async exec(command: string, opts: { cwd?: string; env?: Record<string, string>; trusted?: boolean } = {}) {
    if (!opts.trusted) await guarded(this.spec, command);
    return this.runner.run("sh", ["-c", command], {
      cwd: opts.cwd ? this.resolvePath(opts.cwd) : this.workdir,
      env: { ...this.spec.env, ...opts.env },
    });
  }

  spawn(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
    return this.runner.spawn(cmd, args, {
      cwd: opts.cwd ? this.resolvePath(opts.cwd) : this.workdir,
      env: { ...this.spec.env, ...opts.env },
    });
  }

  async writeFile(path: string, content: string) {
    const full = this.resolvePath(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  async readFile(path: string) {
    const full = this.resolvePath(path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  }

  async readBytes(path: string) {
    const full = this.resolvePath(path);
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : undefined;
  }

  async writeBytes(path: string, bytes: Uint8Array) {
    const full = this.resolvePath(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }

  async snapshot(store: ObjectStore): Promise<SnapshotRef> {
    const archive = join(this.workdir, "..", `${this.id}-snap.tgz`);
    const r = await this.runner.run("tar", ["-czf", archive, "-C", this.workdir, "."]);
    if (r.code !== 0) throw new Error(`snapshot failed: ${r.stderr}`);
    const key = `snapshots/${this.id}/${Date.now()}.tgz`;
    await store.put(key, new Uint8Array(readFileSync(archive)), "application/gzip");
    rmSync(archive, { force: true });
    return {
      key,
      provider: this.provider,
      sandboxId: this.id,
      createdAt: new Date().toISOString(),
      workspaceSha: hashDir(this.workdir),
      processState: false,
    };
  }

  async destroy() {
    rmSync(this.workdir, { recursive: true, force: true });
  }
}

/** The runner's egress list plus the hosts of the repos the sandbox clones. */
export function egressAllowlist(spec: SandboxSpec): string[] {
  const hosts = spec.repos
    .map((r) => {
      try {
        return new URL(r.url).hostname;
      } catch {
        return /^[^@]+@([^:]+):/.exec(r.url)?.[1];
      }
    })
    .filter((h): h is string => Boolean(h));
  const denied = new Set(spec.deniedHosts ?? []);
  return [...new Set([...spec.runner.egress, ...hosts])].filter((h) => !denied.has(h));
}

/** Docker CLI arguments for a runner: resources, egress and labels. Exported for tests and docs. */
export function dockerRunArgs(name: string, spec: SandboxSpec): string[] {
  const args = ["run", "-d", "--name", name, "--label", "kiln.sandbox=1", "-w", "/workspace"];
  for (const [k, v] of Object.entries(spec.labels ?? {})) args.push("--label", `${k}=${v}`);
  if (spec.runner.shape) args.push("--cpus", String(spec.runner.shape.vcpus), "--memory", `${spec.runner.shape.memoryGb}g`);
  // Repos are cloned inside the sandbox, so their hosts are always allowed. Nothing to reach → no network;
  // otherwise traffic goes through the egress proxy, which enforces the allowlist.
  const allow = egressAllowlist(spec);
  if (allow.length === 0) args.push("--network", "none");
  else {
    args.push("--network", "kiln-egress");
    args.push("-e", "HTTPS_PROXY=http://kiln-egress-proxy:3128", "-e", "HTTP_PROXY=http://kiln-egress-proxy:3128");
    args.push("-e", `KILN_EGRESS_ALLOW=${allow.join(",")}`);
    if (spec.deniedHosts?.length) args.push("-e", `KILN_EGRESS_DENY=${spec.deniedHosts.join(",")}`);
  }
  args.push("--security-opt", "no-new-privileges", "--cap-drop", "ALL");
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
  args.push(spec.runner.image, "sleep", "infinity");
  return args;
}

/** Disposable Docker containers. Snapshots copy the workspace; with `checkpoint` CRIU also keeps processes. */
export class DockerSandboxProvider implements SandboxProvider {
  readonly name = "docker";

  constructor(
    private readonly runner: CommandRunner = new NodeCommandRunner(),
    private readonly options: { checkpoint?: boolean; hostTmp?: string; volumes?: string[]; pullPolicy?: "Always" | "IfNotPresent" | "Never" } = {},
  ) {}

  private async must(args: string[], stdin?: string): Promise<ExecResult> {
    const r = await this.runner.run("docker", args, stdin === undefined ? {} : { stdin });
    if (r.code !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${r.stderr}`);
    return r;
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const id = newId();
    const name = `kiln-${id}`;
    const policy = this.options.pullPolicy ?? "IfNotPresent";
    const cached = policy === "Always" ? { code: 1 } : await this.runner.run("docker", ["image", "inspect", spec.runner.image]);
    if (cached.code !== 0 && policy !== "Never") await this.must(["pull", spec.runner.image]);
    const args = dockerRunArgs(name, spec);
    // Host volumes from the worker's configuration (`kiln worker --volumes HOST:CONTAINER[:ro]`).
    for (const v of this.options.volumes ?? []) args.splice(args.indexOf(spec.runner.image), 0, "-v", v);
    await this.must(args);
    const sandbox = new DockerSandbox(id, name, spec, this.runner, this.options);
    for (const repo of spec.repos) {
      await this.must(["exec", name, "git", "clone", "--quiet", repo.url, `/workspace/${repo.name}`]);
      if (repo.branch) await this.must(["exec", "-w", `/workspace/${repo.name}`, name, "git", "checkout", "-q", "-B", repo.branch]);
    }
    for (const cmd of spec.runner.setupCommands) {
      const r = await sandbox.exec(cmd, { trusted: true });
      if (r.code !== 0) throw new Error(`setup command failed: ${cmd}\n${r.stderr}`);
    }
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }

  async resume(ref: SnapshotRef, spec: SandboxSpec, store: ObjectStore): Promise<Sandbox> {
    const started = Date.now();
    const id = newId();
    const name = `kiln-${id}`;
    const body = await store.get(ref.key);
    if (!body) throw new Error(`snapshot ${ref.key} not found`);
    const host = mkdtempSync(join(this.options.hostTmp ?? tmpdir(), "kiln-resume-"));
    const archive = join(host, "snap.tgz");
    writeFileSync(archive, body);
    await this.must(dockerRunArgs(name, spec));
    await this.must(["cp", archive, `${name}:/tmp/snap.tgz`]);
    await this.must(["exec", name, "tar", "-xzf", "/tmp/snap.tgz", "-C", "/workspace"]);
    rmSync(host, { recursive: true, force: true });
    const sandbox = new DockerSandbox(id, name, spec, this.runner, this.options);
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }
}

class DockerSandbox implements Sandbox {
  readonly provider = "docker";
  readonly workdir = "/workspace";
  startedInMs = 0;

  constructor(
    readonly id: string,
    readonly container: string,
    private readonly spec: SandboxSpec,
    private readonly runner: CommandRunner,
    private readonly options: { checkpoint?: boolean; hostTmp?: string },
  ) {}

  private envArgs(env?: Record<string, string>) {
    return Object.entries(env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  }

  async exec(command: string, opts: { cwd?: string; env?: Record<string, string>; trusted?: boolean } = {}) {
    if (!opts.trusted) await guarded(this.spec, command);
    const cwd = opts.cwd ? (opts.cwd.startsWith("/") ? opts.cwd : `/workspace/${opts.cwd}`) : "/workspace";
    return this.runner.run("docker", ["exec", "-w", cwd, ...this.envArgs(opts.env), this.container, "sh", "-lc", command]);
  }

  spawn(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
    const cwd = opts.cwd ? (opts.cwd.startsWith("/") ? opts.cwd : `/workspace/${opts.cwd}`) : "/workspace";
    return this.runner.spawn("docker", ["exec", "-i", "-w", cwd, ...this.envArgs(opts.env), this.container, cmd, ...args]);
  }

  async writeFile(path: string, content: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const r = await this.runner.run(
      "docker",
      ["exec", "-i", this.container, "sh", "-c", `mkdir -p ${shellQuote(dirname(full))} && cat > ${shellQuote(full)}`],
      { stdin: content },
    );
    if (r.code !== 0) throw new Error(`writing ${path} failed: ${r.stderr}`);
  }

  async readFile(path: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const r = await this.runner.run("docker", ["exec", this.container, "cat", full]);
    return r.code === 0 ? r.stdout : undefined;
  }

  async readBytes(path: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const host = mkdtempSync(join(this.options.hostTmp ?? tmpdir(), "kiln-cp-"));
    const target = join(host, "file");
    const r = await this.runner.run("docker", ["cp", `${this.container}:${full}`, target]);
    const bytes = r.code === 0 && existsSync(target) ? new Uint8Array(readFileSync(target)) : undefined;
    rmSync(host, { recursive: true, force: true });
    return bytes;
  }

  async writeBytes(path: string, bytes: Uint8Array) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const host = mkdtempSync(join(this.options.hostTmp ?? tmpdir(), "kiln-cp-"));
    writeFileSync(join(host, "file"), bytes);
    await this.runner.run("docker", ["exec", this.container, "mkdir", "-p", dirname(full)]);
    const r = await this.runner.run("docker", ["cp", join(host, "file"), `${this.container}:${full}`]);
    rmSync(host, { recursive: true, force: true });
    if (r.code !== 0) throw new Error(`writing ${path} failed: ${r.stderr}`);
  }

  async snapshot(store: ObjectStore): Promise<SnapshotRef> {
    const host = mkdtempSync(join(this.options.hostTmp ?? tmpdir(), "kiln-snap-"));
    const archive = join(host, "snap.tgz");
    const run = async (args: string[]) => {
      const r = await this.runner.run("docker", args);
      if (r.code !== 0) throw new Error(`docker ${args[0]} failed: ${r.stderr}`);
      return r;
    };
    await run(["exec", this.container, "tar", "-czf", "/tmp/snap.tgz", "-C", "/workspace", "."]);
    await run(["cp", `${this.container}:/tmp/snap.tgz`, archive]);
    let processState = false;
    if (this.options.checkpoint) {
      const r = await this.runner.run("docker", ["checkpoint", "create", "--leave-running", this.container, `cp-${Date.now()}`]);
      processState = r.code === 0;
    }
    const key = `snapshots/${this.id}/${Date.now()}.tgz`;
    const body = existsSync(archive) ? new Uint8Array(readFileSync(archive)) : new Uint8Array();
    await store.put(key, body, "application/gzip");
    rmSync(host, { recursive: true, force: true });
    const sha = createHash("sha256").update(body).digest("hex");
    return { key, provider: this.provider, sandboxId: this.id, createdAt: new Date().toISOString(), workspaceSha: sha, processState };
  }

  async destroy() {
    await this.runner.run("docker", ["rm", "-f", this.container]);
  }
}

/** Pod and NetworkPolicy manifests for a sandbox under gVisor. */
export function kubernetesManifests(name: string, namespace: string, spec: SandboxSpec): Record<string, unknown>[] {
  const labels = { "app.kubernetes.io/name": "kiln-sandbox", "kiln.dev/sandbox": name, ...spec.labels };
  const resources = spec.runner.shape
    ? {
        requests: { cpu: String(spec.runner.shape.vcpus), memory: `${spec.runner.shape.memoryGb}Gi` },
        limits: { cpu: String(spec.runner.shape.vcpus), memory: `${spec.runner.shape.memoryGb}Gi` },
      }
    : undefined;
  return [
    {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name, namespace, labels },
      spec: {
        runtimeClassName: "gvisor",
        restartPolicy: "Never",
        automountServiceAccountToken: false,
        securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: "workspace",
            image: spec.runner.image,
            command: ["sleep", "infinity"],
            workingDir: "/workspace",
            env: Object.entries(spec.env ?? {}).map(([k, v]) => ({ name: k, value: v })),
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
            volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
            ...(resources ? { resources } : {}),
          },
        ],
        volumes: [{ name: "workspace", emptyDir: {} }],
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: { name: `${name}-egress`, namespace },
      spec: {
        podSelector: { matchLabels: { "kiln.dev/sandbox": name } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [],
        // DNS plus the egress proxy; the proxy enforces the hostname allowlist.
        egress:
          egressAllowlist(spec).length === 0
            ? []
            : [
                { to: [{ namespaceSelector: {}, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }], ports: [{ protocol: "UDP", port: 53 }] },
                { to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "kiln-egress-proxy" } } }], ports: [{ protocol: "TCP", port: 3128 }] },
              ],
      },
    },
  ];
}

export class KubernetesSandboxProvider implements SandboxProvider {
  readonly name = "kubernetes";

  constructor(
    private readonly runner: CommandRunner = new NodeCommandRunner(),
    private readonly namespace = "kiln-sandboxes",
  ) {}

  private async kubectl(args: string[], stdin?: string) {
    const r = await this.runner.run("kubectl", ["-n", this.namespace, ...args], stdin === undefined ? {} : { stdin });
    if (r.code !== 0) throw new Error(`kubectl ${args[0]} failed: ${r.stderr}`);
    return r;
  }

  private async start(spec: SandboxSpec) {
    const id = newId();
    const name = `kiln-${id.replace("_", "-")}`;
    const manifests = kubernetesManifests(name, this.namespace, spec);
    await this.kubectl(["apply", "-f", "-"], manifests.map((m) => JSON.stringify(m)).join("\n"));
    await this.kubectl(["wait", "--for=condition=Ready", `pod/${name}`, "--timeout=120s"]);
    return { id, name };
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const { id, name } = await this.start(spec);
    const sandbox = new KubernetesSandbox(id, name, this.namespace, spec, this.runner);
    for (const repo of spec.repos) {
      await this.kubectl(["exec", name, "--", "git", "clone", "--quiet", repo.url, `/workspace/${repo.name}`]);
    }
    for (const cmd of spec.runner.setupCommands) {
      const r = await sandbox.exec(cmd, { trusted: true });
      if (r.code !== 0) throw new Error(`setup command failed: ${cmd}\n${r.stderr}`);
    }
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }

  async resume(ref: SnapshotRef, spec: SandboxSpec, store: ObjectStore): Promise<Sandbox> {
    const started = Date.now();
    const body = await store.get(ref.key);
    if (!body) throw new Error(`snapshot ${ref.key} not found`);
    const { id, name } = await this.start(spec);
    const host = mkdtempSync(join(tmpdir(), "kiln-resume-"));
    writeFileSync(join(host, "snap.tgz"), body);
    await this.kubectl(["cp", join(host, "snap.tgz"), `${name}:/tmp/snap.tgz`]);
    await this.kubectl(["exec", name, "--", "tar", "-xzf", "/tmp/snap.tgz", "-C", "/workspace"]);
    rmSync(host, { recursive: true, force: true });
    const sandbox = new KubernetesSandbox(id, name, this.namespace, spec, this.runner);
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }
}

class KubernetesSandbox implements Sandbox {
  readonly provider = "kubernetes";
  readonly workdir = "/workspace";
  startedInMs = 0;

  constructor(
    readonly id: string,
    readonly pod: string,
    private readonly namespace: string,
    private readonly spec: SandboxSpec,
    private readonly runner: CommandRunner,
  ) {}

  private base() {
    return ["-n", this.namespace, "exec", "-i", this.pod, "--"];
  }

  async exec(command: string, opts: { cwd?: string; env?: Record<string, string>; trusted?: boolean } = {}) {
    if (!opts.trusted) await guarded(this.spec, command);
    const cwd = opts.cwd ? (opts.cwd.startsWith("/") ? opts.cwd : `/workspace/${opts.cwd}`) : "/workspace";
    const env = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ");
    return this.runner.run("kubectl", [...this.base(), "sh", "-lc", `cd ${shellQuote(cwd)} && ${env} ${command}`]);
  }

  spawn(cmd: string, args: string[], opts: { cwd?: string } = {}) {
    const cwd = opts.cwd ? (opts.cwd.startsWith("/") ? opts.cwd : `/workspace/${opts.cwd}`) : "/workspace";
    return this.runner.spawn("kubectl", [...this.base(), "sh", "-lc", `cd ${shellQuote(cwd)} && exec ${[cmd, ...args].map(shellQuote).join(" ")}`]);
  }

  async writeFile(path: string, content: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    await this.runner.run("kubectl", [...this.base(), "sh", "-c", `mkdir -p ${shellQuote(dirname(full))} && cat > ${shellQuote(full)}`], {
      stdin: content,
    });
  }

  async readFile(path: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const r = await this.runner.run("kubectl", [...this.base(), "cat", full]);
    return r.code === 0 ? r.stdout : undefined;
  }

  async readBytes(path: string) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const host = mkdtempSync(join(tmpdir(), "kiln-cp-"));
    const target = join(host, "file");
    const r = await this.runner.run("kubectl", ["-n", this.namespace, "cp", `${this.pod}:${full}`, target]);
    const bytes = r.code === 0 && existsSync(target) ? new Uint8Array(readFileSync(target)) : undefined;
    rmSync(host, { recursive: true, force: true });
    return bytes;
  }

  async writeBytes(path: string, bytes: Uint8Array) {
    const full = path.startsWith("/") ? path : `/workspace/${path}`;
    const host = mkdtempSync(join(tmpdir(), "kiln-cp-"));
    writeFileSync(join(host, "file"), bytes);
    await this.runner.run("kubectl", [...this.base(), "mkdir", "-p", dirname(full)]);
    await this.runner.run("kubectl", ["-n", this.namespace, "cp", join(host, "file"), `${this.pod}:${full}`]);
    rmSync(host, { recursive: true, force: true });
  }

  async snapshot(store: ObjectStore): Promise<SnapshotRef> {
    const host = mkdtempSync(join(tmpdir(), "kiln-snap-"));
    await this.runner.run("kubectl", [...this.base(), "tar", "-czf", "/tmp/snap.tgz", "-C", "/workspace", "."]);
    await this.runner.run("kubectl", ["-n", this.namespace, "cp", `${this.pod}:/tmp/snap.tgz`, join(host, "snap.tgz")]);
    const body = existsSync(join(host, "snap.tgz")) ? new Uint8Array(readFileSync(join(host, "snap.tgz"))) : new Uint8Array();
    const key = `snapshots/${this.id}/${Date.now()}.tgz`;
    await store.put(key, body, "application/gzip");
    rmSync(host, { recursive: true, force: true });
    return {
      key,
      provider: this.provider,
      sandboxId: this.id,
      createdAt: new Date().toISOString(),
      workspaceSha: createHash("sha256").update(body).digest("hex"),
      processState: false,
    };
  }

  async destroy() {
    await this.runner.run("kubectl", ["-n", this.namespace, "delete", "pod", this.pod, "--ignore-not-found"]);
    await this.runner.run("kubectl", ["-n", this.namespace, "delete", "networkpolicy", `${this.pod}-egress`, "--ignore-not-found"]);
  }
}

