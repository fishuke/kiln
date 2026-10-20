---
title: Automations
description: Start work from forges, chat, trackers, schedules and webhooks with automation files, filters, execution overrides and delivery dedupe.
owner: docs
section: Factory configuration
---

An automation is a file at `automations/<name>/automation.md` (or `automations/<name>.md`) that starts a work item when one of its triggers matches an incoming event.

## An automation file

```markdown
---
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: [acme/web]
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

### Execution overrides

These apply to every run of work this automation starts, over the agent's own settings.

| Key | Effect |
| --- | --- |
| `harness`, `model` | Set one: `harness` replaces the agent's harness and model, `model` keeps the harness. See [Inheritance](agents.md#inheritance). |
| `runner` | A file in `runners/`. |
| `secrets` | Extra secret names, added to the agent's own. |
| `mcpServers` | MCP server names, passed to the run as `KILN_MCP_SERVERS`. |
| `environmentId` | Passed to the run as `KILN_ENVIRONMENT_ID`. |
| `workerHost` | A self-hosted worker, passed as `KILN_WORKER_HOST`. |
| `computerUseModel` | Accepted for compatibility. |
| `idleTimeoutMinutes` | 1–60, passed as `KILN_IDLE_TIMEOUT_MINUTES`. |
| `required_repos` | `owner/name` repositories prepared for every run, even when `deferred` in `factory.yaml`. |

## Triggers

Each trigger has a `provider`, an `event` and an optional `filter`. The providers are `github`, `gitlab`, `azure_devops`, `bitbucket`, `slack`, `teams`, `discord`, `linear`, `jira`, `webhook`, `schedule` and `factory`. Each event accepts its own filter keys, and validation rejects unknown events and keys. The full list is in [Automation triggers](automation-triggers.md).

- One event can match several automations; each starts its own work item.
- An automation fires at most once per delivery, even when several of its triggers match. A GitHub comment with a mention is both `issue_commented` and `issue_mentioned`, but starts one work item per automation.
- Two automations can still both fire for one action: an app mention plus a channel message on the same channel, or a Linear session plus `comment_created`. Pick one.

Ready-made automations for every connected tool, and suggestions such as auto-fixing CI failures, auto-reviewing pull requests or auditing dependencies, are listed by `GET /api/v1/automation-templates` (`?factory=<id>` fills in the alias, Linear teams and Jira projects). `POST /api/v1/factories/<id>/automations/from-template` adds one to a Kiln-managed factory.

## Filters

```yaml
filter:
  repos: [acme/web]                       # bare list: any of these
  labels: { in: [bug], not_in: [wontfix] }
  base_branches: [main, "release/*"]
  skip_bots: self
```

- Every key must match (AND). Within a key, any listed value matches (OR).
- A bare list means `in`. `{ in, not_in }` adds exclusions: `not_in` fails when any of its values is present.
- A missing or empty list adds no restriction, but provider defaults still apply.
- Matching ignores case. `keywords` matches text in the title, body or message. `paths`, `branches` and `base_branches` accept globs (`api/**`, `release/*`).
- Teams `team_ids` and `channel_ids` take only `in`.
- camelCase `baseBranches` and `prNumbers` are accepted, but not next to their snake_case twins.
- Filters decide what starts work. They do not control access.

### Bots

`skip_bots` is `all`, `self` or `none`.

| Value | Skips |
| --- | --- |
| `all` | Events from any bot. The default for GitHub. |
| `self` | Only events from Kiln's own apps. The default everywhere else. |
| `none` | Nothing. Admitting Kiln's own events can cause loops. |

### Alias filters

`teams`, `projects`, `states`, `channels`, `users` and `itemUsers` take plain names instead of IDs, and `issues` takes Linear issue numbers:

```yaml
filter: { teams: [Engineering], states: [Todo] }
```

Kiln resolves the names against the connected provider's directory when you apply the definition, and the apply fails on a name it can't resolve, so connect the provider first. A name list and its ID key (`teams` and `team_ids`) can't be used together. See [Connections](../integrations/connections.md#alias-directory).

## Stage changes

A `factory` trigger reacts when a work item in the same factory changes stage. Filter on `stages`, with task stages or Kiln's states:

| Stage | States |
| --- | --- |
| `TRIAGE` | `received`, `triaging` |
| `SPEC` | `planning`, `awaiting_spec` |
| `IMPLEMENT` | `building`, `awaiting_preview` |
| `REVIEW` | `reviewing`, `handed_off` |
| `COMPLETE` | `complete` |
| `CANCELLED` | `cancelled`, `failed` |

```markdown
---
agent: notifier
triggers:
  - provider: factory
    event: work_item_stage_changed
    filter: { stages: [handed_off] }
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

- `cron` takes five fields (minute, hour, day of month, month, day of week), one of `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`, `@annually`, or `@every <duration>` such as `@every 5m` or `@every 1h30m` (at least one minute).
- Schedules are always UTC. A `CRON_TZ=` or `TZ=` prefix and six-field (seconds) expressions are rejected.
- Fields accept `*`, numbers, ranges (`1-5`), lists (`1,15`) and steps (`*/15`). Day of week runs 0–6 from Sunday; 7 also means Sunday.
- `schedule` is only valid on `schedule`/`cron_fired` triggers. At most one schedule per automation may omit `name`.
- `name` is the schedule's identity (`<factory>/<automation>/<name>`). Changing only `cron` keeps it and its last fire time; changing `name` makes a new schedule. `schedule_ids` is managed by Kiln and can't be set in a definition.
- Kiln checks schedules on each timer tick. A schedule fires once when it is due, even if several due times passed since the last check. The first due time is counted from when Kiln first saw the schedule.

## Webhooks

To accept events from any other system, add a webhook and an automation that names it in `webhook_ids` (exactly one: a file name, a managed webhook's name, or its UID), with an optional `payload` filter on the body:

```markdown
---
triggers:
  - provider: webhook
    event: received
    filter:
      webhook_ids: [sentry]
      payload: { data: { issue: { level: [fatal] } } }
