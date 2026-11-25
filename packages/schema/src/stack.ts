import { z } from "zod";

/**
 * How a product runs (ADR-020): its services, how each installs, migrates, seeds and starts, and
 * how they reach each other. Lives as `stack.yaml` in the factory tree.
 */

/** A service name is part of a preview host name (`<target>-<service>.<domain>`). */
const ServiceName = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/, "use up to 20 lowercase letters, digits and dashes, starting with a letter");

export const StackSeed = z.union([
  z.string().min(1),
  z
    .object({
      /** Where the seed comes from: a URL or object-store key the restore command reads as $KILN_SEED. */
      from: z.string().min(1),
      /** How to load it; defaults to the service's own `seed` handling by kind. */
      restore: z.string().optional(),
    })
    .strict(),
]);

export const StackService = z
  .object({
    /** owner/name of the repository; none for a datastore or a tool the runner image has. */
    repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "owner/name").optional(),
    kind: z.enum(["service", "datastore", "library"]).default("service"),
    /** The branch unchanged services run; defaults to the repository's default branch. */
    base: z.string().optional(),
    /** What people call this surface ("Customer site"); a service with a surface is a frontend people click through. */
    surface: z.string().optional(),
    install: z.string().optional(),
    migrate: z.string().optional(),
    seed: StackSeed.optional(),
    start: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    /** An HTTP path that answers 2xx/3xx when the service is ready, or a shell command that exits 0. */
    health: z.string().optional(),
    depends_on: z.array(ServiceName).default([]),
    /** Values may name other services: `${services.api.url}`. */
    env: z.record(z.string(), z.string()).default({}),
    /** Env names read in the browser: their `${services.x.url}` becomes the exposed preview URL. */
    env_public: z.array(z.string()).default([]),
    /** Files the contract check reads (e.g. `graphql_schema`, `graphql_operations`, `openapi`). */
    contracts: z.record(z.string(), z.string()).optional(),
    /** A library is linked into these services instead of started. */
    link: z.object({ into: z.array(ServiceName).min(1) }).strict().optional(),
    /** Hosts this service may reach from the preview; everything else is blocked. */
    egress: z.array(z.string()).optional(),
  })
  .strict();
export type StackService = z.infer<typeof StackService>;

export const Stack = z
  .object({
    apiVersion: z.literal("kiln/v1").default("kiln/v1"),
    kind: z.literal("Stack").default("Stack"),
    name: z.string().min(1),
    runner: z.object({ image: z.string().min(1), shape: z.string().optional() }).strict().optional(),
    services: z.record(ServiceName, StackService).refine((s) => Object.keys(s).length > 0, "a stack needs at least one service"),
    /** Merge order of the change set's pull requests; unlisted services merge last, in start order. */
    merge_order: z.array(ServiceName).optional(),
    /** Where the end-to-end flows live, relative to the first repository. */
    flows: z.string().optional(),
  })
  .strict();
export type Stack = z.infer<typeof Stack>;

const REF = /\$\{services\.([a-z][a-z0-9-]*)\.url\}/g;

function refsIn(value: string): string[] {
  return [...value.matchAll(REF)].map((m) => m[1]!);
}

