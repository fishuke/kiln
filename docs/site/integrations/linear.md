---
title: Linear
description: Start work from Linear issues and agent sessions, get updates as comments, and let the planning agent create issues with acceptance criteria.
owner: docs
section: Code forges and integrations
---

Linear can start work items, receives the factory's updates as comments on the issue, and is where the planning agent creates roadmap issues.

## Set up

1. Create a Linear API key and note the ID of the team the factory works with. Kiln uses the key for comments, state changes, recent issues and new issues.
2. Add a webhook in Linear pointing at `POST /webhooks/linear` for Issue and Comment events, and for agent session events if you use Linear's agent features.
3. Store the webhook's signing secret in Kiln as `LINEAR_WEBHOOK_SECRET`. Kiln checks the `Linear-Signature` header and ignores repeated `Linear-Delivery` IDs.
4. Add `linear` to the factory's `integrations`.

## Starting work

| Event | Fires when |
| --- | --- |
| `issue_created` | An issue is created. |
| `issue_assigned` | An issue's assignee changes. |
| `issue_mentioned` | A comment is added. `mentioned` holds the `@handles` in it. |
| `agent_session_created` | Someone starts an agent session on an issue, for example by assigning or mentioning the factory's agent. |

Filter on `team_ids`, `labels`, `mentioned` or `assignee`:

```markdown
---
triggers:
  - provider: linear
    event: agent_session_created
    filter: { team_ids: [391c8fd6-4bb1-4493-ae5d-02b01ce045e2] }
---
```

A comment that mentions the factory's alias starts foreman work in a factory with no automations.

## What Kiln does in Linear

- **Updates.** Gate requests, reminders, "Ready to merge" and "Done" are posted as comments on the issue.
- **Replies.** Comments on the issue continue the work item. A comment starting with `approve` or `reject` decides an open spec or preview gate, and other text answers an open question. See [Automations](../configuration/automations.md#dedupe-and-follow-ups).
- **States.** At hand-off, Kiln moves the issue to the team's first `started` state. When the work completes, it moves it to the first `completed` state.
- **Duplicates.** Triage reads the team's 20 most recent issues to spot duplicates.

## Planning

The [planning agent](../product-owners/planning.md) creates its roadmap in Linear: one issue per epic, labeled `epic`, with a child issue for each piece of work. Each child issue has an "Acceptance criteria" checklist, a `factory:<alias>` label and a line naming the factory.

## Related pages

- [Automations](../configuration/automations.md)
- [Planning](../product-owners/planning.md)
- [Jira](jira.md)
- [How Kiln works](../overview/how-kiln-works.md)
