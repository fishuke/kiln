import { treeSha, type DefinitionError, type DefinitionTree } from "@kiln/definitions";
import type { HarnessType } from "@kiln/schema";
import type { Store } from "@kiln/store";
import { StudioError, type ShipMode } from "../types";
import {
  BUILTIN_LAYER,
  changedPolicyKeys,
  DEFAULT_AGENT,
  layerPolicy,
  maxShipMode,
  type AppPolicySummary,
  type PolicyChange,
  type PolicyKey,
  resolveLayers,
  type LayerKind,
  type ResolvedAppDefinition,
  type ResolvedLayer,
} from "./resolve";
import { applySettingsPatch, settingsView, type AppSettings, type AppSettingsPatch, type DefinitionVersion } from "./settings";
import { formatErrors, validateAppTree } from "./tree";

/**
 * Which definition layer to act on: the team's defaults (`{ team }`), a Kiln Project's
 * (`{ team, projectId }`) or an App's own (`appId` set). Resolution reads every layer above it.
 */
export type DefinitionTarget = { team: string; projectId?: string; appId?: string };

/** An App as `@kiln/studio` stores it. */
export function targetOf(app: { id: string; team: string; projectId?: string }): DefinitionTarget {
  return { team: app.team, ...(app.projectId ? { projectId: app.projectId } : {}), appId: app.id };
}

export const DEFINITION_COLLECTIONS = { definitions: "studio_app_definitions", refs: "studio_app_definition_refs" } as const;

type StoredDefinition = { id: string; tree: DefinitionTree; createdBy: string; createdAt: string };
type DefinitionRef = {
  id: string;
  kind: Exclude<LayerKind, "builtin">;
  sha: string;
  history: DefinitionVersion[];
  /** Who last changed each policy setting of this layer, and when. */
  policyChanges?: Partial<Record<PolicyKey, PolicyChange>>;
};

export class AppDefinitionError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(formatErrors(errors));
    this.name = "AppDefinitionError";
  }
}

/** What the Studio chat runner needs to start one of the App's agents (the chat's lead, or a subagent run). */
export type ChatAgentConfig = {
  /** Sha of the resolved definition; record it on the turn. */
  definitionSha: string;
  /** The agent's name: `general` unless the chat names another. */
  agent: string;
  description?: string;
  harness: HarnessType;
  model?: string;
  reasoningLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  /** The agent's instructions, then each mandatory skill's body under "## <skill>". */
  instructions: string;
  /** The agent's other skills (shared and its own), for the harness's skills folder (`StartOptions.skills`). */
  skills: { name: string; description: string; body: string }[];
  mandatorySkills: string[];
  /** MCP server names or ids, for the team's MCP registry. */
  mcpServers: string[];
  secrets: string[];
  /** Agents that may spawn this one. */
  spawnableBy: string[];
  /** The highest ship mode, without a role. */
  maxShipMode: ShipMode;
  mergeGate: boolean;
  monthlyUsd?: number;
};

/**
 * Studio App definitions (ADR-012): `kiln/v1` trees stored by content hash in the Store, one
 * layer each for a team, a Kiln Project and an App, resolved in that order. Every change makes a
 * new sha and the layer's ref points at one.
 */
export class AppDefinitions {
  constructor(private readonly opts: { store: Store; clock: { now(): Date } }) {}

  /** A layer's own tree, its sha and history (oldest first). An unset layer has an empty tree. */
  layer(target: DefinitionTarget): { kind: Exclude<LayerKind, "builtin">; sha?: string; tree: DefinitionTree; history: DefinitionVersion[] } {
    const { id, kind } = refId(target);
    const ref = this.opts.store.get<DefinitionRef>(DEFINITION_COLLECTIONS.refs, id);
    return ref ? { kind, sha: ref.sha, tree: this.tree(ref.sha), history: ref.history } : { kind, tree: {}, history: [] };
  }

  /** Validate a layer's tree against the layers it inherits from, store it, and point the layer at it. */
  save(target: DefinitionTarget, tree: DefinitionTree, by: string, message?: string): { sha: string; changed: boolean } {
    const inherited = resolveLayers(this.layers(target).slice(0, -1));
    const result = validateAppTree(tree, { inheritedSkills: Object.keys(inherited.skills), inheritedAgents: Object.keys(inherited.agents) });
    if (result.errors.length) throw new AppDefinitionError(result.errors);
    const sha = treeSha(tree);
    const { id, kind } = refId(target);
    const ref = this.opts.store.get<DefinitionRef>(DEFINITION_COLLECTIONS.refs, id);
    if (ref?.sha === sha) return { sha, changed: false };
    const at = this.opts.clock.now().toISOString();
    const before = layerPolicy(ref ? validateAppTree(this.tree(ref.sha)).policies : {});
    const policyChanges = { ...ref?.policyChanges };
    for (const key of changedPolicyKeys(before, layerPolicy(result.policies))) policyChanges[key] = { by, at };
    this.opts.store.transaction((s) => {
      if (!s.get(DEFINITION_COLLECTIONS.definitions, sha))
        s.put<StoredDefinition>(DEFINITION_COLLECTIONS.definitions, { id: sha, tree, createdBy: by, createdAt: at });
      s.put<DefinitionRef>(DEFINITION_COLLECTIONS.refs, {
        id,
        kind,
        sha,
        history: [...(ref?.history ?? []), { sha, by, at, ...(message ? { message } : {}) }],
        ...(Object.keys(policyChanges).length ? { policyChanges } : {}),
      });
    });
    return { sha, changed: true };
  }

  /** Apply a settings patch to the layer and save the result. */
  edit(target: DefinitionTarget, patch: AppSettingsPatch, by: string, message?: string): { sha: string; changed: boolean } {
    return this.save(target, applySettingsPatch(this.layer(target).tree, this.layers(target).at(-1)!.tree, patch), by, message);
  }

