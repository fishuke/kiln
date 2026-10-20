---
title: Discord
description: Send work to a factory with the /kiln slash command or a mention in Discord, and follow it in a thread.
owner: docs
section: Code forges and integrations
---

In Discord, you run `/kiln` or mention the bot to start work, and the factory continues in a thread on that message.

## Set up

1. Create an application at the Discord developer portal and add a bot. Copy the application ID, the public key and the bot token.
2. Set the Interactions Endpoint URL to `POST /webhooks/discord`. Discord checks it with a signed ping, which Kiln answers.
3. Give Kiln `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`, or connect Discord from the API with the same values; see [Connections](connections.md).
4. Register the command: `POST /api/v1/integrations/discord/commands` (admin). Pass `{ "guildId": "<server id>" }` to register it in one server right away; global registration can take up to an hour.
5. Add the bot to your server with the install link the connection returns. It asks for: view channels, send messages, send messages in threads, create public threads, read message history and add reactions.
6. Add `discord` to the factory's `integrations`, optionally limited to servers and channels:

```yaml
integrations:
  - type: discord
    discord: { guildIds: ["1180000000000000000"], channelIds: ["1180000000000000001"] }
```

Kiln verifies the `X-Signature-Ed25519` signature over `X-Signature-Timestamp` and the body, and refuses timestamps more than five minutes old.

## Starting work

```text
/kiln prompt: Fix the flaky checkout test  factory: webapp
```

`factory` is optional; use it when several factories listen in the channel. Kiln replies "On it: …" right away, starts the work, and opens a thread on its reply where the work continues. When no factory picks it up, it says so.

| Event | Fires when |
| --- | --- |
| `slash_command` | Someone runs `/kiln`. |
| `app_mention` | A message mentions the bot (gateway bridge). |
| `message_posted` | Another message in a channel the bot reads (gateway bridge). |
| `reaction_added` | Someone adds a reaction (gateway bridge). |

Filters: `guild_ids`, `channel_ids`, `user_ids`, `keywords`, and `emojis` for reactions. See [Automation triggers](../configuration/automation-triggers.md).

## Mentions, messages and reactions

Discord only sends slash commands to an interactions endpoint. For mentions, messages and reactions, run a small bridge on the Discord gateway that forwards `MESSAGE_CREATE` and `MESSAGE_REACTION_ADD` dispatches (`{ "t": ..., "d": ... }`) to `POST /webhooks/discord/events` with `Authorization: Bearer <DISCORD_EVENTS_TOKEN>`. Set `DISCORD_BOT_USER_ID` (or connect Discord) so Kiln can tell mentions of the bot apart. Kiln reacts with 👀 and starts a thread on a mention that starts work.

Replies in the work's thread continue it. With `autoRespondToThreadReplies: false`, a reply must mention the bot.

## Decisions

Buttons with the custom IDs `kiln:approve:<gate id>` and `kiln:reject:<gate id>` decide a gate. Only the gate's assignees can use them. Run `/kiln prompt: sign in` to link your Discord account so Kiln knows who you are.

## Related pages

- [Connections](connections.md)
- [Slack](slack.md)
- [Automations](../configuration/automations.md)
