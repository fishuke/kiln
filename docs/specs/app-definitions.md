# Studio: App definitions

Decision: [ADR-012](../adr/0012-studio.md) ("An App's definition uses the factory definition format") · Contract: [Studio spec](studio.md) · Layout: [ADR-003](../adr/0003-definitions-as-code.md).

An App is a sibling of a factory. Its definition reuses the `kiln/v1` building blocks that apply to chat-driven work: agents in the factory agent format, skills (some mandatory), MCP servers, policies and budgets. Pipelines, gates, automations, runners, routers, scorers, benchmarks, webhooks, decisions and memories don't apply to Apps and are rejected in an App tree.

## Layout (one layer)

```text
app.yaml                                   # schemaVersion, name, description, mandatory skills, budgets
agents/<name>/agent.md                     # factory agent format (AgentFrontmatter + instructions)
agents/<name>/skills/<skill>/SKILL.md      # that agent's own skills
skills/<skill>/SKILL.md                    # shared skills
policies/<name>.yaml                       # AppPolicy: ship mode caps and the merge gate
```

```yaml
# app.yaml
schemaVersion: kiln/v1
name: Pricing site # optional
description: Marketing site # optional
skills:
  mandatory: [house-style] # always in every agent's instructions
budgets:
  monthlyUsd: 200 # the factory budgets key that applies to an App
```

```yaml
# policies/studio.yaml
shipMode:
  max: review # highest ship mode anyone may pick: safe < review < cowboy
  roles: { customer: safe } # per-role caps (roles are planned separately)
mergeGate: true # Ready for review goes through the App's merge gate (ADR-014)
```

`README.md` is ignored. Any other file is an error: `pipelines/feature.yaml: pipelines don't apply to Apps`, or `x.txt is not a known App definition file`.

## Schema

`@kiln/schema` gains two file kinds (`fileKinds.app`, `fileKinds["app-policy"]`), so the definition reference and `kiln schema app` cover them:

```ts
export const Budgets = z.object({ perWorkItemUsd, monthlyUsd }).strict(); // factory.yaml budgets, now named
export const AppShipMode = z.enum(["safe", "review", "cowboy"]); // same values as @kiln/studio ShipMode
export const AppManifest = z
  .object({
    schemaVersion: z.literal("kiln/v1"),
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    skills: z
      .object({ mandatory: z.array(z.string().min(1)).optional() })
      .strict()
      .optional(),
    budgets: Budgets.pick({ monthlyUsd: true }).strict().optional(),
  })
  .strict();
export const AppPolicy = Policy.pick({ description: true })
  .extend({
    shipMode: z
      .object({ max: AppShipMode.optional(), roles: z.record(z.string().min(1), AppShipMode).optional() })
      .strict()
      .optional(),
    mergeGate: z.boolean().optional(),
  })
  .strict();
```

Agents and skills are parsed by `parseTree` from `@kiln/definitions` with the factory schemas, unchanged. `packages/definitions/src/validate*` is not changed: App trees are checked by `validateAppTree` in `packages/studio`. `packages/definitions/src/resolve.ts` exports `resolveAgent(name, agent, { exec, sharedSkills, spawnableBy?, … })`, the per-agent half of the factory `resolve`, which Apps call too.

Checks per layer (errors are `file:line: message`):

- An agent sets at most one of `harness` and `model`, and names no `router:` model.
- `spawnableBy` names agents of this layer or a layer it inherits from (the built-in layer has `general`).
- `skills.mandatory` names shared skills of this layer or a layer it inherits from.
- Agent keys that only mean something in a factory (`agentType`, `runner`, `workerHost`, `environmentId`, `required_repos`, `credentialStrategy`) are warnings: they are ignored.

## Layers and resolution

Built-in → team → Kiln Project (when the App has `projectId`) → App. Each layer is a tree like the one above, all optional. A new App has no layer of its own and resolves from its team and project, so nothing has to be configured to start.

