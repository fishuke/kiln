import type { DefinitionTree } from "@kiln/definitions";
import { HarnessType, SCHEMA_VERSION } from "@kiln/schema";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { ShipMode } from "../types";
import { markdown, type LayerKind, type ResolvedAppDefinition } from "./resolve";
import type { AppLayerTree } from "./tree";

const SkillName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, "use up to 64 letters, digits, spaces, dots, underscores or dashes");

/** A structured change to one layer, as the App settings page makes it. `null` removes the layer's own value, so it inherits again. */
export const AppSettingsPatch = z
  .object({
    name: z.string().min(1).max(100).nullable().optional(),
    description: z.string().nullable().optional(),
    lead: z
      .object({
        harness: HarnessType.nullable().optional(),
        model: z.string().min(1).nullable().optional(),
        instructions: z.string().optional(),
        mcpServers: z.array(z.string().min(1)).nullable().optional(),
      })
      .strict()
      .optional(),
    skills: z
      .object({
        upsert: z.array(z.object({ name: SkillName, description: z.string().min(1), body: z.string() }).strict()).optional(),
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

/** Apply a settings patch to a layer's tree. `leadName` names the lead file when the layer has none yet. */
export function applySettingsPatch(tree: DefinitionTree, layer: AppLayerTree, patch: AppSettingsPatch, leadName: string): DefinitionTree {
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

  if (patch.lead) {
    const name = layer.lead?.name ?? leadName;
    const file = `agents/${name}/agent.md`;
    const fm: Record<string, unknown> = layer.lead ? parseFrontmatter(tree[file]!) : {};
    const l = patch.lead;
    if (l.harness === null) delete fm.harness;
    else if (l.harness !== undefined) fm.harness = { ...(fm.harness as object | undefined), type: l.harness };
    if (l.model !== undefined) {
      const harness = fm.harness as Record<string, unknown> | undefined;
      if (harness) drop(harness, "model", l.model);
      else drop(fm, "model", l.model);
    }
    if (fm.harness && typeof fm.model === "string") {
      fm.harness = { ...(fm.harness as object), model: fm.model };
      delete fm.model;
    }
    drop(fm, "mcpServers", l.mcpServers);
    const instructions = l.instructions ?? layer.lead?.instructions ?? "";
    next[file] = markdown(fm, instructions.trim());
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

function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? ((parse(m[1]!) ?? {}) as Record<string, unknown>) : {};
}

/** What the App settings page shows: resolved values, and what this layer sets itself. */
export type AppSettings = {
  /** Sha of the resolved definition. */
  sha: string;
  /** This layer's own sha and history. */
  layer: { kind: LayerKind; sha?: string; history: DefinitionVersion[] };
  resolved: {
    name?: string;
    description?: string;
    lead: { name: string; harness: HarnessType; model?: string; instructions: string; mcpServers: string[] };
    skills: { name: string; description: string; body: string; mandatory: boolean; from: LayerKind }[];
    maxShipMode: ShipMode;
    mergeGate: boolean;
    monthlyUsd?: number;
  };
  own: {
    name?: string;
    description?: string;
    harness?: HarnessType;
    model?: string;
    instructions?: string;
    mcpServers?: string[];
    skills: string[];
    mandatory: string[];
    maxShipMode?: ShipMode;
    mergeGate?: boolean;
    monthlyUsd?: number;
  };
  warnings: string[];
};

export type DefinitionVersion = { sha: string; by: string; at: string; message?: string };

export function settingsView(r: ResolvedAppDefinition, layer: AppLayerTree, meta: AppSettings["layer"]): AppSettings {
  const fm = layer.lead?.frontmatter;
  const policy = layer.policies[SETTINGS_POLICY.slice("policies/".length, -".yaml".length)]?.policy;
  const own: AppSettings["own"] = { skills: Object.keys(layer.skills).sort(), mandatory: layer.manifest?.skills?.mandatory ?? [] };
  const set = <K extends keyof AppSettings["own"]>(k: K, v: AppSettings["own"][K] | null | undefined) => {
    if (v !== undefined && v !== null) own[k] = v;
  };
  set("name", layer.manifest?.name);
  set("description", layer.manifest?.description);
  set("harness", fm?.harness?.type);
  set("model", fm?.harness?.model ?? fm?.model);
  set("instructions", layer.lead?.instructions || undefined);
  set("mcpServers", fm?.mcpServers);
  set("maxShipMode", policy?.shipMode?.max);
  set("mergeGate", policy?.mergeGate);
  set("monthlyUsd", layer.manifest?.budgets?.monthlyUsd);
  return {
    sha: r.sha,
    layer: meta,
    resolved: {
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.description !== undefined ? { description: r.description } : {}),
      lead: {
        name: r.lead.name,
        harness: r.lead.harness.type,
        ...(r.lead.harness.model ? { model: r.lead.harness.model } : {}),
        instructions: r.lead.instructions,
        mcpServers: r.lead.mcpServers,
      },
      skills: Object.entries(r.skills)
        .map(([name, s]) => ({ name, description: s.description, body: s.body, mandatory: r.mandatorySkills.includes(name), from: s.from }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      maxShipMode: r.policy.maxShipMode,
      mergeGate: r.policy.mergeGate,
      ...(r.monthlyUsd !== undefined ? { monthlyUsd: r.monthlyUsd } : {}),
    },
    own,
    warnings: r.warnings,
  };
}
