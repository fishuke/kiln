import { z } from "zod";
import type { Kiln } from "../kiln";
import { PlatformError } from "./types";
import { MAX_SECRET_BYTES, SECRET_NAME } from "./vault";

/**
 * Environment variables and secrets for a Kiln Project's factories and Studio Apps
 * (docs/specs/project-environments.md). Each owner (team, project, factory, App) holds one layer per
 * named environment; layers apply team → project → factory or App, later keys replacing earlier ones.
 */

export const VARIABLES = "variables";
export const VARIABLE_SCOPES = ["team", "project", "factory", "app"] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];
/** Factory runs, PR previews and Studio previews use this environment. */
export const DEFAULT_ENVIRONMENT = "preview";
export const MAX_VARIABLES = 200;

export const ENVIRONMENT_NAME = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, "environment names use lowercase letters, digits and dashes, starting with a letter (at most 32)");
export const VariableInput = z
  .object({ key: SECRET_NAME, value: z.string().optional(), secret: z.boolean().optional() })
  .strict()
  .refine((v) => !v.key.startsWith("KILN_"), { message: "KILN_ is reserved for Kiln's own variables" });
export type VariableInput = z.infer<typeof VariableInput>;

type Variable = { key: string; secret: boolean; value: string; updatedBy: string; updatedAt: string };
type VariableLayer = {
  id: string;
  scope: VariableScope;
  owner: string;
  team: string;
  environment: string;
  variables: Variable[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};

/** A variable as the API returns it: a secret never carries its value. */
export type VariableView = { key: string; secret: true } | { key: string; secret: false; value: string };
export type VariableLayerView = Omit<VariableLayer, "variables"> & { variables: VariableView[] };
export type VariableSource = { scope: VariableScope; owner: string; secret: boolean };
export type ResolvedVariables = {
  env: Record<string, string>;
  /** Secret values in `env`, for redaction. */
  secretValues: string[];
  sources: Record<string, VariableSource>;
};

function valid<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new PlatformError(400, `${label}: ${r.error.issues.map((i) => i.message).join("; ")}`);
  return r.data;
}

export class VariableService {
  constructor(private readonly k: Kiln) {}

  private id(scope: VariableScope, owner: string, environment: string) {
    return `${scope}:${owner}:${environment}`;
  }

  private view(l: VariableLayer): VariableLayerView {
    return {
      ...l,
      variables: l.variables.map((v) => (v.secret ? { key: v.key, secret: true as const } : { key: v.key, secret: false as const, value: v.value })),
    };
  }

  /** The team an owner belongs to; an App's team comes from Studio, so the caller passes it. */
  teamOf(scope: VariableScope, owner: string, team?: string): string | undefined {
    if (scope === "team") return this.k.teams.get(owner)?.id;
    if (scope === "project") {
      const p = this.k.planning.project(owner);
      return p ? this.k.planning.projectTeam(p) : undefined;
    }
    if (scope === "factory") return this.k.teams.factoryTeam(owner);
    return team;
  }

  list(scope: VariableScope, owner: string): VariableLayerView[] {
    return this.k.store
      .list<VariableLayer>(VARIABLES, (l) => l.scope === scope && l.owner === owner)
      .sort((a, b) => a.environment.localeCompare(b.environment))
      .map((l) => this.view(l));
  }

