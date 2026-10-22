---
title: Definition file reference
description: Every key of every definition file, generated from the schemas (kiln/v1).
owner: docs
section: Factory configuration
generated: true
---

Generated from `packages/schema`. Unknown keys are errors. Run `kiln schema <kind>` for the JSON Schema of a file kind, for editor completion.

## factory

`factory.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | `"kiln/v1"` | yes |  |
| `name` | string | yes |  |
| `alias` | string |  | pattern `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$` |
| `description` | string |  |  |
| `project` | string |  |  |
| `repositories` | list of object | yes |  |
| `repositories[].forge` | `github` \| `gitlab` \| `azure_devops` \| `bitbucket` |  | default `"github"` |
| `repositories[].owner` | string | yes |  |
| `repositories[].name` | string | yes |  |
| `repositories[].deferred` | boolean |  | default `false` |
| `repositories[].description` | string |  |  |
| `integrations` | list of `github` \| `gitlab` \| `slack` \| `linear` \| `jira` \| `discord` \| `microsoft-teams` \| `teams` \| `azure_devops` \| `bitbucket` \| object |  | default `[]` |
| `github` | object |  |  |
| `github.factoryConfigChecks` | `main` \| `all` |  | default `"main"` |
| `automations` | object |  |  |
| `automations.githubOnboardingNotices` | boolean |  | default `true` |
| `cloudProviders` | object |  |  |
| `cloudProviders.aws` | object |  |  |
| `cloudProviders.aws.roleArn` | string | yes | pattern `^arn:aws[a-z-]*:iam::\d{12}:role\/.+` |
| `cloudProviders.gcp` | object |  |  |
| `cloudProviders.gcp.projectNumber` | string | yes | pattern `^\d+$` |
| `cloudProviders.gcp.workloadIdentityFederationPoolId` | string | yes |  |
| `cloudProviders.gcp.workloadIdentityFederationProviderId` | string | yes |  |
| `cloudProviders.gcp.serviceAccountEmail` | string |  | pattern `^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$` |
| `providers` | object |  |  |
| `providers.aws` | object |  |  |
| `providers.aws.roleArn` | string | yes | pattern `^arn:aws[a-z-]*:iam::\d{12}:role\/.+` |
| `providers.gcp` | object |  |  |
| `providers.gcp.projectNumber` | string | yes | pattern `^\d+$` |
| `providers.gcp.workloadIdentityFederationPoolId` | string | yes |  |
| `providers.gcp.workloadIdentityFederationProviderId` | string | yes |  |
| `providers.gcp.serviceAccountEmail` | string |  | pattern `^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$` |
| `credentialStrategy` | `EXECUTOR` \| `CREATOR` |  |  |
| `networkPolicy` | object |  |  |
| `networkPolicy.allowedHosts` | list of string |  |  |
| `networkPolicy.deniedHosts` | list of string |  |  |
| `networkPolicy.extends` | string \| list of string |  |  |
| `avatar` | string |  |  |
| `agentDefaults` | object | yes |  |
| `agentDefaults.harness` | object \| null |  |  |
| `agentDefaults.harness.type` | `claude-code` \| `codex` \| `opencode` \| `gemini` \| `pi` | yes |  |
| `agentDefaults.harness.model` | string |  |  |
| `agentDefaults.harness.reasoningLevel` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |  |  |
| `agentDefaults.harness.auth` | object \| object \| object \| object \| null |  |  |
| `agentDefaults.model` | string \| null |  |  |
| `agentDefaults.runner` | string \| null |  |  |
| `agentDefaults.secrets` | list of string \| null |  |  |
| `agentDefaults.mcpServers` | list of string \| null |  |  |
| `agentDefaults.workerHost` | string \| `""` \| null |  |  |
| `agentDefaults.computerUseModel` | string \| null |  |  |
| `agentDefaults.computerUse` | boolean \| null |  |  |
| `agentDefaults.environmentId` | string \| null |  |  |
| `scorerDefaults` | object |  |  |
| `scorerDefaults.runner` | string |  |  |
| `scorerDefaults.secrets` | list of string |  |  |
| `scorerDefaults.mcpServers` | list of string |  |  |
| `scoring` | object |  |  |
| `scoring.defaultModel` | string |  |  |
| `blueprint` | object |  |  |
| `blueprint.entry` | string | yes |  |
| `blueprint.stages` | object | yes |  |
| `blueprint.edges` | object |  | default `{}` |
| `blueprint.staffing` | object | yes |  |
| `foreman` | object |  |  |
| `foreman.mode` | `pipeline` \| `agent` |  | default `"pipeline"` |
| `foreman.maxTurns` | integer |  | default `60`, min 1, max 500 |
| `deduplication` | object |  |  |
| `deduplication.enabled` | boolean |  | default `true` |
| `deduplication.windowHours` | integer |  | default `24`, min 1, max 720 |
| `deduplication.threshold` | number |  | default `0.5`, min 0.2, max 1 |
| `experimental` | object |  |  |
| `selfImprovement` | object |  |  |
| `selfImprovement.enabled` | boolean |  | default `true` |
| `selfImprovement.failedRunThreshold` | integer |  | default `25`, min 1, max 50 |
| `selfImprovement.maxAgeDays` | integer |  | default `7`, min 1, max 90 |
| `selfImprovement.model` | string |  |  |
| `selfImprovement.scorers` | list of string \| object |  |  |
| `selfImprovement.reviewers` | object |  | default `{"type":"admins"}` |
| `selfImprovement.reviewers.type` | `admins` \| `team` \| `custom` \| `none` |  | default `"admins"` |
| `selfImprovement.reviewers.emails` | list of string |  |  |
| `defaultPipeline` | string |  |  |
| `budgets` | object |  |  |
| `budgets.perWorkItemUsd` | number |  |  |
| `budgets.monthlyUsd` | number |  |  |

## agent

`agents/<name>/agent.md (frontmatter)`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `agentType` | `FOREMAN` \| `TRIAGE` \| `SPEC` \| `IMPLEMENT` \| `REVIEW` \| `VERIFY` \| `PLAN` \| `PO_ASSISTANT` \| `CUSTOM` |  | default `"CUSTOM"` |
| `spawnableBy` | list of string |  |  |
| `idleTimeoutMinutes` | integer \| null |  |  |
| `credentialStrategy` | `EXECUTOR` \| `CREATOR` \| null |  |  |
| `networkPolicy` | object \| null |  |  |
| `networkPolicy.allowedHosts` | list of string |  |  |
| `networkPolicy.deniedHosts` | list of string |  |  |
| `networkPolicy.extends` | string \| list of string |  |  |
| `required_repos` | list of string \| object |  |  |
| `harness` | object \| null |  |  |
| `harness.type` | `claude-code` \| `codex` \| `opencode` \| `gemini` \| `pi` | yes |  |
| `harness.model` | string |  |  |
| `harness.reasoningLevel` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |  |  |
| `harness.auth` | object \| object \| object \| object \| null |  |  |
| `model` | string \| null |  |  |
| `runner` | string \| null |  |  |
| `secrets` | list of string \| null |  |  |
| `mcpServers` | list of string \| null |  |  |
| `workerHost` | string \| `""` \| null |  |  |
| `computerUseModel` | string \| null |  |  |
| `computerUse` | boolean \| null |  |  |
| `environmentId` | string \| null |  |  |

## automation

`automations/<name>/automation.md (frontmatter)`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean |  | default `true` |
| `agent` | string |  |  |
| `displayName` | string \| null |  |  |
| `triggers` | list of object | yes |  |
| `triggers[].provider` | `azure_devops` \| `bitbucket` \| `discord` \| `factory` \| `github` \| `gitlab` \| `jira` \| `kiln` \| `linear` \| `schedule` \| `slack` \| `teams` \| `webhook` | yes |  |
| `triggers[].event` | string | yes |  |
| `triggers[].filter` | object \| null |  |  |
| `triggers[].schedule` | object |  |  |
| `triggers[].schedule.cron` | string | yes |  |
| `triggers[].schedule.name` | string |  |  |
| `harness` | object \| null |  |  |
| `harness.type` | `claude-code` \| `codex` \| `opencode` \| `gemini` \| `pi` | yes |  |
| `harness.model` | string |  |  |
| `harness.reasoningLevel` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |  |  |
| `harness.auth` | object \| object \| object \| object \| null |  |  |
| `model` | string \| null |  |  |
| `runner` | string \| null |  |  |
| `secrets` | list of string \| null |  |  |
| `mcpServers` | list of string \| null |  |  |
| `workerHost` | string \| null |  |  |
| `computerUseModel` | string \| null |  |  |
| `computerUse` | boolean \| null |  |  |
| `environmentId` | string \| null |  |  |
| `idleTimeoutMinutes` | integer |  | min 1, max 60 |
| `required_repos` | list of string \| object |  |  |

## pipeline

`pipelines/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `stages` | list of object | yes |  |
| `stages[].id` | string | yes | pattern `^[a-z0-9][a-z0-9-]*$` |
| `stages[].agent` | string |  |  |
| `stages[].action` | `preview.deploy` \| `handoff` |  |  |
| `stages[].skip_if` | string |  |  |
| `stages[].gate` | string |  |  |
| `stages[].fan_out` | `per_user_story` |  |  |
| `stages[].requires` | list of `ci_green` \| `criteria_videos` \| `tests_pass` |  |  |
| `stages[].on_fail` | string |  |  |
| `stages[].max_loops` | integer |  | min 1, max 10 |
| `stages[].advisory` | boolean |  |  |
| `budget` | object |  |  |
| `budget.maxUsd` | number | yes |  |

