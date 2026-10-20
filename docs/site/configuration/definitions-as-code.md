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
automations/<name>/automation.md          # triggers + prompt
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

This is the same layout Warp Factories exports, with `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/` added. Files ending in `.md` have YAML frontmatter between `---` lines and a Markdown body. A file's name (or its directory's name) is the resource's name.

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
integrations: [slack, linear]
agentDefaults:
  harness: { type: claude-code, model: router:by-task }
  runner: linux-node
selfImprovement: { failedRunThreshold: 15, reviewers: { type: team } }
defaultPipeline: feature          # omit to let the foreman choose
budgets: { perWorkItemUsd: 40, monthlyUsd: 6000 }
```

| Key | Notes |
| --- | --- |
| `schemaVersion` | Must be `kiln/v1`. A `v1alpha1` tree is converted first; see [Migrating from Warp](../overview/migrating-from-warp.md). |
| `name` | 1–100 characters. |
| `alias` | Lowercase letters, digits and dashes, 1–60 characters. Also the factory's ID in Kiln. When missing, the ID is `name` turned into a slug. |
| `description`, `project` | Optional. |
| `repositories` | At least one. `forge` is `github` (default) or `gitlab`. Agents work in the first repository. `deferred: true` repositories are not cloned into sandboxes. |
| `integrations` | Any of `github`, `gitlab`, `slack`, `linear`, `jira`. |
| `agentDefaults` | Execution settings every agent inherits. Must set `harness` or `model`. |
| `selfImprovement` | `failedRunThreshold` 1–50 (default 25), `maxAgeDays` 1–90 (default 7), `reviewers.type` `admins` (default), `team`, `custom` or `none`, and `reviewers.emails` for `custom`. |
| `defaultPipeline` | A file name in `pipelines/`. |
| `budgets` | `perWorkItemUsd`, `monthlyUsd`. See [Policies and budgets](policies-and-budgets.md). |

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

`kiln diff --against applied` shows what would change, by resource:

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

A factory can live in a GitHub repository, called its config repo. Use the layout Warp exports: `factory.yaml` at the repository root (or in a subdirectory), `agents/<name>/agent.md`, and so on. For example, `fishuke/kiln-config`.

**Connect.** Connecting a config repo reads the tree at its branch (default `main`) and directory (default the root), applies it, and binds the factory to the repository. If `factory.yaml` says `schemaVersion: v1alpha1`, Kiln converts it first; see [Migrating from Warp](../overview/migrating-from-warp.md).

**Sync on push.** When Kiln receives a GitHub `push` webhook for the config repo's branch, it reads the tree again and applies it. A push that breaks validation is recorded and rejected; the last valid definition stays active. You can also trigger a sync by hand.

**Changes from Kiln.** When Kiln itself proposes a definition change, such as a self-improvement, an accepted memory, an installed skill or a router from benchmarks, it commits to a `kiln/*` branch of the config repo and opens a pull request. A person merges it, and the push applies it.

Protect the config repo's default branch so that every change needs a review and a passing validation check.

### Validate pull requests with GitHub Actions

This workflow checks out Kiln and the config repo side by side, installs Kiln, and runs `pnpm kiln validate` on the definition. `pnpm kiln` runs from the Kiln checkout, so the path to the definition is relative to it.

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
          repository: fishuke/klin
          path: kiln

      - name: Check out the definition
        uses: actions/checkout@v4
        with:
          path: definition

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
        working-directory: kiln
        run: pnpm kiln validate ../definition
```

The command prints `ok <name> (<sha>): <n> agents, <n> automations` on success, prints each error as `file:line: message` and exits 1 on failure. Make the `validate` job a required status check in the branch protection rules. The workflow file itself is outside the definition layout, so validation lists it as an `unknown-file` warning.

## Related pages

- [Migrating from Warp Factories](../overview/migrating-from-warp.md)
- [Factory agents](agents.md)
- [Replay and canary](../measure-and-improve/replay-and-canary.md)
- [GitHub](../integrations/github.md)
- [CLI reference](../developer-tools/cli.md)
