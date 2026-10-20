---
title: Policies and budgets
description: Protect paths from self-improvement, require two approvals on sensitive files, and cap what a work item may spend.
owner: docs
section: Factory configuration
---

Policies in `policies/<name>.yaml` set rules the factory cannot change on its own, and budgets in `factory.yaml` cap what each work item may spend.

## A policy file

```yaml
# policies/guard.yaml
description: Keep the factory from weakening its own checks
protectedPaths: [policies/**, gates/**, decisions/command-guard.yaml]
twoApprovalPaths: [agents/review/**]
```

A factory can have several policy files. Kiln combines the lists from all of them.

| Key | Enforced today | What it does |
| --- | --- | --- |
| `protectedPaths` | Yes | [Self-improvement](../measure-and-improve/self-improvement.md) drops any proposed change to a matching path and lists it in the proposal. |
| `twoApprovalPaths` | Yes | A self-improvement proposal that changes a matching path needs approvals from two different people before Kiln applies it. |
| `deniedActions` | Not yet | Accepted by the schema. |
| `allowedTriggerers` | Not yet | Accepted by the schema. |
| `maxUsdPerWorkItem` | Yes | A spending cap per work item. See [Budgets](#budgets). |
| `description` | Not applicable | |

Patterns are paths relative to the definition root. `*` matches within one directory level and `**` matches across levels.

Self-improvement never changes files under `policies/` or `gates/`, whether or not a policy lists them.

## Rules that do not need a policy

Some limits are built into Kiln and cannot be turned off:

- A run token can push only `kiln/*` branches of the factory's repositories, open pull requests, comment and add labels. It cannot approve or merge, and it expires after 60 minutes.
- Kiln pushes the agent's branch itself. The agent is told not to push, open pull requests or merge.
- A work item can only become `complete` after a merge event or a person's confirmation.
- Agents cannot approve self-improvement proposals.

## Budgets

```yaml
# factory.yaml
budgets:
  perWorkItemUsd: 40
  monthlyUsd: 6000
```

| Key | Enforced today | What it does |
| --- | --- | --- |
| `perWorkItemUsd` | Yes | The default budget of each new work item. |
| `monthlyUsd` | Yes | The most the factory may spend on runs in a calendar month. |

Before each agent run, Kiln checks two limits:

- **Per work item.** The cap is the lowest of the work item's budget and every policy's `maxUsdPerWorkItem`. A work item's budget is `perWorkItemUsd`, unless the work item was created through the API with its own budget, which replaces it. When the item's spend has reached the cap, it stops as `blocked` with the reason "budget of $40 reached ($41.20 spent)".
- **Per month.** Kiln adds up the cost of all the factory's runs since the 1st of the month (UTC). When that has reached `monthlyUsd`, the item stops as `blocked` with the reason "monthly budget of $6000 for webapp reached ($6012.40 spent)".

A pipeline's `budget.maxUsd` is accepted but not enforced yet.

Cost comes from each run's harness. Claude Code and OpenCode report cost directly. Codex reports tokens, and Kiln estimates the cost from them.

Because the check runs before a run starts, the last run can take spend past the budget.

## Who may decide

Who may approve a gate is set by the gate's `approvers` (see [Pipelines and gates](pipelines-and-gates.md#gates)) and by the scopes on the person's token (see [Admin, RBAC and audit](../management/admin-rbac-audit.md)).

## Related pages

- [Pipelines and gates](pipelines-and-gates.md)
- [Self-improvement](../measure-and-improve/self-improvement.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
- [Metrics](../measure-and-improve/metrics.md)
