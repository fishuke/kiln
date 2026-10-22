import { applyLayer, resolveAgent, treeSha, type DefinitionTree, type ResolvedAgent } from "@kiln/definitions";
import { SCHEMA_VERSION, type AgentFrontmatter, type AppShipMode } from "@kiln/schema";
import { parse as parseYaml, stringify } from "yaml";
import type { AppLayerTree } from "./tree";

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

type SkillText = { description: string; body: string };

/** A factory `ResolvedAgent`, plus where it was last defined and the bodies of its own skills. */
export type ResolvedAppAgent = ResolvedAgent & { from: LayerKind; ownSkills: Record<string, SkillText> };

export type ResolvedAppDefinition = {
  /** Content hash of the resolved tree (see `exportResolved`). */
  sha: string;
  layers: { kind: LayerKind; id?: string; sha?: string }[];
  name?: string;
  description?: string;
  agents: Record<string, ResolvedAppAgent>;
  /** Shared skills, by name. */
  skills: Record<string, SkillText & { from: LayerKind }>;
  mandatorySkills: string[];
  policy: AppPolicySummary;
  monthlyUsd?: number;
  warnings: string[];
  /** Files of the resolved tree, before hashing. */
  files: DefinitionTree;
};

/** The agent a chat runs when it names none; the built-in layer defines it. */
export const DEFAULT_AGENT = "general";

export const SHIP_MODES: readonly AppShipMode[] = ["safe", "review", "cowboy"];
const lowest = (a: AppShipMode, b: AppShipMode) => (SHIP_MODES.indexOf(a) <= SHIP_MODES.indexOf(b) ? a : b);

/** The highest ship mode a person with `role` may pick under these policies. */
export function maxShipMode(policy: AppPolicySummary, role?: string): AppShipMode {
  const byRole = role ? policy.roles[role] : undefined;
  return byRole ? lowest(policy.maxShipMode, byRole) : policy.maxShipMode;
}

/** The layer every App starts from: one Claude Code agent, `general`; no caps beyond `cowboy`; merge gate on. */
export const BUILTIN_LAYER: ResolvedLayer = {
  kind: "builtin",
  tree: {
    agents: { [DEFAULT_AGENT]: { frontmatter: { agentType: "CUSTOM", harness: { type: "claude-code" } }, instructions: "", skills: {} } },
    skills: {},
    policies: {},
    files: {},
  },
};

type Merged = { frontmatter: AgentFrontmatter; instructions: string; skills: Record<string, SkillText>; skillFiles: DefinitionTree; from: LayerKind };

/**
 * Merge an agent's frontmatter over the same agent in an earlier layer: a key the later layer sets
 * (`null` included) wins. Setting `harness` drops an earlier `model`, as in factory inheritance.
 */
function mergeFrontmatter(base: AgentFrontmatter, next: AgentFrontmatter, raw: Record<string, unknown>): AgentFrontmatter {
  const out: Record<string, unknown> = { ...base };
  if ("harness" in raw) delete out.model;
  for (const key of Object.keys(raw)) out[key] = (next as Record<string, unknown>)[key];
  return out as AgentFrontmatter;
}

