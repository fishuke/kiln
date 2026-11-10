import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ObjectStore } from "@kiln/store";
import { checkPort, guarded, hashDir, newSandboxId, runSetup, type Sandbox, type SandboxAddress, type SandboxListing, type SandboxProvider, type SandboxSpec, type SnapshotRef } from "./index";
import { NodeCommandRunner, type CommandRunner } from "./process";

/**
 * The Fake for `SandboxProvider`: the workspace is a temporary directory and commands are plain
 * processes on this machine, so tests need no Docker. It isolates nothing. It is not a backend:
 * no runner definition, server setting or worker option can select it (ADR-017).
 */
export class FakeSandboxProvider implements SandboxProvider {
  readonly name = "fake";
  private readonly live = new Set<string>();

  constructor(
    private readonly root = join(tmpdir(), "kiln-sandboxes"),
    private readonly runner: CommandRunner = new NodeCommandRunner(),
  ) {
    mkdirSync(root, { recursive: true });
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const id = newSandboxId();
    const workdir = mkdtempSync(join(this.root, `${id}-`));
    const sandbox = this.track(new FakeSandbox(id, workdir, spec, this.runner, started));
    try {
      for (const repo of spec.repos) {
        const args = ["clone", "--quiet", repo.url, repo.name];
        const r = await this.runner.run("git", args, { cwd: workdir });
        if (r.code !== 0) throw new Error(`git clone ${repo.url} failed: ${r.stderr}`);
        if (repo.branch) await this.runner.run("git", ["checkout", "-q", "-B", repo.branch], { cwd: join(workdir, repo.name) });
      }
      await runSetup(sandbox, spec);
    } catch (err) {
      await sandbox.destroy();
      throw err;
    }
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }

  private track(sandbox: FakeSandbox): FakeSandbox {
    const dir = basename(sandbox.workdir);
    this.live.add(dir);
    sandbox.onDestroy = () => this.live.delete(dir);
    return sandbox;
  }

  async sweep(): Promise<string[]> {
    const stale = readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !this.live.has(d.name))
      .map((d) => d.name);
    for (const d of stale) rmSync(join(this.root, d), { recursive: true, force: true });
    return stale;
  }

  async list(): Promise<SandboxListing[]> {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const live = this.live.has(d.name);
        return {
          name: d.name,
          provider: this.name,
          state: live ? "running" : "left behind",
          live,
          createdAt: statSync(join(this.root, d.name)).birthtime.toISOString(),
        };
      });
  }

  async resume(ref: SnapshotRef, spec: SandboxSpec, store: ObjectStore): Promise<Sandbox> {
    const started = Date.now();
    const body = await store.get(ref.key);
    if (!body) throw new Error(`snapshot ${ref.key} not found`);
    const id = newSandboxId();
    const workdir = mkdtempSync(join(this.root, `${id}-`));
    const archive = join(workdir, "..", `${id}.tgz`);
    writeFileSync(archive, body);
    const r = await this.runner.run("tar", ["-xzf", archive, "-C", workdir]);
    rmSync(archive, { force: true });
    if (r.code !== 0) {
      rmSync(workdir, { recursive: true, force: true });
      throw new Error(`restoring snapshot failed: ${r.stderr}`);
    }
    const sandbox = this.track(new FakeSandbox(id, workdir, spec, this.runner, started));
    sandbox.startedInMs = Date.now() - started;
    return sandbox;
  }
}

class FakeSandbox implements Sandbox {
  readonly provider = "fake";
  /** The workspace is a directory on this machine, so the engine can hash it. */
  get hostDir() {
    return this.workdir;
  }
  onDestroy?: () => void;
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
    this.onDestroy?.();
    rmSync(this.workdir, { recursive: true, force: true });
  }

  /** The processes run on this machine, so their ports are its own. */
  async expose(port: number): Promise<SandboxAddress> {
    checkPort(port);
    return { host: "127.0.0.1", port };
  }
}
