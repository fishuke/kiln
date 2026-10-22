import { treeSha, type DefinitionError, type DefinitionTree } from "@kiln/definitions";
import type { HarnessType } from "@kiln/schema";
import type { Store } from "@kiln/store";
import type { ShipMode } from "../types";
import { BUILTIN_LAYER, exportResolved, maxShipMode, resolveLayers, type LayerKind, type ResolvedAppDefinition, type ResolvedLayer } from "./resolve";
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
type DefinitionRef = { id: string; kind: Exclude<LayerKind, "builtin">; sha: string; history: DefinitionVersion[] };

export class AppDefinitionError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(formatErrors(errors));
    this.name = "AppDefinitionError";
  }
}

/** What the Studio chat runner needs to start a chat's lead agent. */
export type ChatAgentConfig = {
  /** Sha of the resolved definition; record it on the turn. */
  definitionSha: string;
  lead: string;
  harness: HarnessType;
  model?: string;
  reasoningLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  /** The lead's instructions, then each mandatory skill's body under "## <skill>". */
  instructions: string;
  /** Every other skill, for the harness's skills folder (`StartOptions.skills`). */
  skills: { name: string; description: string; body: string }[];
  mandatorySkills: string[];
  /** MCP server names or ids, for the team's MCP registry. */
  mcpServers: string[];
  secrets: string[];
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
    const result = validateAppTree(tree, { inheritedSkills: Object.keys(inherited.skills) });
    if (result.errors.length) throw new AppDefinitionError(result.errors);
    const sha = treeSha(tree);
    const { id, kind } = refId(target);
    const ref = this.opts.store.get<DefinitionRef>(DEFINITION_COLLECTIONS.refs, id);
    if (ref?.sha === sha) return { sha, changed: false };
    const at = this.opts.clock.now().toISOString();
    this.opts.store.transaction((s) => {
      if (!s.get(DEFINITION_COLLECTIONS.definitions, sha))
        s.put<StoredDefinition>(DEFINITION_COLLECTIONS.definitions, { id: sha, tree, createdBy: by, createdAt: at });
      s.put<DefinitionRef>(DEFINITION_COLLECTIONS.refs, {
        id,
        kind,
        sha,
        history: [...(ref?.history ?? []), { sha, by, at, ...(message ? { message } : {}) }],
      });
    });
    return { sha, changed: true };
  }

  /** Apply a settings patch to the layer and save the result. */
  edit(target: DefinitionTarget, patch: AppSettingsPatch, by: string, message?: string): { sha: string; changed: boolean } {
    const layers = this.layers(target);
    const own = layers.at(-1)!;
    const leadName = resolveLayers(layers.slice(0, -1)).lead.name;
    return this.save(target, applySettingsPatch(this.layer(target).tree, own.tree, patch, leadName), by, message);
  }

  /** Point the layer at an earlier sha from its history. */
  use(target: DefinitionTarget, sha: string, by: string): { sha: string; changed: boolean } {
    const known = this.layer(target).history.some((h) => h.sha === sha);
    if (!known) throw new AppDefinitionError([{ file: "", line: 0, code: "ref", message: `unknown definition ${sha} for this layer` }]);
    return this.save(target, this.tree(sha), by, `Use ${sha.slice(0, 7)}`);
  }

  resolve(target: DefinitionTarget): ResolvedAppDefinition {
    return resolveLayers(this.layers(target));
  }

  /** Resolved values and the target layer's own values, for the settings page. */
  settings(target: DefinitionTarget): AppSettings {
    const layers = this.layers(target);
    const own = this.layer(target);
    return settingsView(resolveLayers(layers), layers.at(-1)!.tree, { kind: own.kind, ...(own.sha ? { sha: own.sha } : {}), history: own.history });
  }

  /** The lead agent's config for a chat. A chat's own harness or model overrides the definition's. */
  chatConfig(target: DefinitionTarget, opts: { harness?: HarnessType; model?: string } = {}): ChatAgentConfig {
    const r = this.resolve(target);
    const mandatory = r.mandatorySkills.map((name) => `## ${name}\n\n${r.skills[name]!.body}`);
    const harness = opts.harness ?? r.lead.harness.type;
    // A model belongs to its harness: a chat that switches harness doesn't keep the definition's model.
    const model = opts.model ?? (harness === r.lead.harness.type ? r.lead.harness.model : undefined);
    return {
      definitionSha: r.sha,
      lead: r.lead.name,
      harness,
      ...(model ? { model } : {}),
      ...(r.lead.harness.reasoningLevel ? { reasoningLevel: r.lead.harness.reasoningLevel } : {}),
      instructions: [r.lead.instructions, ...mandatory].filter(Boolean).join("\n\n"),
      skills: Object.entries(r.skills)
        .filter(([name]) => !r.mandatorySkills.includes(name))
        .map(([name, s]) => ({ name, description: s.description, body: s.body })),
      mandatorySkills: r.mandatorySkills,
      mcpServers: r.lead.mcpServers,
      secrets: r.lead.secrets,
      maxShipMode: maxShipMode(r.policy),
      mergeGate: r.policy.mergeGate,
      ...(r.monthlyUsd !== undefined ? { monthlyUsd: r.monthlyUsd } : {}),
    };
  }

  /** The definition in `kiln/v1` layout for Git: resolved (default), or the target layer as stored. */
  export(target: DefinitionTarget, opts: { resolved?: boolean } = {}): DefinitionTree {
    return opts.resolved === false ? this.layer(target).tree : exportResolved(this.resolve(target));
  }

  private tree(sha: string): DefinitionTree {
    const d = this.opts.store.get<StoredDefinition>(DEFINITION_COLLECTIONS.definitions, sha);
    if (!d) throw new AppDefinitionError([{ file: "", line: 0, code: "ref", message: `unknown definition ${sha}` }]);
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
        const { kind } = refId(t);
        const l = this.layer(t);
        const id = kind === "team" ? t.team : kind === "project" ? t.projectId! : t.appId!;
        return { kind, id, ...(l.sha ? { sha: l.sha } : {}), tree: validateAppTree(l.tree) };
      }),
    ];
  }
}

function refId(t: DefinitionTarget): { id: string; kind: Exclude<LayerKind, "builtin"> } {
  if (t.appId) return { id: `app:${t.appId}`, kind: "app" };
  if (t.projectId) return { id: `project:${t.projectId}`, kind: "project" };
  return { id: `team:${t.team}`, kind: "team" };
}