---
Investigate the alert in the payload.
```

The older `filter: { webhook: sentry }` is still accepted. Authentication, delivery rules and the payload filter reference are on [Custom webhooks](../integrations/custom-webhooks.md).

## Test filter

Kiln keeps a log of recent provider deliveries (`GET /api/v1/deliveries`, admins) and of custom webhook deliveries. `POST /api/v1/factories/<id>/automations/<name>/test-filter` with `{ "deliveryId": "<id>" }` evaluates the automation's triggers against one of them and returns `wouldTrigger` with every check's outcome.

## Dedupe and follow-ups

Providers retry deliveries. Kiln remembers each delivery ID (GitHub's `X-GitHub-Delivery`, Slack's `event_id`, Linear's `Linear-Delivery`, Jira's `X-Atlassian-Webhook-Identifier`, GitLab's `X-Gitlab-Event-UUID`, and so on) for 7 days and ignores repeats, across restarts.

Before it starts new work, Kiln checks whether a comment, reply or session message belongs to a work item in flight: the same Slack, Teams or Discord thread, the same Linear session or issue, the same Jira issue, or the same issue or pull request on any forge. If so, the event continues that item. In chat, a plain thread reply continues the work only while the factory's `autoRespondToThreadReplies` is on (the default); otherwise it needs a mention.

- "approve", "approved", "lgtm", "ship it" or "accept" approves an open spec or preview gate.
- "reject", "changes:" or "request changes" rejects it, with the rest of the message as feedback.
- Other text answers an open question. If there is none and an agent is running on the work item, the text steers that run. Otherwise it is added to the conversation for the next agent run.

### Who may decide from a reply

Text in a thread or comment is content, not authority. A reply approves, rejects or answers a gate only when its author is one of the gate's assignees, or the gate has no assignees. Otherwise the reply is treated like any other message.

Gate assignees are people, such as `po@acme.test`, while chat tools and forges report their own user IDs. [Linked accounts](../integrations/connections.md#linked-accounts) map them, and so does the server option `identities`, keyed by `<provider>:<user>`:

```json
{ "slack:U024BE7LH": "po@acme.test", "github:alice": "alice@acme.test" }
```

A mapped reply is recorded under the person's name. An unmapped reply is recorded under the provider's user ID.

Labels, pushes and state changes never continue existing work. A merged pull request, on any forge, completes its work item.

A factory with no automations still answers direct mentions of its alias by starting foreman work.

## Related pages

- [Factory agents](agents.md)
- [Automation triggers](automation-triggers.md)
- [Custom webhooks](../integrations/custom-webhooks.md)
- [Connections](../integrations/connections.md)
- [GitHub](../integrations/github.md)
- [Slack](../integrations/slack.md)
- [Linear](../integrations/linear.md)
- [Jira](../integrations/jira.md)
- [Incident-response factory](../guides/incident-response-factory.md)
