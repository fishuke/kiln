---
title: Jira
description: Start work from Jira issues and comments, post updates back to the issue, and create roadmap issues in a Jira project.
owner: docs
section: Code forges and integrations
---

Jira works like Linear in Kiln: issues and comments start or continue work items, updates go back as comments, and the planning agent can create its roadmap in a Jira project.

## Set up

1. Create a Jira API token for a service account. Give Kiln the site URL, the account's email, the token and the project key. Kiln calls Jira's REST API v3 with basic auth.
2. Add a Jira webhook pointing at `POST /webhooks/jira?token=<token>` for issue created, issue updated and comment created events.
3. Store the same token in Kiln as `JIRA_WEBHOOK_TOKEN`. Once it is set, Kiln refuses calls that do not carry it. Kiln also ignores repeated `X-Atlassian-Webhook-Identifier` values.
4. Add `jira` to the factory's `integrations`.

## Starting work

| Event | Fires when |
| --- | --- |
| `issue_created` | An issue is created. |
| `issue_assigned` | An issue is updated and its assignee changed. Other updates are ignored. |
| `issue_mentioned` | A comment is added. `mentioned` holds the `@handles` in it. |

Filter on `project`, `labels`, `mentioned` or `assignee`:

```markdown
---
agent: foreman
triggers:
  - provider: jira
    event: issue_created
    filter:
      project: [KIL]
      labels: [kiln]
---
```

The issue key, such as `KIL-42`, links the work item to the issue.

## What Kiln does in Jira

- **Updates.** Gate requests, reminders, "Ready to merge" and "Done" are posted as comments.
- **Replies.** Comments on the issue continue the work item, decide an open spec or preview gate, or answer an open question. See [Automations](../configuration/automations.md#dedupe-and-follow-ups).
- **States.** At hand-off, Kiln moves the issue through the first transition into the "In Progress" status category. On completion, it uses the first transition into the "Done" category.
- **Duplicates.** Triage reads the project's 20 most recently created issues to spot duplicates.
- **Text.** Kiln writes descriptions and comments in Atlassian Document Format, one paragraph per blank-line-separated block.

## Planning

The [planning agent](../product-owners/planning.md) can create its roadmap in the Jira project: a Task per epic, labeled `epic`, with a Sub-task for each piece of work. Each sub-task has an acceptance criteria checklist and a `factory:<alias>` label.

## Related pages

- [Automations](../configuration/automations.md)
- [Linear](linear.md)
- [Planning](../product-owners/planning.md)
- [How Kiln works](../overview/how-kiln-works.md)
