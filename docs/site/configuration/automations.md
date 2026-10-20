---
title: Automations
description: Start work from GitHub, Slack, Linear, Jira, schedules and webhooks with automation files, filters and delivery dedupe.
owner: docs
section: Factory configuration
---

An automation is a file at `automations/<name>/automation.md` that starts a work item when one of its triggers matches an incoming event.

## An automation file

```markdown
---
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repo: [acme/web]
      labels: [kiln-ready]
---
Take the labeled issue through the factory.
```

The body is the automation's prompt. Kiln appends it to the work item's body as `Automation "<name>": <prompt>`.

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Disabled automations never fire. |
| `agent` | the foreman | When this is the `FOREMAN` agent, the work item takes the foreman's path. Any other agent runs directly on the work item. |
| `displayName` | none | |
| `triggers` | required | At least one. |
| `harness`, `model`, `runner`, `secrets`, `mcpServers`, `environmentId` | inherited from the agent | Override settings for work this automation starts. See [Inheritance](agents.md#inheritance). |

## Triggers

Each trigger has a `provider`, an `event`, and an optional `filter`. Schedule triggers also need `schedule`.

| Provider | Events Kiln produces |
| --- | --- |
| `github` | `issue_opened`, `issue_labeled`, `issue_assigned`, `issue_mentioned`, `pull_request_mentioned`, `pull_request_opened`, `pull_request_labeled`, `pull_request_review_submitted`, `pull_request_merged`, `pull_request_closed`, `check_suite_completed`, `push` |
| `slack` | `app_mention`, `direct_message`, `thread_reply`, `reaction_added` |
| `linear` | `issue_created`, `issue_assigned`, `issue_mentioned`, `agent_session_created` |
| `jira` | `issue_created`, `issue_assigned`, `issue_mentioned` |
| `schedule` | any event name you choose, such as `cron_fired` |
| `webhook` | `received` |
| `factory` | `work_item_stage_changed` |

The schema also accepts the providers `gitlab` and `kiln`. Kiln does not produce events for them yet.

A Slack `app_mention` trigger without a `mentioned` filter only fires for the factory whose alias is mentioned, or for every factory when the message only mentions the bot.

## Filters

A filter compares its keys with fields of the event. Matching ignores case.

```yaml
filter:
  labels: [kiln-ready, bug]          # the event has at least one of these
  in: { team_ids: [TEAM-UUID] }      # explicit form of the same rule
  not_in: { labels: [wontfix] }      # the event has none of these
```

- A plain key matches when the event's value, or any item of it, is in the list. An empty list matches anything.
- `in` holds keys with the same "at least one" rule.
- `not_in` holds keys whose values must all be absent.
- Every key must match.

Fields you can filter on:

| Provider | Fields |
| --- | --- |
| GitHub | `repo` (`owner/name`), `repos` (the same, as a list; GitHub events carry both `repo` and `repos`), `number`, `labels`, `label` (the label just added), `mentioned`, `author`, `assignee`, `head` (branch), `state` (review state), `conclusion` |
| Slack | `channel`, `mentioned`, `author`, `reaction` |
| Linear | `team_ids`, `labels`, `mentioned`, `assignee` |
| Jira | `project`, `labels`, `mentioned`, `assignee` |

`mentioned` holds the lowercased `@handles` found in the text.

## Stage changes

A `factory` trigger reacts when a work item in the same factory changes state. Its event carries `from`, `to` and `workItemId`, so you can filter on them:

```markdown
---
agent: notifier
triggers:
  - provider: factory
    event: work_item_stage_changed
    filter: { to: [handed_off] }
---
Summarize the handed-off work for the release notes.
```

- Only automations of the factory where the change happened fire. Other factories never see it.
- The new work item's title is the original title followed by `→ <state>`, and its body is the original body.
- Work started this way has the automation name `stage:<name>` as its source. Its own state changes do not trigger stage automations again, so there are no loops.

## Schedules

```yaml
triggers:
  - provider: schedule
    event: cron_fired
    schedule: { cron: "0 9 * * 1", name: weekly }
```

- `cron` takes five fields (minute, hour, day of month, month, day of week) in UTC, or one of `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`, `@annually`.
- Fields accept `*`, numbers, ranges (`1-5`), lists (`1,15`) and steps (`*/15`). Day of week runs 0–6 from Sunday; 7 also means Sunday.
- Kiln checks schedules on each timer tick. A schedule fires once when it is due, even if several due times passed since the last check.
- The first due time is counted from when Kiln first saw the schedule, not from the past.
- `name` identifies the schedule. Keep it stable, or Kiln treats the schedule as new.

## Webhooks

To accept events from any other system, add a webhook file and an automation that names it.

```yaml
# webhooks/sentry.yaml
authMode: signature
signatureScheme: sentry
secretName: SENTRY_WEBHOOK_SECRET
deliveryIdHeader: request-id
```

```markdown
---
agent: foreman
triggers:
  - provider: webhook
    event: received
    filter: { webhook: sentry }
---
Investigate the alert in the payload.
```

The endpoint is `POST /webhooks/<factory>/<webhook-name>`. The secret is read from Kiln's secrets store by `secretName`, or from the server's environment variable `KILN_SECRET_<secretName>`. A missing secret rejects every call.

| `authMode` | The caller sends |
| --- | --- |
| `token` (default) | `Authorization: Bearer <secret>` |
| `url_token` | `?token=<secret>` in the URL |
| `signature` | A signature header, checked by `signatureScheme`. See below. |

| `signatureScheme` | Header and check |
| --- | --- |
| `github` | `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the body>` |
| `standard_webhooks` | `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,<base64 HMAC>` over `<id>.<timestamp>.<body>`). A `whsec_` secret prefix is accepted. |
| `stripe` | `Stripe-Signature: t=<time>,v1=<hex HMAC-SHA256 of "<time>.<body>">`. Signatures older than five minutes are refused. |
| `sentry` | `Sentry-Hook-Signature: <hex HMAC-SHA256 of the body>` |

