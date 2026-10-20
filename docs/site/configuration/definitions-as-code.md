---
title: Definitions as code
description: Lay out a factory as a versioned tree rooted at factory.yaml, validate it, apply it atomically or as a canary, and keep it in a GitHub config repo.
owner: docs
section: Factory configuration
---

A factory is defined by a tree of files rooted at `factory.yaml`, which Kiln validates as a whole and applies whole or not at all.

## Layout

```text
factory.yaml
agents/<name>/agent.md                    # frontmatter + instructions
agents/<name>/skills/<skill>/SKILL.md
automations/<name>/automation.md          # triggers + prompt (or automations/<name>.md)
pipelines/<name>.yaml                     # optional stage graph
gates/<name>.yaml                         # gate rules
policies/<name>.yaml                      # protected paths, approvals
decisions/<name>.yaml                     # typed decisions
runners/<name>.yaml
routers/<name>.yaml
scorers/<name>/scorer.md
benchmarks/<suite>/suite.yaml
benchmarks/<suite>/tasks/<task>.yaml
skills/<skill>/SKILL.md
webhooks/<name>.yaml
memories/<slug>.md
```

This layout matches the v1alpha1 factory definition format, with `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/` added. Files ending in `.md` have YAML frontmatter between `---` lines and a Markdown body. A file's name (or its directory's name) is the resource's name.

`README.md` and `.gitkeep` files are ignored. Any other file Kiln does not recognize, such as `.github/workflows/validate.yml`, produces an `unknown-file` warning but does not fail validation.

## factory.yaml

```yaml
schemaVersion: kiln/v1
name: web-app
alias: webapp                     # @webapp in Slack, Linear, Jira
project: customer-portal
repositories:
  - { forge: github, owner: acme, name: web-app }
  - { forge: github, owner: acme, name: design-system, deferred: true }
integrations:
  - type: slack
    slack: { autoRespondToThreadReplies: true }
  - linear
github: { factoryConfigChecks: main }
cloudProviders:
  aws: { roleArn: arn:aws:iam::123456789012:role/kiln-runs }
agentDefaults:
  harness: { type: claude-code, model: router:by-task }
  runner: linux-node
selfImprovement: { failedRunThreshold: 15, reviewers: { type: team } }
defaultPipeline: feature          # omit to let the foreman choose
budgets: { perWorkItemUsd: 40, monthlyUsd: 6000 }
```