| Part                  | Rule                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agents                | By name. A later layer's frontmatter keys override (`null` included); setting `harness` drops an earlier `model`; then the factory rules apply (`applyLayer`, `resolveAgent`). The instructions of the last layer that has any win. An agent's own skills merge by name. |
| Default agent         | The built-in layer defines `general` (Claude Code, no instructions). A chat that names no agent runs it.                                                                                                                                                                 |
| `spawnableBy`         | Unset: every other agent of the App may spawn it.                                                                                                                                                                                                                        |
| Shared skills         | By name; a later layer's skill replaces an earlier one. Every agent gets every shared skill plus its own, as in factories.                                                                                                                                               |
| Mandatory skills      | The union over all layers: a team's mandatory skill can't be dropped by an App. A name with no skill is dropped with a warning.                                                                                                                                          |
| Policies              | Every policy file of every layer applies. Ship mode caps take the lowest; `mergeGate` is on unless a policy turns it off.                                                                                                                                                |
| Budgets               | The lowest `monthlyUsd` of all layers.                                                                                                                                                                                                                                   |
| `name`, `description` | Last layer that sets it.                                                                                                                                                                                                                                                 |

## Storage and versions

Definitions are stored by content hash (`treeSha`); the ref is runtime state that points at one.

```ts
// Store collections
studio_app_definitions      { id: sha; tree: DefinitionTree; createdBy; createdAt }      // immutable, content-addressed
studio_app_definition_refs  { id: "team:<id>" | "project:<id>" | "app:<id>"; kind; sha; history: { sha; by; at; message? }[] } // oldest first
```

Every change validates the new layer against its inherited layers, stores the tree under its sha and points the ref at it. Saving the current tree again changes nothing. `use(target, sha)` points the ref at an earlier sha from its history and records that.

## Service (`packages/studio/src/app-definitions/*`, exported from `@kiln/studio`)

```ts
/** The layer to act on: `{ team }`, `{ team, projectId }`, or an App's own (`appId` set). */
export type DefinitionTarget = { team: string; projectId?: string; appId?: string };
export function targetOf(app: App): DefinitionTarget;

export class AppDefinitions {
  constructor(opts: { store: Store; clock: { now(): Date } });
  layer(target): { kind; sha?: string; tree: DefinitionTree; history: DefinitionVersion[] };
  save(target, tree, by, message?): { sha: string; changed: boolean }; // AppDefinitionError on an invalid tree
  edit(target, patch: AppSettingsPatch, by): { sha: string; changed: boolean };
  use(target, sha, by): { sha: string; changed: boolean }; // StudioError("not_found") for a sha not in the history
  resolve(target): ResolvedAppDefinition; // agents: Record<string, ResolvedAgent & { from; ownSkills }>
  settings(target): AppSettings;
  chatConfig(target, opts?: { agent?: string; harness?: HarnessType; model?: string }): ChatAgentConfig;
  export(target, opts?: { resolved?: boolean }): DefinitionTree; // kiln/v1 layout for Git
}
export class AppDefinitionError extends Error {
  readonly errors: DefinitionError[];
}
```

### For the chat runner and subagent runs

```ts
export type ChatAgentConfig = {
  definitionSha: string; // sha of the resolved tree; record it on the turn
  agent: string; // opts.agent ?? "general"
  description?: string;
  harness: HarnessType; // opts.harness ?? the agent's
  model?: string; // opts.model ?? the agent's (dropped when opts.harness switches harness)
  reasoningLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  instructions: string; // the agent's instructions, then each mandatory skill's body under "## <skill>"
  skills: { name: string; description: string; body: string }[]; // its other skills: StartOptions.skills
  mandatorySkills: string[];
  mcpServers: string[]; // names/ids for the team MCP registry (McpRegistry.refsFor + resolve)
  secrets: string[];
  spawnableBy: string[];
  maxShipMode: ShipMode; // without a role; maxShipMode(policy, role) for a role
  mergeGate: boolean;
  monthlyUsd?: number;
};
```

`chatConfig` throws `StudioError("invalid", "unknown agent <name>; this App has …")` for an agent the App doesn't define. The turn runner calls it before `harness.start` for the chat's agent, and again for each agent it spawns as a subagent run. It appends `instructions` to Studio's mode instructions, passes `skills` as `StartOptions.skills`, and turns `mcpServers` into harness MCP configs through a `StudioOptions` hook the API provides (the API owns the MCP registry and secrets).

Not in the factory agent format, so not here: a per-agent tool allowlist (`StartOptions` has no tools either).

## API (`apps/api/src/routes/studio-definitions.ts`, a `MODULES` entry)

Scopes: `apps/{id}` (an App of the caller's team, from `studio_apps`), `projects/{id}` (a Kiln Project of the caller's team), `team` (the current team). Reading needs team membership; changing team or project defaults needs a team admin; changing an App's layer needs a signed-in member of its team. Another team's App or project answers 404.

