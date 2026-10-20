---
title: Slack
description: Send work to a factory by mentioning its alias in Slack, follow progress in the thread, and approve specs and previews with a reply.
owner: docs
section: Code forges and integrations
---

In Slack, you mention a factory's alias to start work, and the whole work item then lives in that thread: questions, approvals, the preview and the pull request link.

## Set up

1. Create a Slack app with a bot user and these bot scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `chat:write.customize`, `groups:history`, `im:history`, `im:write`, `mpim:history`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`.
2. Turn on Event Subscriptions with the request URL `POST /webhooks/slack`. Kiln answers Slack's URL verification challenge.
3. Subscribe to the bot events `app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`, `member_joined_channel`, `reaction_added` and `app_home_opened`, and enable the Home tab.
4. Store the app's signing secret in Kiln as `SLACK_SIGNING_SECRET`.
5. Install the app:
   - **Add to Slack.** Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, add `<public URL>/oauth/slack/callback` as a redirect URL, and start the connection. If your workspace requires admin approval, an admin approves the request first. See [Connections](connections.md).
   - **Or a token.** Install the app yourself and set `SLACK_BOT_TOKEN`, or paste the token and signing secret when you connect.
6. Add `slack` to the factory's `integrations` and invite the bot to the channels you use. Private channels always need an invite.

Kiln checks Slack's signature and refuses requests whose timestamp is more than five minutes old. It answers Slack right away and does the work in the background. Retries with the same `event_id` are ignored.

## Starting work

Mention the factory's alias:

```text
@webapp the footer link to /pricing is broken
```

The first line becomes the work item's title, and the rest becomes its body. Kiln reacts with 👀 to the message that started or continued work.

A factory with no automations answers mentions of its alias. To control it, add an automation:

```markdown
---
triggers:
  - provider: slack
    event: app_mention
    filter: { channel_ids: [C0123ABCD], keywords: [bug] }
---
```

When a message names a factory's alias, only that factory gets it. A message that only mentions the bot reaches every factory listening in that channel.

| Event | Fires when |
| --- | --- |
| `app_mention` | The bot is mentioned. |
| `message_dm`, `message_im` | Someone sends the bot a direct message. Both fire for the same message. |
| `message_mpim` | A message in a group DM the bot is in. |
| `message_posted` | A message in a channel the bot is in, including thread replies. |
| `member_joined_channel` | Someone joins a channel. |
| `reaction_added` | Someone adds a reaction. `emoji` holds its name. |

Filters: `channel_ids`, `user_ids`, `keywords`, and for reactions `emojis` and `item_user_ids` (who wrote the message). `channels`, `users` and `itemUsers` take names instead of IDs and are resolved when you apply the definition. See [Automation triggers](../configuration/automation-triggers.md).

Messages from bots are ignored. An app mention in a channel where you also listen to `message_posted` produces two events; Kiln continues work once, but two automations can both fire.

## Factory settings

```yaml
integrations:
  - type: slack
    slack: { autoRespondToThreadReplies: false, channels: [C0123ABCD] }
```

- `autoRespondToThreadReplies` (default `true`): plain replies in a factory's thread continue the work. When `false`, replies must mention the app. DMs are unchanged.
- `channels`: the channel IDs this factory listens in. DMs always reach it.

Kiln posts as the factory, using its name. Set `KILN_FACTORY_AVATAR_URL` to a URL template with `{alias}`, such as `https://cdn.acme.test/factories/{alias}.png`, to give each factory its own avatar.

## Home tab

Opening the app's Home tab shows the work you asked for, grouped by stage (Triage, Planning, Building, Reviewing, Complete, Cancelled), newest first, with links to the web app.

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

Approve, reject and answer only count when you are one of the gate's assignees, or the gate has none. Kiln matches your Slack user to a person through a [linked account](connections.md#linked-accounts) (mention the app with `sign in`, or DM it `sign in`) or the server's `identities` map, for example `slack:U024BE7LH` to `po@acme.test`. Without a mapping, your Slack user ID must itself be an assignee. Replies that cannot decide the gate are handled like other text. See [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

Decisions from Slack are recorded with your person (or Slack user ID) and `slack` as the surface, exactly like decisions from the web.

Steering from the thread works like steering from the run page. See [Harnesses](../infrastructure/harnesses.md#steering).

## Related pages

- [Automations](../configuration/automations.md)
- [Connections](connections.md)
- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Inbox](../management/inbox.md)
- [How Kiln works](../overview/how-kiln-works.md)
