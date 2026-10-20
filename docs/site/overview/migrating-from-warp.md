---
title: Migrating from Warp Factories
description: Convert a Warp Factories v1alpha1 definition to kiln/v1 with kiln import --from-warp, or connect a Warp-exported config repo directly.
owner: docs
section: Overview
---

Kiln reads Warp Factories definition trees: run `kiln import --from-warp` to convert a `v1alpha1` tree to `kiln/v1`, or connect a Warp-exported config repo and Kiln converts it on every sync.

## Two ways to migrate

**Convert once.** `kiln import --from-warp` rewrites a Warp tree as a `kiln/v1` tree. Review the result, commit it, and from then on edit the Kiln files. Use this when you are leaving Warp. See the [CLI reference](../developer-tools/cli.md).

**Keep the Warp layout.** Connect the config repo that Warp exports, such as `fishuke/kiln-config`, as described in [Definitions as code](../configuration/definitions-as-code.md#config-repos-on-github). When `factory.yaml` says `schemaVersion: v1alpha1`, Kiln converts the tree in memory before it validates and applies it. Nothing in the repo changes. Use this when you run Warp and Kiln side by side.

Both paths use the same converter, so they give the same result.

## The layout is the same

Warp and Kiln use the same tree:

```text
factory.yaml
agents/<name>/agent.md
agents/<name>/skills/<skill>/SKILL.md
automations/<name>/automation.md
runners/<name>.yaml
routers/<name>.yaml
scorers/<name>/scorer.md
benchmarks/<suite>/suite.yaml and tasks/*.yaml
skills/<skill>/SKILL.md
webhooks/<name>.yaml
```

Directory names with spaces, such as `agents/Kiln Foreman Agent/agent.md`, work as they are. The agent name is the directory name, and scorers refer to agents by that name.

Kiln adds optional directories Warp does not have: `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/`.

## What the converter changes

| Warp | Kiln |
| --- | --- |
| `schemaVersion: v1alpha1` | `schemaVersion: kiln/v1` |
| `alias` (or `name` if no alias) | Lowercased and turned into a slug, at most 60 characters |
| `repositories[].codeForge` | `repositories[].forge`: `gitlab` for GitLab, `github` otherwise |
| `integrations: [{ type: linear }]` | `integrations: [linear]`. Only `slack`, `linear` and `jira` are kept |
| `selfImprovement.reviewerType`, `reviewerEmails` | `selfImprovement.reviewers.type`, `reviewers.emails` |
| `agentType: MAIN` | `agentType: FOREMAN` |
| Harness `oz` | `opencode` |
| Harness `claude` | `claude-code` |
| Harness `codex` | `codex` |
| `model: auto` or `auto-<anything>` | `model: router:auto`. If the tree has no `routers/auto.yaml`, Kiln adds a complexity router (Haiku for easy, Sonnet by default, Opus for hard) |
| `mcpServers` as a map | A list of the server names |
| Runner `platform.linux.dockerImage` | `image` (defaults to `ubuntu:24.04` when missing) |
| Runner `instanceShape` | `shape` |
| Scorer without `name` | `name` set to the directory name |
| Scorer `agents` as objects | A list of agent names |
| Benchmark task `successCriteria` as one string | A list with that string |

Every change that drops something is reported as a warning.

## What is dropped, and why

| Dropped | Where | Why |
| --- | --- | --- |
| `codeForges`, `credentialStrategy`, `cloudProviders` | `factory.yaml` | Kiln connects forges and credentials at install time, not per factory. |
| `secrets`, `mcpServers` | `factory.yaml` | Secrets live in Kiln's secrets store. Agents and automations still accept `secrets` and `mcpServers`. |
| `automations` | `factory.yaml` | Automations are files under `automations/`. |
| `scorerDefaults` | `factory.yaml` | Each scorer states its own `samplingRate`, `model` and `passingScore`. |
| `benchmarkRepoSubstitutions` | `factory.yaml` | Benchmark tasks pin exact commits in `startingRepoRefs`. |
| `environmentId`, `workerHost`, `computerUseModel`, `credentialStrategy`, `required_repos` | Agents, automations and `agentDefaults` | Kiln picks compute from the agent's runner, not from a Warp environment or worker. |
| Harness `auth` | Agents, automations, `agentDefaults` | Kiln does not read harness credentials from the definition tree. |
| `idleTimeoutMinutes` | Automations | Kiln accepts it on agents only. |
| `output`, `runner`, `secrets`, `mcpServers` | Scorers | Kiln's scorer service runs judges itself. |
| `linearSeed` | Benchmark tasks | Not supported. |
| Teams and Azure DevOps triggers | Automations | Not supported in v1. The trigger stays in the file, Kiln warns, and the file then fails validation until you remove the trigger. |
| macOS and Windows runners | Runners | Kiln runs Linux sandboxes only. The runner is converted to Linux with a warning. |

## Check after converting

- **GitHub filters on `repos`.** Warp automations often filter on `repos: [owner/name]`. Kiln's GitHub events carry the repository as `repo`, so rename the key to `repo` or the trigger will not match.
- **Models.** Warp model names such as `gpt-6-sol-high` pass through unchanged. Make sure your model gateway serves them, or change them.
- **Runners.** Add `egress` hosts to each runner. A runner with no egress gets no network. See [Sandboxes](../infrastructure/sandboxes.md).
- **Self-improvement threshold.** Kiln's `failedRunThreshold` must be between 1 and 50.
- **Validate.** Run `kiln validate` on the converted tree. It reports `file:line: message` for every problem.

## Related pages

- [Definitions as code](../configuration/definitions-as-code.md)
- [Automations](../configuration/automations.md)
- [Factory agents](../configuration/agents.md)
- [CLI reference](../developer-tools/cli.md)
