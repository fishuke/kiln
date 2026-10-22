# Studio: App definitions

Decision: [ADR-012](../adr/0012-studio.md) ("An App's definition uses the factory definition format") · Contract: [Studio spec](studio.md) · Layout: [ADR-003](../adr/0003-definitions-as-code.md).

An App is a sibling of a factory. Its definition reuses the `kiln/v1` building blocks that apply to one chat-driven agent: the lead agent and its model, skills (some mandatory), MCP servers, policies and budgets. Pipelines, gates, automations, runners, routers, scorers, benchmarks, webhooks, decisions and memories don't apply to Apps and are rejected in an App tree.

## Layout (one layer)

```text
app.yaml                          # schemaVersion, name, description, mandatory skills, budgets
agents/<lead>/agent.md            # at most one agent: the lead (AgentFrontmatter + instructions)
skills/<skill>/SKILL.md           # SkillFrontmatter + body
policies/<name>.yaml              # AppPolicy: ship mode caps and the merge gate
```

```yaml
# app.yaml
schemaVersion: kiln/v1
name: Pricing site # optional
description: Marketing site # optional
skills:
  mandatory: [house-style] # always in every chat's instructions
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

## Schema (`packages/schema/src/app.ts`, exported from `@kiln/schema`)

```ts
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
    budgets: Factory.shape.budgets.unwrap().pick({ monthlyUsd: true }).optional(),
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

The lead agent uses `AgentFrontmatter` and skills use `SkillFrontmatter` unchanged. `fileKinds` gains `app` and `app-policy`, so the definition reference and `kiln schema app` cover them. `packages/definitions/src/validate*` is not changed: App trees are checked by `validateAppTree` in `packages/studio` with the same schemas and `lineAt` / `splitFrontmatter` / `treeSha` from `@kiln/definitions`.

Checks per layer (errors are `file:line: message`):

- At most one agent in `agents/`.
- The lead sets at most one of `harness` and `model` (as in factories).
- `skills.mandatory` names skills that exist in this layer or a layer it inherits from.
- Lead keys that don't apply to an App (`agentType`, `spawnableBy`, `runner`, `workerHost`, `environmentId`, `idleTimeoutMinutes`, `required_repos`, `credentialStrategy`) are warnings: they are ignored.

## Layers and resolution

Built-in → team → Kiln Project (when the App has `projectId`) → App. Each layer is a tree like the one above, all optional. A new App has no layer of its own and resolves entirely from its team and project, so nothing has to be configured to start.

| Part                  | Rule                                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead agent            | Frontmatter keys layer like factory inheritance: a later layer overrides, `null` clears, `harness` replaces the harness and model, `model` keeps the harness. The instructions of the last layer that has any win. The name is the last layer's agent name (built-in: `builder`). |
| Skills                | By name; a later layer's skill replaces an earlier one with the same name.                                                                                                                                                                                                        |
| Mandatory skills      | The union over all layers: a team's mandatory skill can't be dropped by an App. A name with no skill is dropped with a warning.                                                                                                                                                   |
| Policies              | Every policy file of every layer applies. Ship mode caps take the lowest; `mergeGate` is on only if no policy turns it off.                                                                                                                                                       |
| Budgets               | The lowest `monthlyUsd` of all layers.                                                                                                                                                                                                                                            |
| `name`, `description` | Last layer that sets it.                                                                                                                                                                                                                                                          |

Built-in layer: lead `builder` with `harness: { type: claude-code }`, no instructions, ship mode cap `cowboy`, merge gate on.

## Storage and versions

Definitions are stored by content hash (`treeSha`), never as runtime state of their own.

```ts
// Store collections
studio_app_definitions      { id: sha; tree: DefinitionTree; createdBy; createdAt }      // immutable, content-addressed
studio_app_definition_refs  { id: "team:<id>" | "project:<id>" | "app:<id>"; scope; sha; history: { sha; by; at; message? }[] } // newest last
```

Every change validates the new layer (against its inherited layers), stores the tree under its sha and points the ref at it. Saving a tree whose sha is the current one changes nothing. `use(scope, sha)` points the ref back at an earlier sha and records it in the history.

## Service (`packages/studio/src/app-definitions/*`)

```ts
export type DefinitionScope = { kind: "team"; id: string } | { kind: "project"; id: string } | { kind: "app"; id: string };
export type AppRef = { id: string; team: string; projectId?: string }; // an App satisfies it

export class AppDefinitions {
  constructor(opts: { store: Store; clock: { now(): Date } });
  layer(scope): { sha?: string; tree: DefinitionTree; history: DefinitionVersion[] };
  save(scope, tree, by, message?): { sha: string; changed: boolean }; // AppDefinitionError on invalid trees
  edit(scope, patch: AppSettingsPatch, by): { sha: string; changed: boolean }; // structured edit used by the UI
  use(scope, sha, by): { sha: string; changed: boolean };
  resolve(app: AppRef): ResolvedAppDefinition;
  settings(app: AppRef): AppSettings; // resolved values + the App layer's own values, for the UI
  chatConfig(app: AppRef, opts?: { harness?: HarnessType; model?: string }): ChatAgentConfig;
  export(app: AppRef, opts?: { resolved?: boolean }): DefinitionTree; // kiln/v1 layout for Git
}
export class AppDefinitionError extends Error {
  readonly errors: DefinitionError[];
}
```

### For the chat runner

`chatConfig` is what `packages/studio`'s turn runner calls before `harness.start`:

