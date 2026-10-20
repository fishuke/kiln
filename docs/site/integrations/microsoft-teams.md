---
title: Microsoft Teams
description: Mention the Kiln bot in a Teams channel to start work, follow it in the thread, and link your account with sign in.
owner: docs
section: Code forges and integrations
---

In Microsoft Teams, you mention the Kiln bot in a connected channel to start work, and the work item lives in that thread.

## Set up

Three people are usually involved: a Kiln admin connects the bot, a Teams admin or team owner uploads and approves the app, and a factory editor picks the teams and channels.

1. Register a bot in Azure (an Azure Bot resource, single or multi tenant) and create a client secret.
2. Set its messaging endpoint to `POST /webhooks/teams` and enable the Microsoft Teams channel.
3. Give Kiln `TEAMS_APP_ID` (the bot's app ID) and `TEAMS_APP_PASSWORD` (the client secret). For a single-tenant bot, also set `TEAMS_TENANT_ID`. Or connect it from the API; see [Connections](connections.md).
4. Download the app package: `GET /api/v1/integrations/teams/app-package` (admin). It is a zip with `manifest.json` and two icons, `color.png` (192×192) and `outline.png` (32×32), and no executables. Query `name`, `developer`, `website` and `color` to customize it.
5. In the Teams admin center, choose Teams apps → Manage apps → Upload new app, upload the zip, and approve it.
6. Add the app to each team (Apps → Built for your org).
7. In each factory, select the teams and at least one standard channel per team:

```yaml
integrations:
  - type: microsoft-teams
    microsoft-teams:
      autoRespondToThreadReplies: true
      teams:
        - { teamId: 6b1f0000-0000-0000-0000-000000000001, channelIds: ["19:abc@thread.tacv2"] }
```

Kiln validates every call's Bot Framework token: the signature against Microsoft's published keys, the issuer, the audience (your app ID), the expiry, and that the token's service URL matches the activity.

## Starting work

Mention the bot with your request:

```text
@Kiln the export button times out on large reports
```

| Event | Fires when |
| --- | --- |
| `app_mention` | The bot is mentioned in a connected channel. |
| `message_posted` | Another message the bot can see in that channel. |

Filters: `team_ids` (exactly one Teams team ID), `channel_ids` (at least one `19:…@thread.tacv2` ID), `keywords` and `user_ids`. `team_ids` and `channel_ids` take only `in`. See [Automation triggers](../configuration/automation-triggers.md).

Replies in the thread continue the work. With `autoRespondToThreadReplies: false`, a reply must mention the bot.

If a channel isn't connected to any factory, the bot answers: "This Microsoft Teams channel isn't connected to a Kiln factory. Connect this team to a factory, then mention this bot again."

## Commands

| Message | Does |
| --- | --- |
| `@Kiln sign in` | Replies with a one-hour link that connects your Teams account to your Kiln account, so your replies can decide gates. |
| `@Kiln sign out` | Unlinks your account from every factory in that Microsoft organization. |
| `@Kiln help` | Explains how to use the bot and lists the factories connected to the channel. |

## Scope and limits

- Standard and shared channels only: no private channels and no DMs. Add shared channels by channel ID in `factory.yaml`.
- The bot replies in the thread where the work started and can post top-level messages. It cannot DM people, react to messages or upload files.

## Related pages

- [Connections](connections.md)
- [Slack](slack.md)
- [Automations](../configuration/automations.md)