| Key | Notes |
| --- | --- |
| `schemaVersion` | Must be `kiln/v1`. A `v1alpha1` tree is converted first; see [Importing v1alpha1 definitions](../overview/importing-definitions.md). |
| `name` | 1–100 characters. |
| `alias` | Lowercase letters, digits and dashes, 1–60 characters. Also the factory's ID in Kiln. When missing, the ID is `name` turned into a slug. |
| `description`, `project` | Optional. |
| `repositories` | At least one. `forge` is `github` (default), `gitlab`, `azure_devops` or `bitbucket`. With several repositories, triage picks the one each work item belongs to (from the issue and each repository's optional `description`) and every stage works in it; with one, agents work in it. `deferred: true` repositories are not cloned into sandboxes unless an automation's `required_repos` names them. |
| `integrations` | The workspace integrations this factory opts into: `slack`, `microsoft-teams`, `discord`, `linear`, `jira`, as names or as `{ type, <type>: settings }` objects. Linear and Jira are exclusive. Forges come from `repositories`. See [Connections](../integrations/connections.md#per-factory-opt-in). |
| `github` | `factoryConfigChecks`: `main` (default) or `all`. See [GitHub](../integrations/github.md#the-kilnfactory-config-check). |
| `automations` | `githubOnboardingNotices` (default `true`): once your workspace links GitHub accounts, a person who mentions `@kiln-factory` without a linked account gets one comment saying how to link it. Work still starts. `false` turns the comment off for this factory's repositories. |
| `cloudProviders` | Cloud identity federation for runs. `providers` is accepted as its older name. See below. |
| `agentDefaults` | Execution settings every agent inherits. Must set `harness` or `model`. |
| `selfImprovement` | `failedRunThreshold` 1–50 (default 25), `maxAgeDays` 1–90 (default 7), `reviewers.type` `admins` (default), `team`, `custom` or `none`, and `reviewers.emails` for `custom`. |
| `defaultPipeline` | A file name in `pipelines/`. |
| `budgets` | `perWorkItemUsd`, `monthlyUsd`. See [Policies and budgets](policies-and-budgets.md). |

### Cloud identity federation

```yaml
cloudProviders:
  aws: { roleArn: arn:aws:iam::123456789012:role/kiln-runs }
  gcp:
    projectNumber: "123456789012"        # quote it
    workloadIdentityFederationPoolId: kiln
    workloadIdentityFederationProviderId: kiln-runs
    serviceAccountEmail: runs@acme.iam.gserviceaccount.com   # optional
```

Runs get these environment variables:

| Setting | Variables |
| --- | --- |
| `aws.roleArn` | `AWS_ROLE_ARN`, `AWS_ROLE_SESSION_NAME` (`kiln-run`) |
| `gcp` | `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER` (the full `projects/…/providers/…` name), `GCP_SERVICE_ACCOUNT_EMAIL` |

Set `cloudProviders` or the older `providers`, not both.

The other file kinds are covered on their own pages: [agents](agents.md), [skills](skills.md), [automations](automations.md), [pipelines and gates](pipelines-and-gates.md), [policies](policies-and-budgets.md), [decisions](decisions.md), [runners](../infrastructure/sandboxes.md#runner-files), [scorers](../measure-and-improve/scorers.md) and [benchmarks](../measure-and-improve/benchmarks.md). The full key reference is generated from the schema.

## Validation

Kiln validates a tree in three steps: parse each file, check it against its schema, then check references across files. Unknown keys are errors.

Cross-file rules:

- Exactly one agent has `agentType: FOREMAN`.
- `agentDefaults` sets `harness` or `model`. No file sets both.
- Every `runner` names a file in `runners/`, and every `router:<name>` model names a file in `routers/`.
- `defaultPipeline` names a file in `pipelines/`.
- `spawnableBy`, automation `agent`, scorer `agents` and benchmark `agent` name agents that exist.
- `webhook` triggers have `filter.webhook` naming a file in `webhooks/`.
- Pipeline stage IDs are unique, `agent` and `gate` exist, and `on_fail` names an earlier stage.
- Scorer label values and benchmark configuration names are unique.
- Every task a suite lists has a file in its `tasks/` folder.
- `skip_if`, gate `rule` and decision `policy` expressions parse, and policies only read their own questions and state fields.
- `custom` self-improvement reviewers have at least one email.

Errors carry the file and line:

```text
agents/triage/agent.md:3: runner missing is not defined in runners/
pipelines/feature.yaml:4: stage spec uses unknown gate spec-approvl
```

Run `kiln validate [path]` locally or in CI. It exits non-zero on any error. See the [CLI reference](../developer-tools/cli.md).

## Applying a definition

Kiln stores each tree by its definition SHA, a 40-character hash of every path and file content. Applying a tree:

- **Valid tree.** Kiln stores it, makes it the applied definition, keeps the previous SHA, and records who applied it and the diff in the audit log. New work items use it. Work items already in flight keep the SHA they started with.
- **Invalid tree.** Kiln records the attempt and the errors, and the previous definition stays active. The factory shows the first error as its last error.

`kiln diff --against applied` asks the server what would change compared with the applied definition, by resource:

```text
+ agent/docs
~ agent/review
- automation/weekly
```

`kiln apply --dry-run` validates and shows the diff without applying.

## Canary apply

`kiln apply --canary 10%` applies a valid tree as a candidate for a share of new work items. The applied definition stays in place for the rest.

- Each new work item is assigned by a stable hash of its ID, so the split stays the same for that item.
- Metrics and scores are split by definition SHA, so you can compare the two.
- You can promote the candidate to 100% or roll it back at any time.
- Kiln checks canaries on its timer. After 7 days, it promotes the candidate if its pass rate is no more than 2 points below the applied definition's, and rolls it back otherwise, including when the candidate has no scores.

A canary only starts when the factory already has an applied definition and the share is below 100%. See [Replay and canary](../measure-and-improve/replay-and-canary.md).

## Config repos on GitHub

A factory can live in a GitHub repository, called its config repo. Use the layout above: `factory.yaml` at the repository root (or in a subdirectory), `agents/<name>/agent.md`, and so on. For example, `acme/web-factory-config`.

**Connect.** Connecting a config repo reads the tree at its branch (default `main`) and directory (default the root), applies it, and binds the factory to the repository. If `factory.yaml` says `schemaVersion: v1alpha1`, Kiln converts it first; see [Importing v1alpha1 definitions](../overview/importing-definitions.md).

**Sync on push.** When Kiln receives a GitHub `push` webhook for the config repo's branch, it reads the tree again and applies it. A push that breaks validation is recorded and rejected; the last valid definition stays active. You can also trigger a sync by hand.

One exception: when the pushed tree is exactly the candidate of an open self-improvement proposal, which is what merging that proposal's pull request produces, Kiln applies it as a canary (10% by default) and marks the proposal merged. See [Self-improvement](../measure-and-improve/self-improvement.md#reviewing-a-proposal).

**Changes from Kiln.** When Kiln itself proposes a definition change, such as a self-improvement, an accepted memory, an installed skill or a router from benchmarks, it commits to a `kiln/*` branch of the config repo and opens a pull request. A person merges it, and the push applies it.

Protect the config repo's default branch so that every change needs a review and a passing validation check.

### Validate pull requests with GitHub Actions

This workflow checks out the config repo inside a Kiln checkout, installs Kiln, and runs `pnpm kiln validate .` from the config repo's directory. The CLI resolves paths against the directory you ran `pnpm` from, so `.` is the config repo.

```yaml
# .github/workflows/validate.yml
name: Validate factory definition
on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out Kiln
        uses: actions/checkout@v4
        with:
          repository: fishuke/kiln
          path: kiln

      - name: Check out the definition
        uses: actions/checkout@v4
        with:
          path: kiln/definition

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: kiln/pnpm-lock.yaml

      - name: Install Kiln
        working-directory: kiln
        run: pnpm install --frozen-lockfile

      - name: Validate
        working-directory: kiln/definition
        run: pnpm kiln validate .
```

The command prints `ok <name> (<sha>): <n> agents, <n> automations` on success, prints each error as `file:line: message` and exits 1 on failure. Make the `validate` job a required status check in the branch protection rules. The workflow file itself is outside the definition layout, so validation lists it as an `unknown-file` warning.

## Editing through the API

The web app edits definitions file by file:

- `GET /api/v1/factories/{id}/files` and `GET|PUT|DELETE /api/v1/factories/{id}/files/{path}`.
- `POST /api/v1/factories/{id}/files:batch {changes: [{path, content | null}], message}` changes several files in one commit and returns `{applied: sha}` or `{pullRequest: url}`.
- Higher-level endpoints for agents, automations, runners, routers, skills and settings (`PATCH /factories/{id}/settings`: name, alias, description, repositories, credential strategy, agent and scorer defaults, self-improvement, benchmarking model).

A Kiln-managed factory validates the whole tree and applies it atomically; nothing changes on an error. A factory stored in a config repo gets a branch and a pull request instead, and the merge applies it. `POST /factories/{id}/migrate {owner, name}` moves a managed factory into a GitHub repo through a pull request; the factory switches over when it merges.

## Creating a factory

`POST /api/v1/factories` (and the MCP tool `create_factory`) is the setup wizard in one call: repositories, which of triage, spec, implement and review to include (the foreman is always there), Slack, a tracker (Linear or Jira, with teams or projects), a cost preset (`quality` uses Claude Fable 5.1 for the foreman and spec agents and Opus 5.5 to implement; `efficient` uses Sonnet and Haiku), self-improvement on or off, and starter automations. It writes default prompts for every agent, the `github`, `slack`, `linear`/`jira`, `code-review` and `ui-verification` skills, the default scorers and the automations for the connected tools. `dryRun: true` returns the files without creating anything. `POST /factories/{id}/learning` then starts a run that studies the repositories and tools and proposes memories and prompt changes for review.

## Schemas and validation for editors and CI

These need no token:

- `GET /api/v1/factory-files/schemas`, `/schemas/v1` (every document) and `/schemas/v1/{document}` (for example `agent.schema.json`), with `ETag` and `If-None-Match`.
- `POST /api/v1/factory-files/validate {files: [{path, content}]}` returns `diagnostics` (path, line, code, message, severity) and `deferredResolutions`: models, secrets, MCP servers, worker hosts and aliases that are only checked when the tree is applied. Limits: 256 files, 256 KB per file, 2 MB in total. `kiln files validate [path]` calls it.

## Blueprints

`blueprint` in factory.yaml replaces the foreman's own workflow with an explicit graph:

```yaml
blueprint:
  entry: draft
  stages:
    draft: { prompt: Write the change and its tests., outputs: The branch. }
    check: { prompt: Review the change against the issue. }
  edges:
    to-check: { from: draft, to: check, when: the change is written }
  staffing: { foreman: foreman, draft: implement, check: review }
```

Each stage runs its staffed agent with the stage prompt. The agent can name the edge that holds (`next` in its result); with several edges and no answer the foreman decides; with one edge it is taken. A stage with no edge that holds ends the workflow, with the pull request handed off to a person.

## Related pages

- [Importing v1alpha1 definitions](../overview/importing-definitions.md)
- [Factory agents](agents.md)
- [Replay and canary](../measure-and-improve/replay-and-canary.md)
- [GitHub](../integrations/github.md)
- [CLI reference](../developer-tools/cli.md)