  /**
   * The policy settings a change would touch in the layer: a new tree, a settings patch, or an
   * earlier sha. Policies are for people to change (ADR-014), so callers check who asks.
   */
  policyChanges(target: DefinitionTarget, change: { tree: DefinitionTree } | { patch: AppSettingsPatch } | { sha: string }): PolicyKey[] {
    const current = this.layer(target).tree;
    const next = "tree" in change ? change.tree : "sha" in change ? this.tree(change.sha) : applySettingsPatch(current, validateAppTree(current), change.patch);
    return changedPolicyKeys(layerPolicy(validateAppTree(current).policies), layerPolicy(validateAppTree(next).policies));
  }

  /** Point the layer at an earlier sha from its history. */
  use(target: DefinitionTarget, sha: string, by: string): { sha: string; changed: boolean } {
    const known = this.layer(target).history.some((h) => h.sha === sha);
    if (!known) throw new StudioError("not_found", `unknown definition ${sha} for this layer`);
    return this.save(target, this.tree(sha), by, `Use ${sha.slice(0, 7)}`);
  }

  resolve(target: DefinitionTarget): ResolvedAppDefinition {
    return resolveLayers(this.layers(target));
  }

  /** The App's ship mode caps, default-branch opt-in and merge gate switch, with who changed each. Ship and the merge gate read these. */
  policy(target: DefinitionTarget): AppPolicySummary {
    return this.resolve(target).policy;
  }

  /** Resolved values and the target layer's own values, for the settings page. */
  settings(target: DefinitionTarget): AppSettings {
    const layers = this.layers(target);
    const own = this.layer(target);
    return settingsView(resolveLayers(layers), layers.at(-1)!.tree, { kind: own.kind, ...(own.sha ? { sha: own.sha } : {}), history: own.history });
  }

  /**
   * One agent's config for a chat or a subagent run: the factory agent resolution, with the App's
   * mandatory skills put into its instructions. `agent` defaults to `general`. A chat's own
   * harness or model overrides the definition's.
   */
  chatConfig(target: DefinitionTarget, opts: { agent?: string; harness?: HarnessType; model?: string } = {}): ChatAgentConfig {
    const r = this.resolve(target);
    const name = opts.agent ?? DEFAULT_AGENT;
    const a = r.agents[name];
    if (!a) throw new StudioError("invalid", `unknown agent ${name}; this App has ${Object.keys(r.agents).join(", ")}`);
    const mandatory = r.mandatorySkills.map((s) => `## ${s}\n\n${r.skills[s]!.body}`);
    const harness = opts.harness ?? a.harness.type;
    // A model belongs to its harness: a chat that switches harness doesn't keep the definition's model.
    const model = opts.model ?? (harness === a.harness.type ? a.harness.model : undefined);
    const text = (skill: string) => a.ownSkills[skill] ?? r.skills[skill]!;
    return {
      definitionSha: r.sha,
      agent: name,
      ...(a.description ? { description: a.description } : {}),
      harness,
      ...(model ? { model } : {}),
      ...(a.harness.reasoningLevel ? { reasoningLevel: a.harness.reasoningLevel } : {}),
      instructions: [a.instructions, ...mandatory].filter(Boolean).join("\n\n"),
      skills: [...new Set(a.skills)]
        .filter((s) => !r.mandatorySkills.includes(s))
        .map((s) => ({ name: s, description: text(s).description, body: text(s).body })),
      mandatorySkills: r.mandatorySkills,
      mcpServers: a.mcpServers,
      secrets: a.secrets,
      spawnableBy: a.spawnableBy,
      maxShipMode: maxShipMode(r.policy),
      mergeGate: r.policy.mergeGate,
      ...(r.monthlyUsd !== undefined ? { monthlyUsd: r.monthlyUsd } : {}),
    };
  }

  /** The definition in `kiln/v1` layout for Git: resolved (default), or the target layer as stored. */
  export(target: DefinitionTarget, opts: { resolved?: boolean } = {}): DefinitionTree {
    return opts.resolved === false ? this.layer(target).tree : this.resolve(target).files;
  }

  private tree(sha: string): DefinitionTree {
    const d = this.opts.store.get<StoredDefinition>(DEFINITION_COLLECTIONS.definitions, sha);
    if (!d) throw new StudioError("not_found", `unknown definition ${sha}`);
    return d.tree;
  }

  /** Built-in, then each stored layer from the team down to the target. The target's own layer is always last. */
  private layers(target: DefinitionTarget): ResolvedLayer[] {
    const chain: DefinitionTarget[] = [{ team: target.team }];
    if (target.projectId) chain.push({ team: target.team, projectId: target.projectId });
    if (target.appId) chain.push(target);
    return [
      BUILTIN_LAYER,
      ...chain.map((t): ResolvedLayer => {
        const { id: refKey, kind } = refId(t);
        const ref = this.opts.store.get<DefinitionRef>(DEFINITION_COLLECTIONS.refs, refKey);
        const id = kind === "team" ? t.team : kind === "project" ? t.projectId! : t.appId!;
        const tree = validateAppTree(ref ? this.tree(ref.sha) : {});
        return { kind, id, ...(ref ? { sha: ref.sha } : {}), tree, ...(ref?.policyChanges ? { policyChanges: ref.policyChanges } : {}) };
      }),
    ];
  }
}

function refId(t: DefinitionTarget): { id: string; kind: Exclude<LayerKind, "builtin"> } {
  if (t.appId) return { id: `app:${t.appId}`, kind: "app" };
  if (t.projectId) return { id: `project:${t.projectId}`, kind: "project" };
  return { id: `team:${t.team}`, kind: "team" };
}
