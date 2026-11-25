import { randomBytes } from "node:crypto";
import { Runner, startOrder, type Stack } from "@kiln/schema";
import type { Sandbox, SandboxAddress } from "@kiln/sandbox";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { SandboxStackRunner, type ServiceState, type StackRunner } from "./stack-runner";

/**
 * Stack previews (ADR-020): a factory's whole stack in one sandbox, one URL per service, every
 * frontend wired to this stack's API. The record is runtime state in the Store; the sandbox and its
 * processes live in this process.
 */

export type StackPreview = {
  id: string;
  factory: string;
  branch?: string;
  changed: string[];
  workItemId?: string;
  by: string;
  state: "starting" | "running" | "failed" | "destroyed";
  healthy: boolean;
  services: ServiceState[];
  failed?: { service: string; reason: string; log: string[] };
  sandboxId?: string;
  createdAt: string;
  destroyedAt?: string;
};

const COLLECTION = "stack_previews";
/** Registry hosts installs need on top of each service's own egress. */
const INSTALL_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com"];

export class StackPreviews {
  private readonly live = new Map<string, { sandbox: Sandbox; runner: StackRunner; addresses: Map<number, SandboxAddress> }>();
  private makeRunner: (sandbox: Sandbox) => StackRunner = (sandbox) => new SandboxStackRunner(sandbox);
  /** The preview URL of a target (`st_<id>.<service>`); the API sets it from its preview domain. */
  publicUrl: (target: string) => string = (target) => `http://${target.replace("_", "-").replace(".", "-")}.preview.localhost`;

  constructor(private readonly k: Kiln) {}

  /** Tests and the CLI swap how a stack is run. */
  useRunner(make: (sandbox: Sandbox) => StackRunner) {
    this.makeRunner = make;
  }

  get(id: string): StackPreview | undefined {
    return this.k.store.get<StackPreview>(COLLECTION, id);
  }

  list(filter: { factory?: string; workItemId?: string } = {}): StackPreview[] {
    return this.k.store
      .list<StackPreview>(COLLECTION, (p) => (!filter.factory || p.factory === filter.factory) && (!filter.workItemId || p.workItemId === filter.workItemId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private save(p: StackPreview) {
    this.k.store.put(COLLECTION, p);
    return p;
  }

  async up(input: { factory: string; branch?: string; changed?: string[]; workItemId?: string; by: string }): Promise<StackPreview> {
    const resolved = this.k.defs.current(input.factory);
    const stack: Stack | undefined = resolved.parsed.stack;
    if (!stack) throw new KilnError("invalid_request", `factory ${input.factory} has no stack.yaml`);
    const id = `st_${randomBytes(12).toString("hex")}`;
    const p = this.save({ id, factory: input.factory, ...(input.branch ? { branch: input.branch } : {}), changed: input.changed ?? [], ...(input.workItemId ? { workItemId: input.workItemId } : {}), by: input.by, state: "starting", healthy: false, services: [], createdAt: this.k.clock.now().toISOString() });

    // Every repository the stack names, each cloned once into a folder of its own name.
    const repoKeys = [...new Set(Object.values(stack.services).flatMap((s) => (s.repo ? [s.repo] : [])))];
    const repos = repoKeys.map((key) => {
      const known = resolved.factory.repositories.find((r) => `${r.owner}/${r.name}`.toLowerCase() === key.toLowerCase());
      if (!known) throw new KilnError("invalid_request", `stack service repository ${key} is not in factory.yaml repositories`);
      return known;
    });
    const egress = [...new Set([...INSTALL_HOSTS, ...Object.values(stack.services).flatMap((s) => s.egress ?? [])])];
    const named = stack.runner?.image ? undefined : resolved.parsed.runners.stack;
    const runner = Runner.parse({ ...(named ?? {}), image: stack.runner?.image ?? named?.image ?? "kiln-runner-stack:local", egress });
    const provider = this.k.runs.sandboxProvider(runner.backend);
    const sandbox = await provider.create({
      runner: { ...runner, image: runner.image!, workspaceSetupCommands: [] },
      repos: await Promise.all(repos.map(async (r) => ({ name: r.name, url: this.k.forge.cloneUrl(r, await this.k.forge.sandboxToken?.(r)) }))),
      labels: { "kiln.dev/stack": id, "kiln.dev/factory": input.factory },
      preview: true,
    });
    const stackRunner = this.makeRunner(sandbox);
    this.live.set(id, { sandbox, runner: stackRunner, addresses: new Map() });
    const dirs = Object.fromEntries(Object.entries(stack.services).flatMap(([svc, s]) => (s.repo ? [[svc, s.repo.split("/")[1]!]] : [])));
    try {
      const up = await stackRunner.up({ stack, dirs, publicUrl: (svc) => this.publicUrl(`${id}.${svc}`), ...(input.branch ? { branch: input.branch } : {}), changed: input.changed ?? [] });
      return this.save({ ...p, sandboxId: sandbox.id, state: up.healthy ? "running" : "failed", healthy: up.healthy, services: up.services, ...(up.failed ? { failed: up.failed } : {}) });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const first = startOrder(stack)[0] ?? "stack";
      return this.save({ ...p, sandboxId: sandbox.id, state: "failed", healthy: false, failed: { service: first, reason, log: [] } });
    }
  }

  /** The preview proxy's resolver for `st_<id>.<service>`. */
  async resolvePreview(target: string): Promise<SandboxAddress | undefined> {
    const [id, service] = target.split(".");
    const live = id ? this.live.get(id) : undefined;
    const port = service ? this.get(id!)?.services.find((s) => s.service === service)?.port : undefined;
    if (!live || !port || !live.sandbox.expose) return undefined;
    const known = live.addresses.get(port);
    if (known) return known;
    const a = await live.sandbox.expose(port);
    live.addresses.set(port, a);
    return a;
  }

  logs(id: string, service: string): string[] {
    return this.live.get(id)?.runner.logs(service) ?? [];
  }

  async destroy(id: string): Promise<void> {
    const live = this.live.get(id);
    this.live.delete(id);
    if (live) {
      await live.runner.down().catch(() => undefined);
      await live.sandbox.destroy().catch(() => undefined);
    }
    const p = this.get(id);
    if (p && p.state !== "destroyed") this.save({ ...p, state: "destroyed", destroyedAt: this.k.clock.now().toISOString() });
  }

  /** A work item closed: its stack previews go. */
  async destroyFor(workItemId: string): Promise<void> {
    for (const p of this.list({ workItemId })) if (p.state !== "destroyed") await this.destroy(p.id);
  }
}
