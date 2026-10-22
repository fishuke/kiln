import { applyLayer, resolveAgent, treeSha, type DefinitionTree, type ResolvedAgent } from "@kiln/definitions";
import { SCHEMA_VERSION, type AgentFrontmatter, type AppShipMode } from "@kiln/schema";
import { parse as parseYaml, stringify } from "yaml";
import type { AppLayerTree } from "./tree";

export type LayerKind = "builtin" | "team" | "project" | "app";
export type ResolvedLayer = { kind: LayerKind; id?: string; sha?: string; tree: AppLayerTree; policyChanges?: Partial<Record<PolicyKey, PolicyChange>> };

export type AppTeamRole = "owner" | "admin" | "member";
export const POLICY_KEYS = ["maxShipMode", "roles", "pushDefaultBranch", "mergeGate"] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];
export type PolicyChange = { by: string; at: string };

/** One layer's policies combined, before inheritance. A switch is undefined when no policy of the layer sets it. */
export type LayerPolicy = { maxShipMode?: AppShipMode; roles: Partial<Record<AppTeamRole, AppShipMode>>; pushDefaultBranch?: boolean; mergeGate?: boolean };

/** Ship mode caps and switches every Studio part reads from the App definition (the only place they live). */
export type AppPolicySummary = {
  /** The highest ship mode anyone may pick: the lowest cap of every policy. */
  maxShipMode: AppShipMode;
  /** The highest ship mode per team role, the lowest cap per role. */
  roles: Partial<Record<AppTeamRole, AppShipMode>>;
  /** Imported App: cowboy pushes its default branch. On only if a policy turns it on and none turns it off. */
  pushDefaultBranch: boolean;
  /** The merge gate (ADR-014). On only if a policy turns it on and none turns it off. */
  mergeGate: boolean;
  /** Who last changed each setting, and when, in any layer. */
  changedBy: Partial<Record<PolicyKey, { by: string; at: string; layer: LayerKind }>>;
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
export function maxShipMode(policy: AppPolicySummary, role?: AppTeamRole): AppShipMode {
  const byRole = role ? policy.roles[role] : undefined;
  return byRole ? lowest(policy.maxShipMode, byRole) : policy.maxShipMode;
}

/** Combine a layer's policy files: caps take the lowest; a switch is off if any file turns it off, else on if any turns it on. */
export function layerPolicy(policies: AppLayerTree["policies"]): LayerPolicy {
  const out: LayerPolicy = { roles: {} };
  const mergeSwitch = (a: boolean | undefined, b: boolean | undefined) => (a === false || b === false ? false : a || b ? true : undefined);
  for (const { policy: p } of Object.values(policies)) {
    if (p.shipMode?.max) out.maxShipMode = out.maxShipMode ? lowest(out.maxShipMode, p.shipMode.max) : p.shipMode.max;
    for (const [role, mode] of Object.entries(p.shipMode?.roles ?? {}) as [AppTeamRole, AppShipMode][])
      out.roles[role] = out.roles[role] ? lowest(out.roles[role]!, mode) : mode;
    const push = mergeSwitch(out.pushDefaultBranch, p.shipMode?.pushDefaultBranch);
    const gate = mergeSwitch(out.mergeGate, p.mergeGate);
    if (push === undefined) delete out.pushDefaultBranch;
    else out.pushDefaultBranch = push;
    if (gate === undefined) delete out.mergeGate;
    else out.mergeGate = gate;
  }
  return out;
}

/** The settings a change from `before` to `after` touched. */
export function changedPolicyKeys(before: LayerPolicy, after: LayerPolicy): PolicyKey[] {
  return POLICY_KEYS.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/** The layer every App starts from: one Claude Code agent, `general`; no caps beyond `cowboy`; merge gate and default-branch pushes off. */
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
  const policy: AppPolicySummary = { maxShipMode: "cowboy", roles: {}, pushDefaultBranch: false, mergeGate: false, changedBy: {} };
  let pushOn = false;
  let pushOff = false;
  let gateOn = false;
  let gateOff = false;

  for (const { kind, tree, policyChanges } of layers) {
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
    for (const file of Object.keys(tree.policies)) policyFiles[`policies/${kind === "app" ? "" : `${kind}-`}${file}.yaml`] = tree.policies[file]!.content;
    const lp = layerPolicy(tree.policies);
    if (lp.maxShipMode) policy.maxShipMode = lowest(policy.maxShipMode, lp.maxShipMode);
    for (const [role, mode] of Object.entries(lp.roles) as [AppTeamRole, AppShipMode][])
      policy.roles[role] = policy.roles[role] ? lowest(policy.roles[role]!, mode) : mode;
    pushOn ||= lp.pushDefaultBranch === true;
    pushOff ||= lp.pushDefaultBranch === false;
    gateOn ||= lp.mergeGate === true;
    gateOff ||= lp.mergeGate === false;
    for (const [key, change] of Object.entries(policyChanges ?? {}) as [PolicyKey, PolicyChange][]) {
      const prev = policy.changedBy[key];
      if (!prev || prev.at <= change.at) policy.changedBy[key] = { ...change, layer: kind };
    }
  }

  policy.pushDefaultBranch = pushOn && !pushOff;
  policy.mergeGate = gateOn && !gateOff;
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
