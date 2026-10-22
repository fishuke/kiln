import type { DefinitionTree } from "@kiln/definitions";
import { HarnessType, SCHEMA_VERSION } from "@kiln/schema";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { ShipMode } from "../types";
import { markdown, type LayerKind, type ResolvedAppDefinition } from "./resolve";
import type { AppLayerTree } from "./tree";

const Name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, "use up to 64 letters, digits, spaces, dots, underscores or dashes");

/** A change to one agent in a layer, in the factory agent format. `null` removes the layer's own value. */
export const AgentSettingsPatch = z
  .object({
    description: z.string().nullable().optional(),
    harness: HarnessType.nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    instructions: z.string().optional(),
    mcpServers: z.array(z.string().min(1)).nullable().optional(),
    spawnableBy: z.array(z.string().min(1)).nullable().optional(),
  })
  .strict();
export type AgentSettingsPatch = z.infer<typeof AgentSettingsPatch>;

/** A structured change to one layer, as the App settings page makes it. `null` removes the layer's own value, so it inherits again. */
export const AppSettingsPatch = z
  .object({
    name: z.string().min(1).max(100).nullable().optional(),
    description: z.string().nullable().optional(),
    /** By agent name; `null` removes the layer's file for that agent. */
    agents: z.record(Name, AgentSettingsPatch.nullable()).optional(),
    skills: z
      .object({
        upsert: z.array(z.object({ name: Name, description: z.string().min(1), body: z.string() }).strict()).optional(),
        remove: z.array(z.string()).optional(),
        /** This layer's mandatory skills (inherited ones stay mandatory). */
        mandatory: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    policy: z.object({ maxShipMode: ShipMode.nullable().optional(), mergeGate: z.boolean().nullable().optional() }).strict().optional(),
    budgets: z.object({ monthlyUsd: z.number().positive().nullable().optional() }).strict().optional(),
  })
  .strict();
export type AppSettingsPatch = z.infer<typeof AppSettingsPatch>;

/** The policy file the settings page writes in a layer. */
export const SETTINGS_POLICY = "policies/studio.yaml";

const drop = (o: Record<string, unknown>, key: string, value: unknown) => {
  if (value === null) delete o[key];
  else if (value !== undefined) o[key] = value;
};

function frontmatterOf(content: string | undefined): Record<string, unknown> {
  const m = content ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(content) : null;
  return m ? ((parse(m[1]!) ?? {}) as Record<string, unknown>) : {};
}

/** Apply a settings patch to a layer's tree. */
export function applySettingsPatch(tree: DefinitionTree, layer: AppLayerTree, patch: AppSettingsPatch): DefinitionTree {
  const next: DefinitionTree = { ...tree };

  const manifest: Record<string, unknown> = tree["app.yaml"] ? (parse(tree["app.yaml"]) ?? {}) : { schemaVersion: SCHEMA_VERSION };
  drop(manifest, "name", patch.name);
  drop(manifest, "description", patch.description);
  if (patch.skills?.mandatory) {
    const skills = { ...(manifest.skills as Record<string, unknown> | undefined) };
    drop(skills, "mandatory", patch.skills.mandatory.length ? patch.skills.mandatory : null);
    drop(manifest, "skills", Object.keys(skills).length ? skills : null);
  }
  if (patch.budgets) {
    const budgets = { ...(manifest.budgets as Record<string, unknown> | undefined) };
    drop(budgets, "monthlyUsd", patch.budgets.monthlyUsd);
    drop(manifest, "budgets", Object.keys(budgets).length ? budgets : null);
  }
  next["app.yaml"] = stringify(manifest);

  for (const [name, a] of Object.entries(patch.agents ?? {})) {
    const file = `agents/${name}/agent.md`;
    if (a === null) {
      for (const path of Object.keys(next)) if (path.startsWith(`agents/${name}/`)) delete next[path];
      continue;
    }
    const fm = frontmatterOf(tree[file]);
    drop(fm, "description", a.description);
    if (a.harness === null) delete fm.harness;
    else if (a.harness !== undefined) fm.harness = { ...(fm.harness as object | undefined), type: a.harness };
    if (a.model !== undefined) {
      const harness = fm.harness as Record<string, unknown> | undefined;
      if (harness) drop(harness, "model", a.model);
      else drop(fm, "model", a.model);
    }
    // A file sets one of harness and model: a model next to a harness belongs to that harness.
    if (fm.harness && typeof fm.model === "string") {
      fm.harness = { ...(fm.harness as object), model: fm.model };
      delete fm.model;
    }
    drop(fm, "mcpServers", a.mcpServers);
    drop(fm, "spawnableBy", a.spawnableBy);
    next[file] = markdown(fm, (a.instructions ?? layer.agents[name]?.instructions ?? "").trim());
  }

  for (const s of patch.skills?.upsert ?? []) next[`skills/${s.name}/SKILL.md`] = markdown({ name: s.name, description: s.description }, s.body.trim());
  for (const s of patch.skills?.remove ?? []) for (const path of Object.keys(next)) if (path.startsWith(`skills/${s}/`)) delete next[path];

  if (patch.policy) {
    const policy: Record<string, unknown> = tree[SETTINGS_POLICY] ? (parse(tree[SETTINGS_POLICY]) ?? {}) : {};
    const shipMode = { ...(policy.shipMode as Record<string, unknown> | undefined) };
    drop(shipMode, "max", patch.policy.maxShipMode);
    drop(policy, "shipMode", Object.keys(shipMode).length ? shipMode : null);
    drop(policy, "mergeGate", patch.policy.mergeGate);
    if (Object.keys(policy).length) next[SETTINGS_POLICY] = stringify(policy);
    else delete next[SETTINGS_POLICY];
  }
  return next;
}

export type DefinitionVersion = { sha: string; by: string; at: string; message?: string };

export type AgentSettings = {
  description?: string;
  harness?: HarnessType;
  model?: string;
  instructions?: string;
  mcpServers?: string[];
  spawnableBy?: string[];
};

/** What the App settings page shows: resolved values, and what this layer sets itself. */
export type AppSettings = {
  /** Sha of the resolved definition. */
  sha: string;
  /** This layer's own sha and history. */
  layer: { kind: LayerKind; sha?: string; history: DefinitionVersion[] };
  resolved: {
    name?: string;
    description?: string;
    agents: {
      name: string;
      description?: string;
      harness: HarnessType;
      model?: string;
      instructions: string;
      mcpServers: string[];
      skills: string[];
      spawnableBy: string[];
      from: LayerKind;
    }[];
    skills: { name: string; description: string; body: string; mandatory: boolean; from: LayerKind }[];
    maxShipMode: ShipMode;
    mergeGate: boolean;
    monthlyUsd?: number;
  };
  own: {
    name?: string;
    description?: string;
    agents: Record<string, AgentSettings>;
    skills: string[];
    mandatory: string[];
    maxShipMode?: ShipMode;
    mergeGate?: boolean;
    monthlyUsd?: number;
  };
  warnings: string[];
};

const defined = <T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], null> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as { [K in keyof T]?: Exclude<T[K], null> };

export function settingsView(r: ResolvedAppDefinition, layer: AppLayerTree, meta: AppSettings["layer"]): AppSettings {
  const policy = layer.policies[SETTINGS_POLICY.slice("policies/".length, -".yaml".length)]?.policy;
  const agents: Record<string, AgentSettings> = {};
  for (const [name, a] of Object.entries(layer.agents)) {
    const fm = a.frontmatter;
    agents[name] = defined({
      description: fm.description,
      harness: fm.harness?.type,
      model: fm.harness?.model ?? fm.model,
      instructions: a.instructions,
      mcpServers: fm.mcpServers,
      spawnableBy: fm.spawnableBy,
    });
  }
  return {
    sha: r.sha,
    layer: meta,
    resolved: {
      ...defined({ name: r.name, description: r.description }),
      agents: Object.values(r.agents).map((a) => ({
        name: a.name,
        ...defined({ description: a.description, model: a.harness.model }),
        harness: a.harness.type,
        instructions: a.instructions,
        mcpServers: a.mcpServers,
        skills: a.skills,
        spawnableBy: a.spawnableBy,
        from: a.from,
      })),
      skills: Object.entries(r.skills)
        .map(([name, s]) => ({ name, description: s.description, body: s.body, mandatory: r.mandatorySkills.includes(name), from: s.from }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      maxShipMode: r.policy.maxShipMode,
      mergeGate: r.policy.mergeGate,
      ...defined({ monthlyUsd: r.monthlyUsd }),
    },
    own: {
      ...defined({
        name: layer.manifest?.name,
        description: layer.manifest?.description,
        maxShipMode: policy?.shipMode?.max,
        mergeGate: policy?.mergeGate,
        monthlyUsd: layer.manifest?.budgets?.monthlyUsd,
      }),
      agents,
      skills: Object.keys(layer.skills).sort(),
      mandatory: layer.manifest?.skills?.mandatory ?? [],
    },
    warnings: r.warnings,
  };
}
