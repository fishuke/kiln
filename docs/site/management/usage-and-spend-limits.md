---
title: Usage and spend limits
description: Usage per team, factory, agent, model and user from run costs, and the team's monthly spend limit with optional auto-stop.
owner: docs
section: Management
---

Kiln is self-hosted, so there are no plans or credits. It records what runs cost and lets each team set a monthly spend limit.

## Usage

Every run records its cost, its factory, agent and model, the team it counts toward and, when there is one, the user who triggered it. Runs started by agent keys, schedules or people without an account count as `team`.

`GET /api/v1/usage` returns the current team's usage for the current calendar month (UTC), or for `since` and `until`:

| Field | What it holds |
| --- | --- |
| `totalUsd`, `runs` | Totals for the period |
| `limit` | `monthlyUsd`, `autoStop`, `spentThisMonthUsd`, `remainingUsd`, `exceeded` |
| `byDay` | Cost and runs per day |
| `byFactory`, `byAgent`, `byModel`, `byUser` | Cost and runs per factory, `factory/agent`, model and user, highest first |
| `entries` | With `entries=1`: the ledger rows, one per run, newest first (at most 1000) |

Filter with `factory=<id>` and `user=<email or user id>`. Costs are what the harness reports. They are for comparing, not invoices.

## Spend limit

Each team has a monthly spend limit, $200 by default. Team owners and admins change it in the team settings:

```json
{ "spendLimit": { "monthlyUsd": 500, "autoStop": true } }
```

- With `autoStop` off (the default), the limit is soft. Runs continue, and `limit.exceeded` shows it was passed.
- With `autoStop` on, once the month's spend reaches the limit, Kiln refuses new runs, and the API refuses new work items with `402`:

```json
{ "error": "budget_exceeded", "message": "Monthly spending budget of $500 has been reached ($512.40 spent)", "limitUsd": 500, "spentUsd": 512.4 }
```

Work items already in progress, or started by webhooks and schedules, move to `blocked` before their next run, with the same message as the reason. Raise the limit or turn off auto-stop to continue. Factory budgets (`budgets.perWorkItemUsd`, `budgets.monthlyUsd`) and policy caps still apply as well. See [Policies and budgets](../configuration/policies-and-budgets.md).

## Related pages

- [Teams and users](teams-and-users.md)
- [Metrics](../measure-and-improve/metrics.md)
- [API reference](../developer-tools/api.md)
