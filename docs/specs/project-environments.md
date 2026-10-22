# Project environments: variables and secrets inherited team → project → App or factory

Decision: [ADR-012](../adr/0012-studio.md) (Kiln Project section). Studio contract: [studio.md](studio.md#spec-change-environments).

## Why

A Kiln Project groups factories and Studio Apps for one product. They need the same settings to run, such as the API URL a preview calls, or a test key. Today each run gets only the secrets its agent names, and an imported App can't boot without its repository's variables.

## Model (`packages/engine/src/platform/variables.ts`, store collection `variables`)

A **variable layer** is one owner's values for one named environment:

```ts
type VariableScope = "team" | "project" | "factory" | "app";
type Variable = { key: string; secret: boolean; value: string /* plain text, or sealed when secret */; updatedBy: string; updatedAt: string };
type VariableLayer = {
  id: `${scope}:${owner}:${environment}`;
  scope: VariableScope;
  owner: string;
  team: string;
  environment: string;
  variables: Variable[];
  createdBy;
  createdAt;
  updatedBy;
  updatedAt;
};
```

- `environment` is a name like `preview` or `production` (`^[a-z][a-z0-9-]{0,31}$`).
- Keys use the secret-name rule (`SECRET_NAME`), may not start with `KILN_`, and are unique in a layer. At most 200 per layer; a value is at most 128 KiB.
- Secret values are sealed with `SecretVault.seal` (AES-256-GCM with `KILN_SECRET_KEY`), the same as team and personal secrets. Plain values are stored as they are.
- Views never carry a secret's value: `{ key, secret: true }`, like team secrets. Plain variables show their value: `{ key, secret: false, value }`.
- Writing a layer replaces its variable list. A secret listed without a value keeps its stored value (so the UI can edit other keys without re-entering secrets); a new secret without a value is a 400.
- Every change is audited (`variables.updated`, `variables.deleted`) with the keys, never the values.

## Resolver

```ts
class VariableService {
  resolve(input: { team: string; project?: string; factory?: string; app?: string; environment: string }): ResolvedVariables;
  /** A factory's run environment: undefined when the factory is in no project (no change from today). */
  forFactory(factory: string, environment?: string): ResolvedVariables | undefined;
  /** An App's environment (Studio previews and runs): team → its project (if any) → the App. */
  forApp(app: { id: string; team: string; projectId?: string }, environment?: string): ResolvedVariables;
}
type ResolvedVariables = {
  env: Record<string, string>;
  secretValues: string[];
  sources: Record<string, { scope: VariableScope; owner: string; secret: boolean }>;
};
```

Layers apply in order **team → project → factory or App**; a later layer's key replaces an earlier one. `factory` and `app` are exclusive. The default environment is `preview`: factory runs, PR previews and Studio previews all use it. `production` is reserved for shipping later.

## Where values go

- **Factory runs** (`runs.ts` `agentEnv`): when the factory is in a project, the resolved `preview` variables go into the run's environment, under everything Kiln already sets (MCP env, credentials, `KILN_*`), so a variable never replaces a harness credential. Secret values join the run's redaction list. A factory in no project gets nothing new.
- **PR previews** (`workflow.ts` preview stage): `PreviewProvider.deploy` takes optional `env`. The Kubernetes provider puts it in a `Secret` named `app-env` and references it with `envFrom`; Vercel ignores it (set variables in Vercel). The fake records it.
- **Studio**: `StudioOptions.env(app)` is `kiln.variables.forApp(app).env` merged over what it provides today; see the studio spec change.

## API (`apps/api/src/routes/variables.ts`)

| Route                                                                                                  | Who                                                                                                          | Returns                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /api/v1/variables?scope=&owner=`                                                                  | team members                                                                                                 | `VariableLayerView[]` for that owner (every environment)                         |
| `PUT /api/v1/variables/{scope}/{owner}/{environment}` body `{ variables: { key, value?, secret? }[] }` | team: admins; project: admins or the project owner; factory: `admin` on it; app: admins or the App's creator | `VariableLayerView`                                                              |
| `DELETE /api/v1/variables/{scope}/{owner}/{environment}`                                               | as PUT                                                                                                       | `{ ok: true }`                                                                   |
| `GET /api/v1/variables/resolve?environment=&project=&factory=&app=`                                    | team members                                                                                                 | `{ variables: { key, secret, value?, scope, owner }[] }` (no secret values) |

`owner` is the team id for `team`. Owners outside the current team are 404. SDK: `variables`, `setVariables`, `deleteVariables`, `resolveVariables`. No MCP tools: secrets and environment templates aren't exposed there either.

## UI

Project page → **Environments** section: one card per environment with its variables (key, value or masked secret, "secret" toggle, remove), add variable, and the inherited team variables shown read-only with their source. Matches the Secrets page (shadcn).

## Acceptance

- An App or factory key overrides the project's, which overrides the team's; tests cover each order.
- Responses, audit entries and run events never contain a secret value; a secret's value reaches the run and is redacted from its output.
- A factory with no project runs exactly as before.
- A secret saved without a value keeps its old value.