```ts
export type ChatAgentConfig = {
  definitionSha: string; // sha of the resolved tree; record it on the turn
  lead: string; // the lead agent's name
  harness: HarnessType; // opts.harness ?? definition ?? "claude-code"
  model?: string; // opts.model ?? definition
  reasoningLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  instructions: string; // the lead's instructions, then each mandatory skill's body under "## <skill>"
  skills: { name: string; description: string; body: string }[]; // the other skills: StartOptions.skills
  mandatorySkills: string[];
  mcpServers: string[]; // names/ids for the team MCP registry (McpRegistry.refsFor + resolve)
  secrets: string[];
  maxShipMode: ShipMode; // without a role
  mergeGate: boolean;
  monthlyUsd?: number;
};
```

The runner appends `instructions` to Studio's mode instructions, passes `skills` as `StartOptions.skills`, and turns `mcpServers` into harness MCP configs through a `StudioOptions` hook the API provides (the API owns the MCP registry and secrets). `maxShipMode(policy, role?)` clamps a requested ship mode.

## API (`apps/api/src/routes/studio-definitions.ts`, a `MODULES` entry)

Scopes: `apps/{id}` (the caller's team's App, from `studio_apps`), `projects/{id}` (a Kiln Project of the caller's team; team admins), `team` (the current team; team admins). Reading any scope needs team membership.

| Method and path                                  | Body                                     | Response                                           |
| ------------------------------------------------ | ---------------------------------------- | -------------------------------------------------- |
| `GET /api/v1/studio/{scope}/definition`          |                                          | `{ sha?, tree, history }` (this layer)             |
| `PUT /api/v1/studio/{scope}/definition`          | `{ tree, message? }`                     | `{ sha, changed }`; 400 with `errors` when invalid |
| `PATCH /api/v1/studio/{scope}/definition`        | `AppSettingsPatch`                       | `{ sha, changed }`                                 |
| `POST /api/v1/studio/{scope}/definition/use`     | `{ sha }`                                | `{ sha, changed }`                                 |
| `GET /api/v1/studio/apps/{id}/settings`          |                                          | `AppSettings`                                      |
| `GET /api/v1/studio/apps/{id}/definition/export` | `?resolved=false` for the App layer only | `{ sha, tree }`                                    |

`appDefinitionsFor(kiln)` from the route module returns the per-`Kiln` `AppDefinitions`, so `routes/studio.ts` can hand the same instance to `Studio`.

```ts
export type AppSettingsPatch = {
  name?: string | null; description?: string | null;
  lead?: { harness?: HarnessType | null; model?: string | null; instructions?: string; mcpServers?: string[] | null };
  skills?: { upsert?: { name: string; description: string; body: string }[]; remove?: string[]; mandatory?: string[] };
  policy?: { maxShipMode?: ShipMode | null; mergeGate?: boolean | null };   // written to policies/studio.yaml
  budgets?: { monthlyUsd?: number | null };
};
export type AppSettings = {
  resolved: { name?; description?; lead: { name; harness; model?; instructions; mcpServers }; skills: { name; description; mandatory; from: LayerKind }[]; maxShipMode; mergeGate; monthlyUsd? };
  own: AppSettingsPatch-shaped values set in the App layer;
  sha: string; ownSha?: string; history: DefinitionVersion[];
};
```

## SDK (`packages/sdk-ts`)

```ts
studioDefinition(scope: StudioDefinitionScope): Promise<{ sha?: string; tree: Record<string, string>; history: DefinitionVersion[] }>;
studioPutDefinition(scope, tree, message?): Promise<{ sha: string; changed: boolean }>;
studioEditDefinition(scope, patch: AppSettingsPatch): Promise<{ sha: string; changed: boolean }>;
studioUseDefinition(scope, sha): Promise<{ sha: string; changed: boolean }>;
studioAppSettings(appId): Promise<AppSettings>;
studioExportApp(appId, opts?: { resolved?: boolean }): Promise<{ sha: string; tree: Record<string, string> }>;
// StudioDefinitionScope = { app: string } | { project: string } | "team"
```

## MCP

`get_app_settings { app }` and `update_app_settings { app, patch }` call the SDK.

## Web (`apps/web/src/components/studio-settings/`)

`<AppSettingsView appId settings />`: sections Agent (harness, model, instructions, MCP servers), Skills (list, add, edit, remove, mandatory switch; inherited skills shown read-only with their layer), Policy (highest ship mode, merge gate), Budget (monthly), and Definition (current sha, history with "Use this version", export link). `actions.ts` exports `saveAppSettings(appId, patch)` and `useAppDefinition(appId, sha)`. The `/studio` pages mount it, e.g. at `/studio/[app]/settings`; this work doesn't edit `/studio` routes.

## Acceptance

1. `AppManifest` and `AppPolicy` accept the examples above and reject unknown keys; fixtures in `packages/schema/fixtures`.
2. An App with no layer of its own resolves from team and project defaults; a later layer overrides; mandatory skills are a union; ship mode caps take the lowest.
3. Every change makes a new sha; an unchanged tree doesn't; `use` goes back to an earlier sha.
4. Invalid trees (pipelines, two agents, unknown mandatory skill, both harness and model) are rejected with `file:line: message` and the ref doesn't move.
5. `chatConfig` returns the lead's harness and model, instructions with mandatory skills, the other skills and MCP servers.
6. Export writes a tree that `validateAppTree` accepts.
7. API routes act on the caller's team only; another team's App answers 404.
