---
title: Factory agents
description: Define the roles in a factory with agents/<name>/agent.md, choose a harness and model, and understand how settings are inherited.
owner: docs
section: Factory configuration
---

Each agent is a file at `agents/<name>/agent.md` with YAML frontmatter for its role and execution settings, followed by its instructions in Markdown.

## An agent file

```markdown
---
description: Implements one approved change with tests
agentType: IMPLEMENT
harness: { type: claude-code, model: claude-sonnet-5-5 }
runner: linux-node
---
Write failing tests first, then implement.
Keep the change to what the acceptance criteria ask for.
```

The directory name is the agent's name. Other files refer to the agent by that name, for example `agent: implement` in an automation or `agents: [implement]` in a scorer.

## Frontmatter keys

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `description` | string | none | Shown in listings. |
| `agentType` | enum | `CUSTOM` | The role. See below. |
| `spawnableBy` | list of agent names | `[foreman]` | Every name must be an agent in the tree. |
| `idleTimeoutMinutes` | integer 1–60 | 10 | |
| `harness` | object | inherited | `type` (`claude-code`, `codex`, `opencode`), optional `model`, optional `reasoningLevel` (`low`, `medium`, `high`), optional `auth`. See [Harness credentials](../infrastructure/harnesses.md#credentials). |
| `model` | string | inherited | A model name, or `router:<name>` for a router in `routers/`. |
| `runner` | string | inherited | A file name in `runners/`, without `.yaml`. |
| `secrets` | list | inherited | Names of Kiln secrets. A raw secret that is set is passed to the run as an environment variable with the same name. A typed secret passes its provider variables. See [Secrets](../management/secrets-mcps-environments.md#secrets). |
| `mcpServers` | list | inherited | Names or ids of the team's MCP servers, or built-in ids such as `linear` and `github`. See [MCP servers](../management/secrets-mcps-environments.md#mcp-servers-mcps-and-apps). |
| `environmentId` | string | inherited | A team environment (id or name): image, repositories, setup commands and secrets. See [Environments](../management/secrets-mcps-environments.md#environments). |
| `workerHost` | string | inherited | Run on a [self-hosted worker](../infrastructure/self-hosted-workers.md) with this id. `""` or `null` runs on the Kiln server. |
| `computerUse` | boolean | inherited | Turn computer use (screenshots and recordings of the running app) on or off. |
| `computerUseModel` | string | automatic | The model for computer use, for example `claude-fable-5-1` or `claude-sonnet-5-5`. |
| `credentialStrategy` | `EXECUTOR` or `CREATOR` | factory's, else `EXECUTOR` | Whose forge identity the run acts as: the agent, or the person who started the work. |
| `networkPolicy` | object | factory's | `allowedHosts` (added to the runner's egress) and `deniedHosts` (always blocked). Literal hosts or IPs only. `null` turns an inherited policy off. |
| `required_repos` | list | none | Repositories (`owner/name` or `{owner, name}`) prepared for every run even when marked `deferred`. |

Unknown keys are errors. Every key can also be changed through the API: `PUT /api/v1/factories/{id}/agents/{name}` with the keys above plus `prompt` (a pull request for config-repo factories).

## Roles

| `agentType` | What Kiln uses it for |
| --- | --- |
| `FOREMAN` | Coordinates work items. Decides whether a spec is needed when the typed decision is unsure. A factory needs exactly one. |
| `TRIAGE` | Classifies kind and size when the `triage` decision is not confident. |
| `SPEC` | Writes the spec with numbered acceptance criteria (`AC1`, `AC2`, …) and user stories, as a draft pull request. |
| `IMPLEMENT` | Makes the change on the work item's `kiln/*` branch. |
| `VERIFY` | Checks each acceptance criterion and records a Playwright video per criterion. |
| `REVIEW` | Reviews the pull request and reports a verdict and findings. Kiln, not the agent, posts them. |
| `PLAN` | Turns a goal or PRD into a roadmap. See [Planning](../product-owners/planning.md). |
| `PO_ASSISTANT` | Reserved for spec interviews with product owners. Kiln has no built-in behavior for it yet; it runs like `CUSTOM`. |
| `CUSTOM` | Anything else. An automation can send work straight to a custom agent. In a pipeline, a custom agent's stage runs like a build stage. |

When the foreman builds the default path, it picks the first agent of each type. If there is no `IMPLEMENT` agent, it uses a `CUSTOM` agent, then the foreman. See [How Kiln works](../overview/how-kiln-works.md).

## Choosing a harness and model

Set exactly one of `harness` or `model` in a file, not both. `factory.yaml` must set one of them in `agentDefaults`.

- `harness` picks the program and, optionally, its model: `harness: { type: codex, model: gpt-5-codex }`.
- `model` keeps the inherited harness and changes only its model, e.g. `model: claude-fable-5-1` (Claude Fable 5.1, the most capable), `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5`.
- `model: router:by-task` picks a model per run with `routers/by-task.yaml`.

If nothing sets a harness, the run uses `claude-code`.

### Routers

A router picks a model for each run.

```yaml
# routers/by-complexity.yaml
type: complexity
default: claude-sonnet-5-5
routing:
  easy: claude-haiku-5-5
  hard: claude-fable-5-1
```

A `complexity` router asks the `model-router` decision. Its built-in policy picks `easy` when `complexity.easy >= 0.8`, `hard` when `complexity.hard >= 0.6`, and `medium` otherwise. A missing entry falls back to `default`.

```yaml
# routers/by-task.yaml
type: prompt
default: claude-sonnet-5-5
routing:
  - { description: front-end styling tasks, model: claude-haiku-5-5 }
  - { description: database migrations, model: claude-opus-5-5 }
```

A `prompt` router picks the entry whose description shares the most words (four letters or longer) with the run's prompt, or `default` when none match. [Benchmarks](../measure-and-improve/benchmarks.md) can propose a prompt router for you.

## Inheritance

Execution settings (`harness`, `model`, `runner`, `secrets`, `mcpServers`, `environmentId`) are layered:

1. `agentDefaults` in `factory.yaml`
2. the agent's frontmatter
3. the automation's frontmatter, for work that automation starts

A later layer overrides an earlier one. Setting a key to `null` clears the inherited value. Setting `harness` replaces the inherited harness and model. Setting `model` keeps the inherited harness and changes its model.

## What an agent receives

Each run gets:

- the agent's instructions,
- matching [memories](skills.md#memories) for work runs,
- every shared skill plus the agent's own skills,
- a "Reporting back to Kiln" section that tells the agent to write `.kiln/result.json` in a shape for its role, commit on the current branch, and never push, open pull requests or merge.

See [Harnesses](../infrastructure/harnesses.md#the-result-file) for each role's result shape.

## Related pages

- [Skills](skills.md)
- [Automations](automations.md)
- [Harnesses](../infrastructure/harnesses.md)
- [Sandboxes](../infrastructure/sandboxes.md)
- [Definitions as code](definitions-as-code.md)
