---
title: Linear
description: Start work from Linear agent sessions and issue events, report progress in the session, and let the planning agent create issues with acceptance criteria.
owner: docs
section: Code forges and integrations
---

Linear can start work items, receives the factory's updates as comments on the issue, and is where the planning agent creates roadmap issues.

## Set up

1. Create an OAuth application in Linear (Settings → API) with the redirect URL `<public URL>/oauth/linear/callback` and set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`. Kiln asks for `actor=app`, so the factory appears in Linear as an app you can assign, mention and delegate to.
2. Enable the app's webhook to `POST /webhooks/linear` for Issues, Comments and Agent session events, and store its signing secret as `LINEAR_WEBHOOK_SECRET`. Kiln checks the `Linear-Signature` header and ignores repeated `Linear-Delivery` IDs.
3. Connect Linear once for the workspace. See [Connections](connections.md). Instead of the OAuth flow you can set `LINEAR_ACCESS_TOKEN` to an app token.
4. Add `linear` to the factory's `integrations`, with the teams it works in:

```yaml
integrations:
  - type: linear
    linear: { teams: [Engineering] }
```

A factory uses Linear or Jira, not both.

For the tracker features below (comments, states, planning), Kiln also reads `LINEAR_API_KEY` and `LINEAR_TEAM_ID`.

## Starting work

| Event | Fires when |
| --- | --- |
| `agent_session_created` | Someone assigns, mentions or delegates to the factory's app. |
| `issue_created` | An issue is created. |
| `issue_assigned` | An issue gets an assignee. |
| `issue_labeled` | A label is added. |
| `issue_state_changed` | An issue moves to another workflow state. |
| `comment_created` | A comment is added. |

Filter on `team_ids`, `project_ids`, `state_ids`, `assignee_ids`, `creator_ids`, `labels`, `mentioned_user_ids`, `keywords` (sessions) and `issue_ids` (comments). `teams`, `projects`, `states` and `issues` take names (or issue numbers) instead of IDs; Kiln resolves them when you apply the definition and rejects names it does not know. See [Automation triggers](../configuration/automation-triggers.md).

```markdown
---
triggers:
  - provider: linear
    event: agent_session_created
    filter: { teams: [Engineering] }
---
```

The factory's own activity in Linear never triggers automations.

Listening to both `agent_session_created` and `comment_created` can start two runs for one mention. Use sessions for routing and comments for follow-ups.

## Agent sessions

When work starts from a session, Kiln keeps the session up to date:

- a thought right after the session is created, and one each time the work moves to another stage,
- every agent run's work as it happens: what the agent says and thinks as thoughts, each tool call as an action with its main argument (the file, command, pattern or URL) and a short result, and errors, including why a run failed,
- the factory's messages (questions, gate requests, "Ready to merge") as responses,
- an action and an attachment on the issue when the pull request opens.

Run activity is posted in the order the run produced it. Long text is shortened, secrets are redacted as in the run log, and a failure to reach Linear never fails the run. Bookkeeping events, such as queueing, costs and steering, are not posted.

Replies in the session continue the same work item.

## What Kiln does in Linear

- **Updates.** Gate requests, reminders, "Ready to merge" and "Done" are posted as comments on the issue.
- **Replies.** Comments on the issue continue the work item. A comment starting with `approve` or `reject` decides an open spec or preview gate, and other text answers an open question, steers a running agent, or is added to the conversation. Linear users with an email map to the person with that email; the server's `identities` option (`linear:<user>`) also works. Replies decide a gate only when their author is one of its assignees; see [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).
- **States.** At hand-off, Kiln moves the issue to the team's first `started` state. When the work completes, it moves it to the first `completed` state. To use your own workflow states, name them in the factory's Linear settings. Kiln then moves issues that came from Linear to those states by name, and tells the requester if a name does not exist on the team:

  ```yaml
  integrations:
    - type: linear
      linear: { teams: [Engineering], states: { handoff: "UAT Test", done: Released } }
  ```
- **Duplicates.** Triage reads the team's 20 most recent issues to spot duplicates.

## Planning

The [planning agent](../product-owners/planning.md) creates its roadmap in Linear: one issue per epic, with a sub-issue for each piece of work. The epic is labeled `epic`. Each sub-issue has an "Acceptance criteria" checklist, a `factory:<alias>` label and a "Factory: @<alias>" line. Kiln looks labels up by name and creates any that are missing on the team.

## Related pages

- [Automations](../configuration/automations.md)
- [Connections](connections.md)
- [Planning](../product-owners/planning.md)
- [Jira](jira.md)
- [How Kiln works](../overview/how-kiln-works.md)
