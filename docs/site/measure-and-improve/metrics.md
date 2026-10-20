---
title: Dashboard metrics
description: The metrics Kiln computes per factory, such as PR activity, autonomy, cycle time, cost per merged PR and pass rate, and how each one is defined.
owner: docs
section: Measure and improve
---

Kiln computes every factory metric from stored work items, runs and scores, so the dashboard, the API and the Kiln MCP always show the same numbers.

## The window

Metrics cover work items and runs created in a window, by default the last 30 days. You can pass another start date. You can also limit run metrics to one agent.

## Factory metrics

| Metric | Definition |
| --- | --- |
| PRs opened | Work items in the window that have a pull request. |
| PRs merged | Work items that are `complete` because their pull request merged. |
| Autonomy | The share of merged work items whose only human touch was the original request. |
| Autonomous merged | The number of those work items. |
| Human touches per PR | The average number of human touches on work items with a pull request. |
| Cycle time (median) | The median hours from a merged work item's creation to its completion. |
| Cost | The sum of run costs in the window, in USD. |
| Cost per merged PR | Cost divided by PRs merged. Empty when nothing merged. |
| Work items | Total, active, complete, blocked and cancelled counts. |

A **human touch** is the original request, every message a person adds, every gate decision and every steering message.

Values are rounded to two decimals.

## Per agent

For each agent with runs in the window:

| Metric | Definition |
| --- | --- |
| Runs | Number of runs. |
| Cost | Sum of the agent's run costs. |
| Cost per merged PR | The agent's cost divided by the number of merged work items it worked on. |
| Scored | Number of scores for the agent's runs. |
| Pass rate | Share of those scores that passed. |

## Per definition

For each definition SHA used by work items in the window: the number of work items, the pass rate of scores recorded under it, and the cost of runs under it. During a [canary](replay-and-canary.md), this is how you compare the candidate with the applied definition.

## Across factories

The [portfolio](../management/portfolio.md) adds these metrics up per project and across all factories.

## Raw data

For your own views, Kiln returns the raw rows for runs, scores or work items of a factory since a date. An agent can use the Kiln MCP's metrics tools to answer questions such as "cost per merged PR by agent last week". See the [API overview](../developer-tools/api.md) and the [MCP reference](../developer-tools/mcp.md).

## Dashboard API

The dashboard reads these endpoints. All take `start_date` (inclusive) and `end_date` (exclusive) as RFC 3339 times, default to the last 30 days, and with `group_by_period=day|week|month` (weeks start on Sunday) add a `series`. Most add `deltas` against the previous period of the same length.

| Endpoint | What it returns |
| --- | --- |
| `GET /factories/{id}/metrics` | `runCount`, `prCount`, `mergedPrCount`, `autonomy`, the autonomy funnel (merged, merged without a human code change, per repo), impact (additions and deletions of merged PRs), PR latency medians (kickoff → PR → first review → merge), average human interactions per PR. |
| `GET /factories/{id}/costs/per-pr` | PRs opened in the range, total, mean and median cost. With your own keys all spend is `inference`. |
| `GET /factories/{id}/costs/breakdown?group_by=source\|user\|agent\|model` | Spend per group. `source` and `user` roll up to the root run. |
| `GET /factories/{id}/costs/per-pr/top?limit=20` | The most expensive PRs. |
| `GET /factories/{id}/costs/per-pr/by-size` | Cost by PR size: S < 100, M < 500, L < 1000, XL ≥ 1000 changed lines. |
| `GET /factories/{id}/metrics/run-breakdown?group_by=agent_type\|status\|source\|root_vs_subrun\|model\|harness` | Run counts per group (source counts top-level runs only). |
| `GET /factories/{id}/pull-requests` | Every PR the factory produced: state, timing, size, human interactions, runs and cycle times; filter by `repo`, `state`, opened/merged dates and `updated_after` for incremental sync. |

A PR counts as autonomous when no person pushed code to it; handing a task back from a local worktree marks its PR as changed by a person.

## Related pages

- [Scorers](scorers.md)
- [Replay and canary](replay-and-canary.md)
- [Portfolio and projects](../management/portfolio.md)
- [Policies and budgets](../configuration/policies-and-budgets.md)
