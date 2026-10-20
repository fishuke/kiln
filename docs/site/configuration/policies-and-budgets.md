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
| `maxUsdPerWorkItem` | Not yet | Accepted by the schema. Use `budgets.perWorkItemUsd` instead. |
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
| `perWorkItemUsd` | Yes | Before each agent run, Kiln compares the work item's spend with its budget. When spend has reached the budget, the item stops as `blocked` with the reason "budget of $40 reached ($41.20 spent)". |
| `monthlyUsd` | Not yet | Accepted by the schema. |

A work item created through the API can set its own budget, which replaces `perWorkItemUsd` for that item. A pipeline's `budget.maxUsd` is accepted but not enforced yet.

Cost comes from each run's harness. Claude Code and OpenCode report cost directly. Codex reports tokens, and Kiln estimates the cost from them.

Because the check runs before a run starts, the last run can take spend past the budget.

## Who may decide

Who may approve a gate is set by the gate's `approvers` (see [Pipelines and gates](pipelines-and-gates.md#gates)) and by the scopes on the person's token (see [Admin, RBAC and audit](../management/admin-rbac-audit.md)).

## Related pages

- [Pipelines and gates](pipelines-and-gates.md)
- [Self-improvement](../measure-and-improve/self-improvement.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
- [Metrics](../measure-and-improve/metrics.md)
