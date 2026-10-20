---
title: Kiln builds Kiln
description: A case study of the kiln-self factory that works on Kiln's own repository, how it is set up, and the rules that keep it from weakening its own checks.
owner: docs
section: Guides
---

Kiln's own repository is worked on by a Kiln factory, `kiln-self`: issues labeled `kiln-ready` go to its foreman, the factory opens pull requests, and people review and merge them.

## How work arrives

Work for Kiln is filed as GitHub issues in the Kiln repository. Labeling an issue `kiln-ready` sends it to the `kiln-self` factory, which triages it, writes a spec when needed, builds it and opens a pull request. People still review and merge every pull request.

## The definition

The factory lives in `factories/kiln-self/`. Apply it with `kiln apply factories/kiln-self`.

```yaml
# factories/kiln-self/factory.yaml
schemaVersion: kiln/v1
name: Kiln
alias: kiln
project: kiln
repositories:
  - { owner: fishuke, name: kiln }
integrations: [github, linear]
agentDefaults:
  harness: { type: claude-code, model: router:by-task }
  runner: linux-node
selfImprovement: { failedRunThreshold: 10, reviewers: { type: admins } }
defaultPipeline: feature
budgets: { perWorkItemUsd: 30, monthlyUsd: 3000 }
```

| Part | What it does |
| --- | --- |
| Agents | `foreman`, `triage`, `spec`, `implement`, `verify`, `review`, plus `planner` (`PLAN`), `po-assistant` (`PO_ASSISTANT`) and `improver` (`CUSTOM`) |
| `pipelines/feature.yaml` | Triage, spec (skipped for `xs` and `s`), build per user story, verify with CI and a video per criterion (up to 3 loops), preview, an advisory review whose findings are posted on the pull request, hand-off |
| `gates/` | Spec approval and preview acceptance by the requester or the `po` role, nudged after 24h, parked after 72h |
| `routers/by-task.yaml` | A complexity router: Haiku for easy, Sonnet for medium and by default, Opus for hard |
| `runners/linux-node.yaml` | Kiln's runner image on Docker, 4 vCPUs and 8 GB, `pnpm install`, egress to the npm registry, `github.com` and `api.github.com` |
| `skills/repository-conventions` | Named exports, zod at every boundary, one behavior per test |
| `decisions/command-guard.yaml` | The command guard with the standard thresholds |
| `automations/` | `ready` (GitHub `issue_labeled` with `kiln-ready`) and `review-comments` (review submitted on a fishuke/kiln pull request) |

The `ready` automation filters on `repos: [fishuke/kiln]`. GitHub events carry both `repo` and `repos`.

## The rules it works under

The agents follow the same rules that `CLAUDE.md` sets for people and Claude Code in this repository: one task per branch, failing tests first, pull requests under about 400 changed lines, `packages/*` never import `apps/*`, every external system behind an interface with a fake, and docs pages updated with each task.

Kiln enforces what agents can do on GitHub: run tokens push only `kiln/*` branches and cannot approve or merge. People merge.

## Protecting the checks

A factory that improves itself must not loosen the checks that review it. `policies/self-protection.yaml` lists:

```yaml
protectedPaths:
  - packages/definitions/src/validate*
  - apps/api/src/app.ts
  - packages/auth/**
  - policies/**
  - gates/**
  - packages/engine/src/gates.ts
  - packages/engine/src/state.ts
  - .github/workflows/**
  - factories/kiln-self/policies/**
twoApprovalPaths:
  - packages/definitions/**
  - packages/engine/src/improvement.ts
```

`policies/default.yaml` also protects `policies/**`, `gates/**` and `.github/workflows/**`, and needs two approvals for `decisions/**`.

What Kiln enforces from these today:

- Self-improvement drops any proposed change to a protected path and never changes `policies/` or `gates/`.
- A self-improvement change to a two-approval path needs two different people.
- Kiln never opens a self-improvement proposal without a replay report, and agents cannot approve proposals.

Self-improvement changes definition files. Code changes to `packages/` and `apps/` arrive as ordinary pull requests from work items, so the protected code paths there also need branch protection and code owners in the repository. Spending is capped at the lowest of `budgets.perWorkItemUsd` (30) and the policies' `maxUsdPerWorkItem` (40 and 30), so $30 per work item, and at `monthlyUsd` (3000) per month. The `deniedActions` keys are accepted but not enforced yet.

## Scorers

| Scorer | Grades | Purpose |
| --- | --- | --- |
| `criteria` | `implement`, 25% of runs | Passes only when every acceptance criterion is covered. Feeds self-improvement. |
| `docs-drift` | `implement` and `review`, 25% of runs | Flags runs where a docs page led the agent astray, so self-improvement can propose a docs fix. |
| `meta` | `improver`, every run | Passes only when a self-improvement pull request has a "## Replay" section with a before and after table. |

With `failedRunThreshold: 10`, a proposal starts once an agent's unreviewed failures cover 10 runs, or the oldest is 7 days old.

## Measuring the share

Every pull request the factory opens carries the `factory:kiln` label. The share of merged Kiln pull requests with that label shows how much of Kiln is built by Kiln. The factory's [dashboard](../measure-and-improve/metrics.md) adds autonomy, cycle time and cost per merged PR.

## Related pages

- [Make a factory improve itself](make-a-factory-improve-itself.md)
- [Self-improvement](../measure-and-improve/self-improvement.md)
- [Policies and budgets](../configuration/policies-and-budgets.md)
- [Pipelines and gates](../configuration/pipelines-and-gates.md)
- [GitHub](../integrations/github.md)
