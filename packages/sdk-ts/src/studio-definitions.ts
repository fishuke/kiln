/**
 * Studio App definition types (docs/specs/app-definitions.md). Re-declared here so the SDK and
 * the web app don't depend on @kiln/studio; studio-definitions.test.ts keeps them assignable.
 */

export type StudioShipMode = "safe" | "review" | "cowboy";
export type StudioHarnessType = "claude-code" | "codex" | "opencode" | "gemini" | "pi";
export type StudioLayerKind = "builtin" | "team" | "project" | "app";

/** Which layer: an App's own, a Kiln Project's defaults, or the current team's defaults. */
export type StudioDefinitionScope = { app: string } | { project: string } | "team";

export type StudioDefinitionVersion = { sha: string; by: string; at: string; message?: string };

export type StudioDefinitionLayer = { sha?: string; tree: Record<string, string>; history: StudioDefinitionVersion[] };

export type StudioDefinitionSaved = { sha: string; changed: boolean };

/** A change to one agent in a layer (factory agent format). `null` removes the layer's own value. */
export type StudioAgentPatch = {
  description?: string | null;
  harness?: StudioHarnessType | null;
  model?: string | null;
  instructions?: string;
  mcpServers?: string[] | null;
  spawnableBy?: string[] | null;
};

export type StudioAgentSettings = {
  description?: string;
  harness?: StudioHarnessType;
  model?: string;
  instructions?: string;
  mcpServers?: string[];
  spawnableBy?: string[];
};

/** A structured change to one layer. `null` removes the layer's own value so it inherits again. */
export type StudioSettingsPatch = {
  name?: string | null;
  description?: string | null;
  /** By agent name; `null` removes the layer's file for that agent. */
  agents?: Record<string, StudioAgentPatch | null>;
  skills?: { upsert?: { name: string; description: string; body: string }[]; remove?: string[]; mandatory?: string[] };
  /** Only team owners and admins may change it. */
  policy?: {
    maxShipMode?: StudioShipMode | null;
    roles?: { owner?: StudioShipMode | null; admin?: StudioShipMode | null; member?: StudioShipMode | null };
    pushDefaultBranch?: boolean | null;
    mergeGate?: boolean | null;
  };
  budgets?: { monthlyUsd?: number | null };
};

export type StudioTeamRole = "owner" | "admin" | "member";
export type StudioPolicyKey = "maxShipMode" | "roles" | "pushDefaultBranch" | "mergeGate";

/** Ship mode caps and switches of an App, resolved from its definition. */
export type StudioAppPolicy = {
  maxShipMode: StudioShipMode;
  roles: Partial<Record<StudioTeamRole, StudioShipMode>>;
  pushDefaultBranch: boolean;
  mergeGate: boolean;
  changedBy: Partial<Record<StudioPolicyKey, { by: string; at: string; layer: StudioLayerKind }>>;
};

export type StudioAppSettings = {
  sha: string;
  layer: { kind: StudioLayerKind; sha?: string; history: StudioDefinitionVersion[] };
  resolved: {
    name?: string;
    description?: string;
    agents: {
      name: string;
      description?: string;
      harness: StudioHarnessType;
      model?: string;
      instructions: string;
      mcpServers: string[];
      skills: string[];
      spawnableBy: string[];
      from: StudioLayerKind;
    }[];
    skills: { name: string; description: string; body: string; mandatory: boolean; from: StudioLayerKind }[];
    policy: StudioAppPolicy;
    monthlyUsd?: number;
  };
  own: {
    name?: string;
    description?: string;
    agents: Record<string, StudioAgentSettings>;
    skills: string[];
    mandatory: string[];
    policy: { maxShipMode?: StudioShipMode; roles: Partial<Record<StudioTeamRole, StudioShipMode>>; pushDefaultBranch?: boolean; mergeGate?: boolean };
    monthlyUsd?: number;
  };
  warnings: string[];
};

/** The path segment of a scope: `apps/<id>`, `projects/<id>` or `team`. */
export function studioScopePath(scope: StudioDefinitionScope): string {
  if (scope === "team") return "team";
  return "app" in scope ? `apps/${encodeURIComponent(scope.app)}` : `projects/${encodeURIComponent(scope.project)}`;
}
