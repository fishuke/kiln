---
title: Slack
description: Send work to a factory by mentioning its alias in Slack, follow progress in the thread, and approve specs and previews with a reply.
owner: docs
section: Code forges and integrations
---

In Slack, you mention a factory's alias to start work, and the whole work item then lives in that thread: questions, approvals, the preview and the pull request link.

## Set up

1. Create a Slack app with a bot user and the `chat:write` scope. Give Kiln the bot token.
2. Turn on Event Subscriptions with the request URL `POST /webhooks/slack`. Kiln answers Slack's URL verification challenge.
3. Subscribe to the bot events `app_mention`, `message.channels`, `message.im` and `reaction_added`.
4. Store the app's signing secret in Kiln as `SLACK_SIGNING_SECRET`.
5. Add `slack` to the factory's `integrations` and invite the bot to the channels you use.

Kiln checks Slack's signature and refuses requests whose timestamp is more than five minutes old. It answers Slack right away and does the work in the background. Retries with the same `event_id` are ignored.

## Starting work

Mention the factory's alias:

```text
@webapp the footer link to /pricing is broken
```

The first line becomes the work item's title, and the rest becomes its body. A list of bulleted requirements in the body helps triage size the request.

A factory with no automations answers mentions of its alias. To control it, add an automation:

```markdown
---
triggers:
  - provider: slack
    event: app_mention
    filter: { channel: [C0123ABCD] }
---
```

Without a `mentioned` filter, an `app_mention` trigger fires only for the factory named in the message, or for every factory when the message only mentions the bot.

| Event | Fires when |
| --- | --- |
| `app_mention` | The bot is mentioned. |
| `direct_message` | Someone sends the bot a direct message. |
| `thread_reply` | Someone replies in a thread. |
| `reaction_added` | Someone adds a reaction. `reaction` holds its name. |

Messages from bots are ignored.

## Working in the thread

Kiln posts to the thread where the work started:

- questions and gate requests, such as "Approve the spec", with the details and a link to decide in the inbox,
- reminders when a gate waits past its nudge time,
- "Ready to merge" with the pull request and preview links,
- "Done" when the pull request is merged.

Reply in the thread to act on the work item:

| Reply starts with | Effect |
| --- | --- |
| `approve`, `approved`, `lgtm`, `ship it` or `accept` | Approves the open spec or preview gate. |
| `reject`, `changes:` or `request changes` | Rejects it. The rest of your message is the feedback. |
| Anything else | Answers an open question. If there is none and an agent is running on the work item, it steers that agent. Otherwise it is added to the conversation for the next agent run. |

Approve, reject and answer only count when you are one of the gate's assignees, or the gate has none. Kiln matches your Slack user to a person through the server's `identities` map, for example `slack:U024BE7LH` to `po@acme.test`. Without a mapping, your Slack user ID must itself be an assignee. Replies that cannot decide the gate are handled like other text. See [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

Decisions from Slack are recorded with your person (or Slack user ID) and `slack` as the surface, exactly like decisions from the web.

Steering from the thread works like steering from the run page. See [Harnesses](../infrastructure/harnesses.md#steering).

## Related pages

- [Automations](../configuration/automations.md)
- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Inbox](../management/inbox.md)
- [How Kiln works](../overview/how-kiln-works.md)