/** What is wrong with a stack, as sentences; empty when it is fine. `repos` are the factory's owner/name keys. */
export function stackProblems(stack: Stack, repos?: string[]): string[] {
  const out: string[] = [];
  const names = Object.keys(stack.services);
  const known = new Set(names);
  const repoKeys = repos ? new Set(repos.map((r) => r.toLowerCase())) : undefined;
  const ports = new Map<number, string>();
  for (const [name, s] of Object.entries(stack.services)) {
    for (const d of s.depends_on) if (!known.has(d)) out.push(`${name}: depends_on names an unknown service ${d}`);
    for (const t of s.link?.into ?? []) if (!known.has(t)) out.push(`${name}: link.into names an unknown service ${t}`);
    for (const [k, v] of Object.entries(s.env)) for (const r of refsIn(v)) if (!known.has(r)) out.push(`${name}: env ${k} names an unknown service ${r}`);
    if (s.port !== undefined) {
      const other = ports.get(s.port);
      if (other) out.push(`port ${s.port} is used by ${other} and ${name}`);
      else ports.set(s.port, name);
    }
    if (s.kind !== "library" && !s.start) out.push(`${name}: needs a start command`);
    if (s.kind === "library" && !s.link) out.push(`${name}: a library needs link.into`);
    if (s.kind !== "datastore" && !s.repo) out.push(`${name}: needs a repository (repo: owner/name)`);
    if (s.repo && repoKeys && !repoKeys.has(s.repo.toLowerCase())) out.push(`${name}: repository ${s.repo} is not in factory.yaml repositories`);
  }
  for (const [name, s] of Object.entries(stack.services)) {
    for (const v of Object.values(s.env)) {
      for (const r of refsIn(v)) if (known.has(r) && stack.services[r]!.port === undefined) out.push(`${r}: ${name} reads \${services.${r}.url}, so ${r} needs a port`);
    }
  }
  for (const m of stack.merge_order ?? []) if (!known.has(m)) out.push(`merge_order names an unknown service ${m}`);
  const cycle = findCycle(stack);
  if (cycle) out.push(`depends_on has a cycle: ${cycle.join(" → ")}`);
  return [...new Set(out)];
}

function findCycle(stack: Stack): string[] | undefined {
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (n: string): string[] | undefined => {
    if (state.get(n) === "done") return undefined;
    if (state.get(n) === "visiting") return [...path.slice(path.indexOf(n)), n];
    state.set(n, "visiting");
    path.push(n);
    for (const d of stack.services[n]?.depends_on ?? []) {
      if (!stack.services[d]) continue;
      const c = visit(d);
      if (c) return c;
    }
    path.pop();
    state.set(n, "done");
    return undefined;
  };
  for (const n of Object.keys(stack.services)) {
    const c = visit(n);
    if (c) return c;
  }
  return undefined;
}

/** Services to start, dependencies first; libraries are linked, not started. Assumes no cycle. */
export function startOrder(stack: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n) || !stack.services[n]) return;
    seen.add(n);
    for (const d of stack.services[n]!.depends_on) visit(d);
    if (stack.services[n]!.kind !== "library") out.push(n);
  };
  for (const n of Object.keys(stack.services)) visit(n);
  return out;
}

/** The order the change set's pull requests merge in: merge_order first, then the rest in start order. */
export function mergeOrder(stack: Stack, repos: string[]): string[] {
  const byService = (svc: string) => stack.services[svc]?.repo;
  const listed = (stack.merge_order ?? []).map(byService).filter((r): r is string => Boolean(r));
  const rest = [...startOrder(stack), ...Object.keys(stack.services)].map(byService).filter((r): r is string => Boolean(r));
  const want = new Set(repos.map((r) => r.toLowerCase()));
  const ordered = [...new Set([...listed, ...rest].map((r) => r.toLowerCase()))].filter((r) => want.has(r));
  return [...ordered.map((r) => repos.find((x) => x.toLowerCase() === r)!), ...repos.filter((r) => !ordered.includes(r.toLowerCase()))];
}

/**
 * A service's environment: `base` (project environments) underneath, the stack's env on top, with
 * `${services.x.url}` as `http://localhost:<port>` inside the sandbox, or the exposed preview URL for
 * names in `env_public` (read in the browser).
 */
export function resolveStackEnv(stack: Stack, service: string, publicUrls: Record<string, string>, base: Record<string, string> = {}): Record<string, string> {
  const s = stack.services[service];
  if (!s) throw new Error(`the stack has no service ${service}`);
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(s.env)) {
    const isPublic = s.env_public.includes(k);
    out[k] = v.replace(REF, (_, name: string) => {
      const port = stack.services[name]?.port;
      return isPublic && publicUrls[name] ? publicUrls[name]! : `http://localhost:${port}`;
    });
  }
  return out;
}
