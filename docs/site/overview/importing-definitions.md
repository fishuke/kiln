---
title: Importing v1alpha1 definitions
description: Convert a definition tree in the v1alpha1 factory definition format to kiln/v1 with kiln import, or connect a config repo in that format and let Kiln convert it on every sync.
owner: docs
section: Overview
---

Kiln reads definition trees in the v1alpha1 factory definition format: run `kiln import` to convert a `schemaVersion: v1alpha1` tree to `kiln/v1`, or connect a config repo in that format and Kiln converts it on every sync.

## Two ways to import

**Convert once.** `kiln import <src> [out]` rewrites a v1alpha1 tree as a `kiln/v1` tree, writes it to `out` (by default `<src>-kiln`), prints a warning for everything it changed or dropped, and validates the result. Review it, commit it, and from then on edit the `kiln/v1` files. See the [CLI reference](../developer-tools/cli.md).

**Keep the v1alpha1 files.** Connect the config repo as it is, for example `acme/web-factory-config`, as described in [Definitions as code](../configuration/definitions-as-code.md#config-repos-on-github). When `factory.yaml` says `schemaVersion: v1alpha1`, Kiln converts the tree in memory before it validates and applies it. Nothing in the repo changes. Use this when other tools still read the v1alpha1 files.

Both paths use the same converter, so they give the same result.

## The layout is the same

Both formats use the same tree:

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

`kiln/v1` adds optional directories that v1alpha1 does not have: `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/`.

## What the converter changes

| v1alpha1 | kiln/v1 |
| --- | --- |
| `schemaVersion: v1alpha1` | `schemaVersion: kiln/v1` |
| `alias` (or `name` if no alias) | Lowercased and turned into a slug, at most 60 characters |
| `repositories[].codeForge` | `repositories[].forge`: `gitlab` for GitLab, `github` otherwise |
| `integrations: [{ type: linear }]` | `integrations: [linear]`. Only `slack`, `linear` and `jira` are kept |
| `selfImprovement.reviewerType`, `reviewerEmails` | `selfImprovement.reviewers.type`, `reviewers.emails` |
| `agentType: MAIN` | `agentType: FOREMAN` |
| The `oz` harness type | `opencode` |
| Harness `claude` | `claude-code` |
| Harness `codex` | `codex` |
| `model: auto` or `auto-<anything>` | `model: router:auto`. If the tree has no `routers/auto.yaml`, Kiln adds a complexity router (Haiku for easy, Sonnet by default, Opus for hard) |
| Harness `auth: { source: managedSecret, secretName: X }` | `auth: { source: secret, secretName: X }`. Store `X` in Kiln's secrets. |
| Harness `auth: { source: workerEnvironment }` | `auth: { source: worker }` |
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
| `environmentId`, `workerHost`, `computerUseModel`, `credentialStrategy`, `required_repos` | Agents, automations and `agentDefaults` | Kiln picks compute from the agent's runner, not from a named environment or worker. |
| Harness `auth` other than a managed secret or the worker environment | Agents, automations, `agentDefaults` | Kiln only supports credentials from its secrets store or from the worker. This is dropped without a warning. |
| `idleTimeoutMinutes` | Automations | Kiln accepts it on agents only. |
| `output`, `runner`, `secrets`, `mcpServers` | Scorers | Kiln's scorer service runs judges itself. |
| `linearSeed` | Benchmark tasks | Not supported. |
| Teams and Azure DevOps triggers | Automations | Not supported in v1. The trigger stays in the file, Kiln warns, and the file then fails validation until you remove the trigger. |
| macOS and Windows runners | Runners | Kiln runs Linux sandboxes only. The runner is converted to Linux with a warning. |

## Check after converting

- **Models.** Model names such as `gpt-6-sol-high` pass through unchanged. Make sure your model gateway serves them, or change them.
- **Runners.** v1alpha1 runners have no egress list. Kiln always allows the hosts of the repositories a run clones; add every other host the run needs, such as package registries and your model gateway, to `egress`. See [Sandboxes](../infrastructure/sandboxes.md).
- **Self-improvement threshold.** Kiln's `failedRunThreshold` must be between 1 and 50.
- **Validate.** Run `kiln validate` on the converted tree. It reports `file:line: message` for every problem.

## Related pages

- [Definitions as code](../configuration/definitions-as-code.md)
- [Automations](../configuration/automations.md)
- [Factory agents](../configuration/agents.md)
- [CLI reference](../developer-tools/cli.md)
