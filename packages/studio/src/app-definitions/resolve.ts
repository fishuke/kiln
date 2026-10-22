import { applyLayer, treeSha, type DefinitionTree } from "@kiln/definitions";
import { SCHEMA_VERSION, type AppShipMode, type Harness, type HarnessType } from "@kiln/schema";
import { stringify } from "yaml";
import type { z } from "zod";
import type { AppLayerTree } from "./tree";

type HarnessT = z.infer<typeof Harness>;
type Exec = Parameters<typeof applyLayer>[0];

export type LayerKind = "builtin" | "team" | "project" | "app";
export type ResolvedLayer = { kind: LayerKind; id?: string; sha?: string; tree: AppLayerTree };

export type AppPolicySummary = {
  /** The highest ship mode anyone may pick: the lowest cap of every policy. */
  maxShipMode: AppShipMode;
  /** The highest ship mode per role, the lowest cap per role. */
  roles: Record<string, AppShipMode>;
  /** On unless a policy turns it off. */
  mergeGate: boolean;
};

export type ResolvedAppDefinition = {
  /** Content hash of the resolved tree (see `exportResolved`). */
  sha: string;
  layers: { kind: LayerKind; id?: string; sha?: string }[];
  name?: string;
  description?: string;
  lead: { name: string; harness: HarnessT; mcpServers: string[]; secrets: string[]; instructions: string; exec: Exec };
  skills: Record<string, { description: string; body: string; content: string; from: LayerKind }>;
  mandatorySkills: string[];
  policy: AppPolicySummary;
  policies: { from: LayerKind; name: string; content: string }[];
  monthlyUsd?: number;
  warnings: string[];
};

export const SHIP_MODES: readonly AppShipMode[] = ["safe", "review", "cowboy"];
const lowest = (a: AppShipMode, b: AppShipMode) => (SHIP_MODES.indexOf(a) <= SHIP_MODES.indexOf(b) ? a : b);

/** The highest ship mode a person with `role` may pick under these policies. */
export function maxShipMode(policy: AppPolicySummary, role?: string): AppShipMode {
  const byRole = role ? policy.roles[role] : undefined;
  return byRole ? lowest(policy.maxShipMode, byRole) : policy.maxShipMode;
}

/** The layer every App starts from: a Claude Code lead named `builder`, no caps beyond `cowboy`, merge gate on. */
export const BUILTIN_LAYER: ResolvedLayer = {
  kind: "builtin",
  tree: { lead: { name: "builder", frontmatter: { agentType: "CUSTOM", harness: { type: "claude-code" } }, instructions: "" }, skills: {}, policies: {} },
};

/** Merge layers in order (built-in, team, Kiln Project, App). See docs/specs/app-definitions.md for the rules. */
export function resolveLayers(layers: ResolvedLayer[]): ResolvedAppDefinition {
  let exec: Exec = {};
  let leadName = "builder";
  let instructions = "";
  let name: string | undefined;
  let description: string | undefined;
  let monthlyUsd: number | undefined;
  const skills: ResolvedAppDefinition["skills"] = {};
  const mandatory: string[] = [];
  const policies: ResolvedAppDefinition["policies"] = [];
  const policy: AppPolicySummary = { maxShipMode: "cowboy", roles: {}, mergeGate: true };

  for (const { kind, tree } of layers) {
    if (tree.lead) {
      exec = applyLayer(exec, tree.lead.frontmatter);
      leadName = tree.lead.name;
      if (tree.lead.instructions) instructions = tree.lead.instructions;
    }
    const m = tree.manifest;
    if (m?.name !== undefined) name = m.name;
    if (m?.description !== undefined) description = m.description;
    const cap = m?.budgets?.monthlyUsd;
    if (cap !== undefined) monthlyUsd = monthlyUsd === undefined ? cap : Math.min(monthlyUsd, cap);
    for (const s of m?.skills?.mandatory ?? []) if (!mandatory.includes(s)) mandatory.push(s);
    for (const [skill, s] of Object.entries(tree.skills))
      skills[skill] = { description: s.frontmatter.description, body: s.body, content: s.content, from: kind };
    for (const [file, p] of Object.entries(tree.policies)) {
      policies.push({ from: kind, name: file, content: p.content });
      if (p.policy.shipMode?.max) policy.maxShipMode = lowest(policy.maxShipMode, p.policy.shipMode.max);
      for (const [role, mode] of Object.entries(p.policy.shipMode?.roles ?? {}))
        policy.roles[role] = policy.roles[role] ? lowest(policy.roles[role]!, mode) : mode;
      if (p.policy.mergeGate === false) policy.mergeGate = false;
    }
  }

  const warnings: string[] = [];
  const mandatorySkills = mandatory.filter((s) => {
    if (skills[s]) return true;
    warnings.push(`mandatory skill ${s} is not defined in any layer and is skipped`);
    return false;
  });
  const harness: HarnessT = { ...(exec.harness ?? { type: "claude-code" as HarnessType }) };
  if (!exec.harness && exec.model) harness.model = exec.model;

  const resolved: ResolvedAppDefinition = {
    sha: "",
    layers: layers.map((l) => ({ kind: l.kind, ...(l.id ? { id: l.id } : {}), ...(l.sha ? { sha: l.sha } : {}) })),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    lead: { name: leadName, harness, mcpServers: exec.mcpServers ?? [], secrets: exec.secrets ?? [], instructions, exec },
    skills,
    mandatorySkills,
    policy,
    policies,
    ...(monthlyUsd !== undefined ? { monthlyUsd } : {}),
    warnings,
  };
  resolved.sha = treeSha(exportResolved(resolved));
  return resolved;
}

export function markdown(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body ? `${body}\n` : ""}`;
}

/**
 * The resolved definition as one `kiln/v1` App tree, for Git. Skills keep their files as written;
 * team and project policies are prefixed with their layer (`policies/team-guard.yaml`).
 */
export function exportResolved(r: ResolvedAppDefinition): DefinitionTree {
  const manifest: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION };
  if (r.name !== undefined) manifest.name = r.name;
  if (r.description !== undefined) manifest.description = r.description;
  if (r.mandatorySkills.length) manifest.skills = { mandatory: r.mandatorySkills };
  if (r.monthlyUsd !== undefined) manifest.budgets = { monthlyUsd: r.monthlyUsd };
  const lead: Record<string, unknown> = { harness: r.lead.harness };
  if (r.lead.mcpServers.length) lead.mcpServers = r.lead.mcpServers;
  if (r.lead.secrets.length) lead.secrets = r.lead.secrets;
  const tree: DefinitionTree = {
    "app.yaml": stringify(manifest),
    [`agents/${r.lead.name}/agent.md`]: markdown(lead, r.lead.instructions),
  };
  for (const [name, s] of Object.entries(r.skills)) tree[`skills/${name}/SKILL.md`] = s.content;
  for (const p of r.policies) tree[`policies/${p.from === "app" || p.from === "builtin" ? "" : `${p.from}-`}${p.name}.yaml`] = p.content;
  return tree;
}