  /** Replace a layer's variables. A secret listed without a value keeps its stored value. */
  set(input: { scope: VariableScope; owner: string; team?: string; environment: string; variables: VariableInput[] }, by: string): VariableLayerView {
    const environment = valid(ENVIRONMENT_NAME, input.environment, "environment");
    const team = this.teamOf(input.scope, input.owner, input.team);
    if (!team) throw new PlatformError(404, `unknown ${input.scope} ${input.owner}`);
    if (input.variables.length > MAX_VARIABLES) throw new PlatformError(400, `an environment holds at most ${MAX_VARIABLES} variables`);
    const id = this.id(input.scope, input.owner, environment);
    const existing = this.k.store.get<VariableLayer>(VARIABLES, id);
    const now = this.k.clock.now().toISOString();
    const seen = new Set<string>();
    const variables = input.variables.map((raw): Variable => {
      const v = valid(VariableInput, raw, raw.key);
      if (seen.has(v.key)) throw new PlatformError(400, `${v.key} is listed twice`);
      seen.add(v.key);
      const secret = v.secret ?? false;
      const before = existing?.variables.find((x) => x.key === v.key);
      if (v.value === undefined) {
        if (!before || before.secret !== secret) throw new PlatformError(400, `${v.key} needs a value`);
        return before;
      }
      if (Buffer.byteLength(v.value) > MAX_SECRET_BYTES) throw new PlatformError(400, `${v.key}: values are limited to 128 KiB`);
      const value = secret ? this.k.vault.seal(v.value) : v.value;
      const unchanged = before && before.secret === secret && (secret ? this.k.vault.unseal(before.value) === v.value : before.value === v.value);
      return unchanged ? before : { key: v.key, secret, value, updatedBy: by, updatedAt: now };
    });
    const layer: VariableLayer = {
      id,
      scope: input.scope,
      owner: input.owner,
      team,
      environment,
      variables,
      createdBy: existing?.createdBy ?? by,
      createdAt: existing?.createdAt ?? now,
      updatedBy: by,
      updatedAt: now,
    };
    this.k.store.put(VARIABLES, layer);
    this.k.audit(by, "variables.updated", id, { team, keys: variables.map((v) => v.key) });
    return this.view(layer);
  }

  delete(scope: VariableScope, owner: string, environment: string, by: string) {
    const id = this.id(scope, owner, environment);
    const layer = this.k.store.get<VariableLayer>(VARIABLES, id);
    if (!layer || !this.k.store.delete(VARIABLES, id)) throw new PlatformError(404, `no ${environment} variables for ${scope} ${owner}`);
    this.k.audit(by, "variables.deleted", id, { team: layer.team });
  }

  /** The final variables: team, then project, then factory or App; later layers replace earlier keys. */
  resolve(input: { team: string; project?: string; factory?: string; app?: string; environment: string }): ResolvedVariables {
    if (input.factory && input.app) throw new PlatformError(400, "resolve variables for a factory or an App, not both");
    const layers: [VariableScope, string | undefined][] = [
      ["team", input.team],
      ["project", input.project],
      input.factory ? ["factory", input.factory] : ["app", input.app],
    ];
    const out: ResolvedVariables = { env: {}, secretValues: [], sources: {} };
    for (const [scope, owner] of layers) {
      if (!owner) continue;
      const layer = this.k.store.get<VariableLayer>(VARIABLES, this.id(scope, owner, input.environment));
      for (const v of layer?.variables ?? []) {
        out.env[v.key] = v.secret ? String(this.k.vault.unseal(v.value)) : v.value;
        out.sources[v.key] = { scope, owner, secret: v.secret };
      }
    }
    out.secretValues = Object.entries(out.sources)
      .filter(([, s]) => s.secret)
      .map(([key]) => out.env[key]!);
    return out;
  }

  /** A factory's variables; undefined when it is in no project, so its runs are unchanged. */
  forFactory(factory: string, environment = DEFAULT_ENVIRONMENT): ResolvedVariables | undefined {
    const project = this.k.defs.get(factory)?.projectId;
    const team = this.k.teams.factoryTeam(factory);
    if (!project || !team) return undefined;
    return this.resolve({ team, project, factory, environment });
  }

  /** An App's variables (Studio installs, dev servers and runs): team → its project, if any → the App. */
  forApp(app: { id: string; team: string; projectId?: string }, environment = DEFAULT_ENVIRONMENT): ResolvedVariables {
    return this.resolve({ team: app.team, project: app.projectId, app: app.id, environment });
  }
}
