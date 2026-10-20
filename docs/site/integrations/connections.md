---
title: Connections
description: Connect each external system once for the workspace, opt factories in from factory.yaml, link people's accounts, and see where a factory can reach someone.
owner: docs
section: Code forges and integrations
---

Kiln connects to each external system once for the whole workspace. Each factory then opts in to the systems it uses in `factory.yaml`, with its own settings.

## Workspace connections

A connection holds a provider's account details, scopes and credentials. Credentials are stored as encrypted Kiln secrets named `KILN_CONN_<PROVIDER>_<KEY>` and are never returned by the API.

| Provider | How it connects |
| --- | --- |
| `github` | GitHub App installation. See [GitHub](github.md). |
| `gitlab` | Group manager token. See [GitLab](gitlab.md). |
| `azure_devops` | Organization and personal access token. See [Azure DevOps](azure-devops.md). |
| `bitbucket` | Workspace and access token. See [Bitbucket](bitbucket.md). |
| `slack` | "Add to Slack" OAuth, or a pasted bot token. See [Slack](slack.md). |
| `microsoft-teams` | Bot app id and client secret. See [Microsoft Teams](microsoft-teams.md). |
| `discord` | Application id, public key and bot token. See [Discord](discord.md). |
| `linear` | OAuth app. See [Linear](linear.md). |
| `jira` | OAuth 2.0 (3LO), optionally approved by a site admin. See [Jira](jira.md). |

A connection's status is `connected`, `pending_approval` (an approval link is out) or `error` (the last test or completion failed, with the message).

Admins manage connections through the API:

| Call | Does |
| --- | --- |
| `GET /api/v1/connections` | Every provider, whether it is available on this server, and its connection. |
| `POST /api/v1/connections/<provider>/start` | Returns a `state`, the setup steps, and an OAuth or install `url` when the provider has one, or the `fields` to fill in. |
| `POST /api/v1/connections/<provider>/complete` | Finishes with `{ code, state }` from OAuth, or `{ params }` with the fields. |
| `POST /api/v1/connections/<provider>/test` | Calls the provider with the stored credentials. |
| `DELETE /api/v1/connections/<provider>` | Disconnects and deletes the stored credentials. |

OAuth providers send the browser back to `GET /oauth/<provider>/callback`, which finishes the connection and redirects to the web app's integrations page. The `state` expires after 30 minutes and works once.

Kiln builds adapters from a connection's credentials as soon as it is connected, so you do not restart the server. Providers configured with environment variables work the same way and take precedence.

### Approval links

Some connections need an admin of the other system, such as a Jira site admin. Send them an approval link instead of connecting yourself:

| Call | Does |
| --- | --- |
| `POST /api/v1/connections/<provider>/approval-links` | Creates a link, optionally for an `email`. Returns its `url`. The connection shows `pending_approval`. |
| `GET /api/v1/connections/<provider>/approval-links` | Lists links and their state: `open`, `used` or `revoked`. |
| `POST /api/v1/approval-links/<id>/resend` | Issues a new token and another 7 days. The old URL stops working. |
| `DELETE /api/v1/approval-links/<id>` | Revokes the link. |

A link expires 7 days after it is created or resent. The approver opens `/connect/approve/<token>`, which starts the provider's flow. When they finish, the connection is recorded as made by the person who created the link, and the link is used.

## Per-factory opt-in

List the integrations a factory uses in `factory.yaml`. Bare names still work; objects carry settings under a key named after the type.

```yaml
integrations:
  - type: slack
    slack: { autoRespondToThreadReplies: true, channels: [C0123ABCD] }
  - type: microsoft-teams
    microsoft-teams:
      autoRespondToThreadReplies: false
      teams:
        - { teamId: 6b1f…, channelIds: ["19:abc@thread.tacv2"] }
  - type: discord
    discord: { guildIds: ["123"], channelIds: ["456"] }
  - type: linear
    linear: { teams: [Engineering] }
```

| Setting | Notes |
| --- | --- |
| `autoRespondToThreadReplies` | Slack, Teams, Discord. Default `true`: plain replies in a factory's thread continue the work. When `false`, a reply must mention the app. |
| `slack.channels` | Channel IDs the factory listens in. DMs always reach it. |
| `discord.guildIds`, `discord.channelIds` | Servers and channels the factory listens in. |
| `microsoft-teams.teams` | Teams and at least one standard channel per team. |
| `linear.teams`, `jira.projects` | The teams or projects the factory works in. Default automation templates use them. |