`signatureScheme` is required when `authMode` is `signature`. The work item's title comes from the payload's `title` or `summary` field, and the body is the payload. A `webhook` trigger without `filter.webhook` naming a file in `webhooks/` fails validation.

## Dedupe and follow-ups

Providers retry deliveries. Kiln remembers each delivery ID (GitHub's `X-GitHub-Delivery`, Slack's `event_id`, Linear's `Linear-Delivery`, Jira's `X-Atlassian-Webhook-Identifier`, or your webhook's `deliveryIdHeader`) for 24 hours and ignores repeats.

Before it starts new work, Kiln checks whether the event belongs to a work item in flight: the same Slack thread, the same Linear or Jira issue, or the same GitHub issue or pull request. If so, the event continues that item:

- "approve", "approved", "lgtm", "ship it" or "accept" approves an open spec or preview gate.
- "reject", "changes:" or "request changes" rejects it, with the rest of the message as feedback.
- Other text answers an open question. If there is none and an agent is running on the work item, the text steers that run. Otherwise it is added to the conversation for the next agent run.

### Who may decide from a reply

Text in a thread or comment is content, not authority. A reply approves, rejects or answers a gate only when its author is one of the gate's assignees, or the gate has no assignees. Otherwise the reply is treated like any other message.

Gate assignees are people, such as `po@acme.test`, while Slack and the forges report their own user IDs. The server option `identities` maps one to the other, keyed by `<provider>:<user>`:

```json
{ "slack:U024BE7LH": "po@acme.test", "github:alice": "alice@acme.test" }
```

A mapped reply is recorded under the person's name. An unmapped reply is recorded under the provider's user ID.

Labeled events never continue existing work. A merged pull request completes its work item.

A factory with no automations still answers mentions of its alias in Slack, GitHub, Linear and Jira by starting foreman work.

## Related pages

- [Factory agents](agents.md)
- [GitHub](../integrations/github.md)
- [Slack](../integrations/slack.md)
- [Linear](../integrations/linear.md)
- [Jira](../integrations/jira.md)
- [Incident-response factory](../guides/incident-response-factory.md)
