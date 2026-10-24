---
title: Studio App definitions
description: Set a Studio App's agents, skills, MCP servers, ship mode caps, merge gate and budget with the factory building blocks, inherited from the team and the Kiln Project.
owner: docs
section: Factory configuration
---

A Studio App is defined with the same `kiln/v1` files as a factory, minus the parts that only make sense for a factory, and a new App inherits everything it needs from its team and Kiln Project.

## What an App definition holds

```text
app.yaml                                   # name, description, mandatory skills, budget
agents/<name>/agent.md                     # agents, in the factory agent format
agents/<name>/skills/<skill>/SKILL.md      # an agent's own skills
skills/<skill>/SKILL.md                    # skills every agent gets
policies/<name>.yaml                       # ship mode caps and the merge gate
```

Pipelines, gates, automations, runners, routers, scorers, benchmarks, webhooks, decisions and memories don't apply to Apps. A file under any of them is an error, for example `pipelines/feature.yaml:1: pipelines don't apply to Apps`.

## app.yaml

```yaml
schemaVersion: kiln/v1
name: Pricing site
description: Marketing site for the pricing pages
skills:
  mandatory: [house-style]
budgets:
  monthlyUsd: 200
```

| Key                   | Notes                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion`       | Must be `kiln/v1`.                                                                                   |
| `name`, `description` | Optional.                                                                                            |
| `skills.mandatory`    | Skills in `skills/` that every agent always gets in its instructions, not only in its skills folder. |
| `budgets.monthlyUsd`  | What the App's chats may spend in a calendar month.                                                  |

## Agents

Agents use the [factory agent format](agents.md): `description`, `harness` or `model`, `mcpServers`, `secrets`, `spawnableBy` and the instructions in the body. An App can have any number of them, for example `implementer`, `reviewer` and `test-writer`.

```markdown
---
description: Reviews a change before it is applied
model: claude-opus-5-5
mcpServers: [github]
spawnableBy: [general]
---

Check the tests and the acceptance criteria. Report what is missing.
```

- Every App has an agent named `general` (Claude Code, no instructions), so a chat works with nothing configured. A chat that names no agent runs `general`.
- A chat's agent can start the App's other agents as subagent runs. `spawnableBy` limits which agents may start an agent; without it, any of the App's agents may.
- Each agent gets every shared skill plus its own skills. Mandatory skills are added to its instructions.
- `agentType`, `runner`, `workerHost`, `environmentId`, `required_repos` and `credentialStrategy` only mean something in a factory. In an App they are ignored with a warning.
- Set one of `harness` and `model`, not both, and name a model rather than a `router:`.

`mcpServers` names servers from [MCPs and apps](../management/secrets-mcps-environments.md#mcp-servers-mcps-and-apps). Servers given to all agents are added as in factories.

## Policies

```yaml
# policies/studio.yaml
shipMode:
  max: cowboy # the highest ship mode anyone may pick
  roles: { member: review } # the highest per team role: owner, admin, member
  pushDefaultBranch: false # imported App: Cowboy pushes the default branch
mergeGate: false # Ready for review goes through the merge gate
```

The App's policies are the only place these settings live. Ship modes and the merge gate read them from here.

- Ship modes go from `safe` to `review` to `cowboy`. A person picks a ship mode up to the lowest cap that applies to them.
- In `cowboy` mode the App's agents run without the [command guard](decisions.md#command-guard), so no command waits for an approval.
- `pushDefaultBranch` and `mergeGate` are off unless a policy turns them on, and any policy that turns one off wins. With the merge gate off, a person reviews every Studio pull request.
- Only team owners and admins change an App's policies. The Kiln MCP can't change them.
- Kiln records who changed each setting and when.

## Defaults from the team and the Kiln Project

An App's definition has up to four layers, applied in order: built-in, team, Kiln Project (when the App belongs to one), then the App itself. Each layer is a tree like the one above, and every layer is optional.

| Part                  | How layers combine                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Agents                | By name. A key a later layer sets wins; `null` clears it. Setting `harness` drops an earlier `model`.       |
| Skills                | By name; a later layer's skill replaces an earlier one.                                                     |
| Mandatory skills      | Added up across layers. An App can't drop a skill its team made mandatory.                                  |
| Policies              | All of them apply. Caps take the lowest; a switch is on only if a policy turns it on and none turns it off. |
| `budgets.monthlyUsd`  | The lowest of all layers.                                                                                   |
| `name`, `description` | The last layer that sets them.                                                                              |

Team owners and admins edit the team and project layers. Any member of the team can edit an App's own layer, except its policies.

## Versions and export

Kiln stores each layer by the content hash of its files. Every change makes a new version, and the layer points at one. **Use** on an earlier version points the layer back at it, as a new entry in its history.

Export writes the resolved definition, all layers combined, in the layout above, ready to commit to a Git repository. Team and project policies are prefixed with their layer, for example `policies/team-guard.yaml`.

## Editing

- **App settings** in Studio edits the App's own layer: agents, skills, policy, budget and versions.
- API: `GET|PUT|PATCH /api/v1/studio/apps/{id}/definition`, `POST …/definition/use`, `GET /api/v1/studio/apps/{id}/settings` and `GET /api/v1/studio/apps/{id}/definition/export`. The same routes exist for `projects/{id}` and `team`. A `PUT` with invalid files answers 400 with each error as `file:line: message`. See the [API reference](../developer-tools/api.md).
- Kiln MCP: `get_app_settings` and `update_app_settings`. See [Kiln MCP](../developer-tools/mcp.md).

## Related pages

- [Factory agents](agents.md)
- [Skills](skills.md)
- [Policies and budgets](policies-and-budgets.md)
- [Definitions as code](definitions-as-code.md)
- [Definition file reference](definitions-reference.md)
- [Secrets, MCPs and environments](../management/secrets-mcps-environments.md)
- [Talking to Studio](../product-owners/talking-to-studio.md)
