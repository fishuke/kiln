---
title: Portfolio and projects
description: Group factories into projects, roll up their metrics in the portfolio, and plan roadmaps across them.
owner: docs
section: Management
---

A project groups the factories that serve one product or goal, and the portfolio rolls up their work, cost and pending decisions across every project.

## Projects

A project has a name, an owner and a list of factories, for example "Customer portal" with `webapp`, `api` and `mobile`. Creating a project links each listed factory to it.

To create a project through the API, your token needs `send` on every factory in it. The creator becomes the owner.

A work item sent through the API can name a project.

Each project can hold one roadmap from the [plan agent](../product-owners/planning.md). Making a new plan replaces the project's current roadmap.

## The portfolio

For each project, the portfolio shows each factory's [metrics](../measure-and-improve/metrics.md) and these totals:

| Total | Meaning |
| --- | --- |
| PRs opened | Work items with a pull request, across the project's factories |
| PRs merged | Work items completed by a merge |
| Cost | Run costs in USD |
| Active work items | Work items not yet complete, cancelled or failed |
| Pending decisions | Open gates in the project's factories |

Across all factories it also shows the number of factories, PRs merged, cost and active work items.

Metrics cover the last 30 days by default. You can pass another start date.

## Weekly digest

The digest tells each person which decisions are waiting on them, oldest first, with a link to each one. See [Inbox](inbox.md#weekly-digest).

## Related pages

- [Planning](../product-owners/planning.md)
- [Dashboard metrics](../measure-and-improve/metrics.md)
- [Inbox](inbox.md)
- [Admin, RBAC and audit](admin-rbac-audit.md)