## gate

`gates/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `approval` \| `question` \| `preview` \| `merge` \| `custom` | yes |  |
| `approvers` | list of string | yes |  |
| `evidence` | list of string |  |  |
| `nudge` | string |  | pattern `^\d+(m|h|d)$` |
| `expire` | string |  | pattern `^\d+(m|h|d)( -> (park|reject|approve))?$` |
| `rule` | string |  |  |

## policy

`policies/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `protectedPaths` | list of string |  |  |
| `twoApprovalPaths` | list of string |  |  |
| `deniedActions` | list of string |  |  |
| `allowedTriggerers` | list of string |  |  |
| `maxUsdPerWorkItem` | number |  |  |
| `mergeGate` | boolean |  |  |

## runner

`runners/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `image` | string |  |  |
| `backend` | `docker` \| `kubernetes` \| `local` |  | default `"docker"` |
| `shape` | object |  |  |
| `shape.vcpus` | integer | yes | max 9007199254740991 |
| `shape.memoryGb` | number | yes |  |
| `instanceShape` | object |  |  |
| `instanceShape.vcpus` | integer | yes | max 9007199254740991 |
| `instanceShape.memoryGb` | number | yes |  |
| `platform` | object |  |  |
| `platform.os` | `linux` \| `macos` \| `windows` |  | default `"linux"` |
| `platform.arch` | `x86_64` \| `aarch64` |  |  |
| `platform.linux` | object |  |  |
| `platform.linux.dockerImage` | string |  |  |
| `platform.linux.registryCredentialSecretName` | string |  |  |
| `platform.mac` | object |  |  |
| `platform.mac.version` | `14` \| `15` \| `26` \| `27` |  | default `"26"` |
| `registryCredentialSecretName` | string |  |  |
| `setupCommands` | list of string |  | default `[]` |
| `egress` | list of string |  | default `[]` |
| `failureSessionRetentionMinutes` | integer |  | min 1, max 60 |

## router

`routers/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string |  |  |
| `type` | `"complexity"` |  |  |
| `default` | string |  |  |
| `routing` | object |  |  |
| `routing.easy` | string |  |  |
| `routing.medium` | string |  |  |
| `routing.hard` | string |  |  |