/** Merge layers in order (built-in, team, Kiln Project, App). See docs/specs/app-definitions.md for the rules. */
export function resolveLayers(layers: ResolvedLayer[]): ResolvedAppDefinition {
  let name: string | undefined;
  let description: string | undefined;
  let monthlyUsd: number | undefined;
  const agents: Record<string, Merged> = {};
  const skills: ResolvedAppDefinition["skills"] = {};
  const skillFiles: DefinitionTree = {};
  const mandatory: string[] = [];
  const policyFiles: DefinitionTree = {};
  const policy: AppPolicySummary = { maxShipMode: "cowboy", roles: {}, mergeGate: true };

  for (const { kind, tree } of layers) {
    for (const [agent, a] of Object.entries(tree.agents)) {
      const file = `agents/${agent}/agent.md`;
      const raw = tree.files[file] === undefined ? a.frontmatter : rawFrontmatter(tree.files[file]!);
      const prev = agents[agent];
      const own = Object.fromEntries(Object.entries(a.skills).map(([s, sk]) => [s, { description: sk.frontmatter.description, body: sk.body }]));
      const files = Object.fromEntries(Object.entries(tree.files).filter(([p]) => p.startsWith(`agents/${agent}/skills/`)));
      agents[agent] = {
        frontmatter: prev ? mergeFrontmatter(prev.frontmatter, a.frontmatter, raw) : a.frontmatter,
        instructions: a.instructions || prev?.instructions || "",
        skills: { ...prev?.skills, ...own },
        skillFiles: { ...prev?.skillFiles, ...files },
        from: kind,
      };
    }
    const m = tree.manifest;
    if (m?.name !== undefined) name = m.name;
    if (m?.description !== undefined) description = m.description;
    const cap = m?.budgets?.monthlyUsd;
    if (cap !== undefined) monthlyUsd = monthlyUsd === undefined ? cap : Math.min(monthlyUsd, cap);
    for (const s of m?.skills?.mandatory ?? []) if (!mandatory.includes(s)) mandatory.push(s);
    for (const [skill, s] of Object.entries(tree.skills)) {
      skills[skill] = { description: s.frontmatter.description, body: s.body, from: kind };
      for (const [p, c] of Object.entries(tree.files)) if (p.startsWith(`skills/${skill}/`)) skillFiles[p] = c;
    }
    for (const [file, p] of Object.entries(tree.policies)) {
      policyFiles[`policies/${kind === "app" ? "" : `${kind}-`}${file}.yaml`] = p.content;
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
  const names = Object.keys(agents).sort();
  const resolvedAgents: Record<string, ResolvedAppAgent> = {};
  for (const agent of names) {
    const a = agents[agent]!;
    resolvedAgents[agent] = {
      // In an App any agent may spawn another unless spawnableBy narrows it.
      ...resolveAgent(
        agent,
        { frontmatter: a.frontmatter, instructions: a.instructions, skills: a.skills },
        { exec: applyLayer({}, a.frontmatter), sharedSkills: Object.keys(skills), spawnableBy: names.filter((n) => n !== agent) },
      ),
      from: a.from,
      ownSkills: a.skills,
    };
  }

  const files = exportFiles({ name, description, mandatorySkills, monthlyUsd, agents, skillFiles, policyFiles });
  return {
    sha: treeSha(files),
    layers: layers.map((l) => ({ kind: l.kind, ...(l.id ? { id: l.id } : {}), ...(l.sha ? { sha: l.sha } : {}) })),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    agents: resolvedAgents,
    skills,
    mandatorySkills,
    policy,
    ...(monthlyUsd !== undefined ? { monthlyUsd } : {}),
    warnings,
    files,
  };
}

function rawFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? ((parseYaml(m[1]!) ?? {}) as Record<string, unknown>) : {};
}

export function markdown(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body ? `${body}\n` : ""}`;
}

/**
 * The resolved definition as one `kiln/v1` App tree, for Git. Skills keep their files as written;
 * team and project policies are prefixed with their layer (`policies/team-guard.yaml`).
 */
function exportFiles(r: {
  name?: string;
  description?: string;
  mandatorySkills: string[];
  monthlyUsd?: number;
  agents: Record<string, Merged>;
  skillFiles: DefinitionTree;
  policyFiles: DefinitionTree;
}): DefinitionTree {
  const manifest: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION };
  if (r.name !== undefined) manifest.name = r.name;
  if (r.description !== undefined) manifest.description = r.description;
  if (r.mandatorySkills.length) manifest.skills = { mandatory: r.mandatorySkills };
  if (r.monthlyUsd !== undefined) manifest.budgets = { monthlyUsd: r.monthlyUsd };
  const tree: DefinitionTree = { "app.yaml": stringify(manifest), ...r.skillFiles, ...r.policyFiles };
  for (const [agent, a] of Object.entries(r.agents)) {
    const { agentType: _type, ...fm } = a.frontmatter;
    const written: Record<string, unknown> = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined && v !== null));
    // One file sets one of harness and model: a layered model belongs to the harness.
    if (written.harness && typeof written.model === "string") {
      written.harness = { ...(written.harness as object), model: written.model };
      delete written.model;
    }
    tree[`agents/${agent}/agent.md`] = markdown(written, a.instructions);
    Object.assign(tree, a.skillFiles);
  }
  return tree;
}