- A factory can use Linear or Jira, not both. Validation fails otherwise.
- GitHub, GitLab, Azure DevOps and Bitbucket come from `repositories`, not from `integrations`.
- Once a provider is connected for the workspace, its events reach only factories that list it. Providers configured only through environment variables reach every factory.

For factories managed in Kiln (not in a config repo), `PUT /api/v1/factories/<id>/integrations` with `{ integrations: [...] }` rewrites `factory.yaml` and applies it. `GET /api/v1/factories/<id>/integrations` returns the settings, the forges, `cloudProviders`, the `github` settings and each provider's connection status.

## Linked accounts

Gate assignees are people. Kiln maps provider users to people in three ways:

- **Chat sign-in.** `sign in` replies with a one-hour link: `@Kiln sign in` in Teams, a mention of the app or a DM saying `sign in` in Slack, and `/kiln prompt: sign in` in Discord (only you see the reply). Opening it and calling `POST /api/v1/me/linked-accounts/claim` with the token adds the chat account to your linked accounts.
- **GitHub.** `POST /api/v1/me/linked-accounts/github/start` returns a GitHub OAuth URL (needs `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`). The callback `/oauth/github-user/callback` links the GitHub login.
- **Email.** Linear and Jira users that report an email address map to the person with that email.

Everything ends up in your linked accounts: `GET /api/v1/me/linked-accounts` lists them, `POST` adds one by hand and `DELETE /api/v1/me/linked-accounts/<provider>` unlinks one. The server's static `identities` map still works as a fallback.

## Notification routes

`GET /api/v1/notification-routes` lists where a factory can reach a person, with `available` and a `reason` when it cannot. Query with `factory`, `workItem` and `subject` (admins only for someone else).

| Route | Needs |
| --- | --- |
| `slack_dm`, `discord_dm` | The chat connected and the person's account linked. |
| `slack_thread`, `discord_thread`, `teams_thread` | Work that started in that thread. Teams bots cannot send DMs. |
| `linear_issue`, `linear_session`, `jira_issue` | Work that started from that issue or session. |
| `github_comment`, `gitlab_comment`, `azure_devops_comment`, `bitbucket_comment` | A source issue or the work item's pull request on that forge. |

## Alias directory

Automation filters can name teams, projects, states, channels and users instead of IDs. Kiln resolves the names when you apply a definition, using each connection's directory, and rejects names it cannot resolve. See [Automations](../configuration/automations.md#alias-filters).

Kiln refreshes the Linear (teams, projects, states, users) and Jira (projects) directories when you connect or test. Set any directory yourself with `PUT /api/v1/connections/<provider>/directory`, for example `{ "channels": { "eng": "C0123ABCD" }, "users": { "ann": "U024BE7LH" } }`.

## Environment variables

| Provider | Variables |
| --- | --- |
| GitHub | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, or `GITHUB_TOKEN` |
| GitLab | `GITLAB_TOKEN`, `GITLAB_BASE_URL`, `GITLAB_WEBHOOK_TOKEN`, `GITLAB_BOT_USERNAMES` |
| Azure DevOps | `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_TOKEN`, `AZURE_DEVOPS_WEBHOOK_PASSWORD`, `AZURE_DEVOPS_WEBHOOK_USER`, `AZURE_DEVOPS_IDENTITIES` |
| Bitbucket | `BITBUCKET_TOKEN`, `BITBUCKET_USERNAME`, `BITBUCKET_WEBHOOK_SECRET`, `BITBUCKET_BOT_ACCOUNTS` |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `KILN_FACTORY_AVATAR_URL` |
| Microsoft Teams | `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_TENANT_ID` |
| Discord | `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_EVENTS_TOKEN`, `DISCORD_BOT_USER_ID` |
| Linear | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_ACCESS_TOKEN` |
| Jira | `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `JIRA_WEBHOOK_TOKEN`, `JIRA_BOT_ACCOUNT_ID`, `JIRA_CLOUD_ID`, `JIRA_ACCESS_TOKEN` |

Webhook secrets are read from the environment first, then from Kiln secrets, then from the connection.

## Related pages

- [Automations](../configuration/automations.md)
- [Custom webhooks](custom-webhooks.md)
- [Self-hosting](../infrastructure/self-hosting.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
