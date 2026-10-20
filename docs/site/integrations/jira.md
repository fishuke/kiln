---
title: Jira
description: Connect Jira Cloud with OAuth, start agent sessions by assigning or mentioning the factory, react to issue events, and create roadmap issues.
owner: docs
section: Code forges and integrations
---

Jira works like Linear in Kiln: issues and comments start or continue work items, updates go back as comments, and the planning agent can create its roadmap in a Jira project.

## Set up

Jira Cloud only.

1. Create an OAuth 2.0 (3LO) app in the Atlassian developer console with the callback URL `<public URL>/oauth/jira/callback` and the scopes `read:jira-work`, `write:jira-work`, `read:jira-user`, `manage:jira-webhook` and `offline_access`. Set `JIRA_CLIENT_ID` and `JIRA_CLIENT_SECRET`.
2. Connect Jira for the workspace. A Jira site admin approves the app. If that is someone else, send them an approval link: it expires in 7 days, and you can resend or revoke it. See [Connections](connections.md#approval-links).
3. Add a Jira webhook pointing at `POST /webhooks/jira?token=<token>` for issue created, issue updated and comment created events, and store the token as `JIRA_WEBHOOK_TOKEN`. Once it is set, Kiln refuses calls that do not carry it. Kiln also ignores repeated `X-Atlassian-Webhook-Identifier` values.
4. Set `JIRA_BOT_ACCOUNT_ID` to the Atlassian account ID that represents the factory. Assigning it, or mentioning it, starts an agent session.
5. Add `jira` to the factory's `integrations`, with its projects. A factory uses Linear or Jira, not both:

```yaml
integrations:
  - type: jira
    jira: { projects: [ENG] }
```

For the tracker features below (comments, states, planning), Kiln reads `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` and `JIRA_PROJECT_KEY` and calls Jira's REST API v3 with basic auth. With `JIRA_CLOUD_ID` and `JIRA_ACCESS_TOKEN` (or the OAuth connection), Kiln can also comment, transition and change labels through the Atlassian API.

## Starting work

| Event | Fires when |
| --- | --- |
| `agent_session_created` | Someone assigns the factory's account, or mentions it in an issue or comment. |
| `issue_created` | An issue is created. |
| `issue_labeled` | Labels are added. |
| `status_changed` | An issue changes status. `status_id` is the new status. |

Filter on `project_keys` and `labels`; sessions also take `keywords` (case-insensitive), and `status_changed` takes `status_ids`. See [Automation triggers](../configuration/automation-triggers.md).

```markdown
---
triggers:
  - provider: jira
    event: agent_session_created
    filter:
      project_keys: [ENG]
      keywords: [investigate, fix]
---
```

The issue key, such as `ENG-42`, links the work item to the issue. Other comments on that issue continue the work item. Jira events reach every factory that opted in to Jira, so filter on `project_keys`.

## What Kiln does in Jira

- **Updates.** Gate requests, reminders, "Ready to merge" and "Done" are posted as comments.
- **Actions.** Through the Atlassian API Kiln can post comments, transition an issue by status name, and add or remove labels.
- **Replies.** Comments on the issue continue the work item. They decide an open spec or preview gate, answer an open question, steer a running agent, or are added to the conversation. Jira users with an email map to the person with that email; the server's `identities` option (`jira:<user>`) also works. Replies decide a gate only when their author is one of its assignees; see [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).
- **States.** At hand-off, Kiln moves the issue through the first transition into the "In Progress" status category. On completion, it uses the first transition into the "Done" category.
- **Duplicates.** Triage reads the project's 20 most recently created issues to spot duplicates.
- **Text.** Kiln writes descriptions and comments in Atlassian Document Format, one paragraph per blank-line-separated block.

## Planning

The [planning agent](../product-owners/planning.md) can create its roadmap in the Jira project: a Task per epic, labeled `epic`, with a Sub-task for each piece of work. Each sub-task has an acceptance criteria checklist and a `factory:<alias>` label.

## Related pages

- [Automations](../configuration/automations.md)
- [Connections](connections.md)
- [Linear](linear.md)
- [Planning](../product-owners/planning.md)
- [How Kiln works](../overview/how-kiln-works.md)