| Method and path                                  | Body                                     | Response                                                 |
| ------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| `GET /api/v1/studio/{scope}/definition`          |                                          | `{ sha?, tree, history }` (this layer)                   |
| `PUT /api/v1/studio/{scope}/definition`          | `{ tree, message? }`                     | `{ sha, changed }`; 400 `{ error, errors }` when invalid |
| `PATCH /api/v1/studio/{scope}/definition`        | `AppSettingsPatch`                       | `{ sha, changed }`                                       |
| `POST /api/v1/studio/{scope}/definition/use`     | `{ sha }`                                | `{ sha, changed }`; 404 for an unknown sha               |
| `GET /api/v1/studio/{scope}/settings`            |                                          | `AppSettings`                                            |
| `GET /api/v1/studio/apps/{id}/definition/export` | `?resolved=false` for the App layer only | `{ sha, tree }`                                          |

`appDefinitionsFor(kiln)` from the route module returns the per-`Kiln` `AppDefinitions`, so `routes/studio.ts` hands the same instance to `Studio`.

```ts
export type AppSettingsPatch = {
  name?: string | null;
  description?: string | null;
  agents?: Record<string, { description?; harness?; model?; instructions?; mcpServers?; spawnableBy? } | null>; // null removes the layer's agent
  skills?: { upsert?: { name; description; body }[]; remove?: string[]; mandatory?: string[] };
  policy?: { maxShipMode?: ShipMode | null; mergeGate?: boolean | null }; // written to policies/studio.yaml
  budgets?: { monthlyUsd?: number | null };
};
export type AppSettings = {
  sha: string; // resolved
  layer: { kind; sha?; history }; // this layer
  resolved: {
    name?;
    description?;
    agents: { name; description?; harness; model?; instructions; mcpServers; skills; spawnableBy; from }[];
    skills: { name; description; body; mandatory; from }[];
    maxShipMode;
    mergeGate;
    monthlyUsd?;
  };
  own: {
    name?;
    description?;
    agents: Record<string, { description?; harness?; model?; instructions?; mcpServers?; spawnableBy? }>;
    skills: string[];
    mandatory: string[];
    maxShipMode?;
    mergeGate?;
    monthlyUsd?;
  };
  warnings: string[];
};
```

## SDK (`packages/sdk-ts`)

Types are re-declared in `packages/sdk-ts/src/studio-definitions.ts` (`StudioAppSettings`, `StudioSettingsPatch`, …); a type test keeps them equal to `@kiln/studio`'s.

```ts
// StudioDefinitionScope = { app: string } | { project: string } | "team"
studioDefinition(scope): Promise<StudioDefinitionLayer>;
studioPutDefinition(scope, tree, message?): Promise<{ sha: string; changed: boolean }>;
studioEditDefinition(scope, patch): Promise<{ sha: string; changed: boolean }>;
studioUseDefinition(scope, sha): Promise<{ sha: string; changed: boolean }>;
studioSettings(scope): Promise<StudioAppSettings>;
studioExportApp(appId, opts?: { resolved?: boolean }): Promise<{ sha?: string; tree: Record<string, string> }>;
```

## MCP

`get_app_settings { app }` and `update_app_settings { app, patch }`.

## Web (`apps/web/src/components/studio-settings/`)

`<AppSettingsView scope settings />` with sections General (name, description), Agents (one card per agent: harness, model, instructions, MCP servers; add and remove), Skills (shared skills; mandatory switch; inherited ones read-only with their layer), Policy (highest ship mode, merge gate), Budget (monthly) and Versions (current sha, history with **Use**, export). Its server actions are in `actions.ts` in the same folder. The `/studio` pages mount it (for example at `/studio/[app]/settings`); this work doesn't edit `/studio` routes.

## Acceptance

1. `AppManifest` and `AppPolicy` accept the examples above and reject unknown keys; fixtures in `packages/schema/fixtures`.
2. A new App resolves to one `general` agent; team and project defaults apply; a later layer overrides; mandatory skills are a union; ship mode caps take the lowest.
3. Every change makes a new sha; an unchanged tree doesn't; `use` goes back to an earlier sha.
4. Invalid trees (pipelines, both harness and model, unknown mandatory skill or `spawnableBy` agent) are rejected with `file:line: message` and the ref doesn't move.
5. `chatConfig` returns an agent's harness and model, its instructions with the mandatory skills, its other skills and its MCP servers.
6. Export writes a tree that `validateAppTree` accepts.
7. API routes act on the caller's team only; another team's App answers 404; only admins change team defaults.