## scorer

`scorers/<name>/scorer.md (frontmatter)`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `description` | string |  |  |
| `output` | `"classification"` |  |  |
| `kind` | `user` \| `benchmark_task_correctness` |  | default `"user"` |
| `agents` | list of string \| object | yes |  |
| `labels` | list of object | yes |  |
| `labels[].value` | string | yes |  |
| `labels[].score` | number | yes | min 0, max 1 |
| `labels[].description` | string |  |  |
| `passingScore` | number | yes | min 0, max 1 |
| `samplingRate` | number |  | default `25`, min 0, max 100 |
| `model` | string | yes |  |
| `selfImprovement` | boolean |  | default `false` |
| `runner` | string |  |  |
| `secrets` | list of string |  |  |
| `mcpServers` | list of string |  |  |

## benchmark-suite

`benchmarks/<suite>/suite.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `description` | string |  |  |
| `agent` | string | yes |  |
| `configurations` | list of object | yes |  |
| `configurations[].name` | string | yes |  |
| `configurations[].agents` | list of object |  |  |
| `configurations[].agents[].agent` | string | yes |  |
| `configurations[].agents[].model` | string |  |  |
| `configurations[].agents[].harness` | object |  |  |
| `configurations[].agents[].harness.type` | `claude-code` \| `codex` \| `opencode` \| `gemini` \| `pi` | yes |  |
| `configurations[].agents[].harness.model` | string |  |  |
| `configurations[].agents[].harness.reasoningLevel` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |  |  |
| `configurations[].agents[].harness.auth` | object \| object \| object \| object \| null |  |  |
| `configurations[].runner` | string |  |  |
| `tasks` | list of string | yes |  |

## benchmark-task

`benchmarks/<suite>/tasks/<task>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `prompt` | string | yes |  |
| `successCriteria` | list of string | yes |  |
| `startingRepoRefs` | list of string | yes |  |
| `sourceRunId` | string |  |  |
| `tags` | list of string |  |  |
| `labels` | list of string |  |  |
| `referencePr` | string |  |  |

## skill

`skills/<name>/SKILL.md (frontmatter)`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `description` | string | yes |  |
| `owner` | string |  |  |
| `version` | string |  |  |

## webhook

`webhooks/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean |  | default `true` |
| `authMode` | `token` \| `url_token` \| `signature` |  | default `"token"` |
| `signatureScheme` | `github` \| `pagerduty` \| `sentry` \| `standard_webhooks` \| `stripe` \| `vercel` |  |  |
| `secretName` | string | yes |  |
| `deliveryIdHeader` | string |  | pattern `^[A-Za-z0-9!#$%&'*+.^_`|~-]+$` |

## decision

`decisions/<name>.yaml`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `provider` | `jev` \| `llm` \| `fake` |  | default `"jev"` |
| `state` | list of string | yes |  |
| `questions` | object | yes |  |
| `policy` | object | yes |  |
| `on_error` | `llm` \| `allow` \| `deny` |  | default `"llm"` |
| `timeout_ms` | integer |  | default `800`, max 9007199254740991 |

## memory

`memories/<slug>.md (frontmatter)`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `tags` | list of string |  | default `[]` |
| `author` | string |  |  |

## Related pages

- [Definitions as code](definitions-as-code.md)
- [Agents](agents.md)
- [Automations](automations.md)
