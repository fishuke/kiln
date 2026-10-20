---
title: Teams and users
description: Accounts, login, teams, invites, team and factory roles, API keys, user settings and linked accounts.
owner: docs
section: Management
---

People sign in to Kiln with an account, work in one or more teams, and get a role on each factory. Every API request acts as a user, a team service account or a scoped token.

## Accounts and login

An account has a name, an email, an optional avatar and a password (stored as a salted scrypt hash) or a linked GitHub login.

- **Sign up:** `POST /api/v1/auth/signup` with `email`, `password` (at least 8 characters) and optionally `name` and `invite`.
- **Log in:** `POST /api/v1/auth/login` returns a session token. Send it as `Authorization: Bearer <token>`. Sessions last 30 days.
- **Log out:** `POST /api/v1/auth/logout` revokes the session token.
- **GitHub login:** set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` on the server, and use `<public URL>/api/v1/auth/github/callback` as the OAuth app's callback URL. `GET /api/v1/auth/github/start?redirect=<web URL>` sends people to GitHub. They come back to the web app with the session token in the URL fragment. Kiln finds the account by the linked GitHub id, then by verified email. If neither matches, it signs the person up under the rules below.

`GET /api/v1/auth/providers` tells a login page which methods are on and whether signup is open.

### Who may sign up

1. The first person to sign up becomes the owner of the default team.
2. After that, signing up needs an invite for the same email address.
3. With `KILN_OPEN_SIGNUP=1`, anyone may sign up and joins the default team as a member.

### Local development

With `KILN_DEV_AUTH=1`, requests without a token act as the seeded user `dev@kiln.local`. That user owns the default team and has `admin` on every factory. Requests that do send a token still act as that token, so you can try logins locally. Never turn dev auth on for a server others can reach.

The bootstrap admin token that the server prints on first start keeps working. It is a scoped token with `admin` on every factory, not a user.

## Teams

A team has a name, a slug, an avatar and settings. Each factory belongs to one team. Factories created before teams existed move into the default team on start.

| Team role | Can |
| --- | --- |
| `owner` | Everything an admin can, plus grant or take away ownership. A team always keeps at least one owner. |
| `admin` | Rename the team, manage members, invites, settings, team secrets, MCP servers, environments and model keys, and create agent and worker keys. Admin on every factory in the team. |
| `member` | Use the team's factories with the team's default factory role, add personal secrets, create personal API keys. |

Anyone with an account can create a team (`POST /api/v1/teams`) and becomes its owner.

### Current team

Requests act in one team at a time. Send `X-Kiln-Team: <team id or slug>` to choose it. Without the header, Kiln uses your first team. Factory lists, secrets, MCP servers, environments and usage show the current team only. Agent and worker keys always act in their own team.

The SDK sets the header with `client.withTeam("payments")`.

### Invites

Owners and admins invite people by email with a role (`POST /api/v1/teams/<team>/invites`). The response holds the invite link, `<web URL>/join?invite=<token>`. Kiln stores only a hash of the token.

- An invite expires after 7 days.
- **Resend** issues a new link and 7 more days. The old link stops working.
- **Revoke** cancels the invite.
- `GET /api/v1/invites/<token>` shows the team, email and role without logging in.
- People with an account accept with `POST /api/v1/invites/accept`. New people sign up with the `invite` field.
- Only owners can invite owners.

### Team settings

| Setting | Default | What it does |
| --- | --- | --- |
| `spendLimit.monthlyUsd` | `200` | The monthly spend limit. See [Usage and spend limits](usage-and-spend-limits.md). |
| `spendLimit.autoStop` | `false` | Refuse new runs once the limit is reached. When off, the limit is a soft warning. |
| `githubOrgs` | `[]` | Enabled GitHub orgs. When the list is not empty, the team's factories may only use GitHub repositories owned by these orgs. |
| `defaultSandboxHost` | not set | `local`, `docker` or `kubernetes`. Used for runs whose agent names no runner. |
| `egressAllowlist` | `[]` | Hosts added to every run's egress allowlist. |
| `storage.artifacts`, `storage.transcripts`, `storage.attachments` | `{ kind: local }` | Where each kind of data goes. See [Data storage](#data-storage). |
| `defaultFactoryRole` | `user` | The factory role every member has on the team's factories: `none`, `user` or `editor`. |

### Data storage

Each team chooses where three kinds of data go:

| Category | What | Object keys |
| --- | --- | --- |
| `artifacts` | Screenshots, recordings and reports that runs save | `runs/<run id>/<file>` |
| `transcripts` | Each run's events as JSON lines, written when the run finishes | `transcripts/<run id>.jsonl` |
| `attachments` | Files people attach to requests | `attachments/<team id>/…` |

A target is one of:

- `{ kind: local }`: the server's object store (`KILN_DATA_DIR/objects`). This is the default.
- `{ kind: local, path: "acme/artifacts" }`: a folder under the server's storage root (`KILN_DATA_DIR/storage`). The path must stay inside the root.
- `{ kind: s3, bucket, region, endpoint?, prefix?, forcePathStyle?, accessKeyIdSecret?, secretAccessKeySecret? }`: an S3-compatible bucket, such as AWS S3, MinIO or Cloudflare R2. Kiln signs requests itself (SigV4). Put the access key in two team secrets and name them here. Without them Kiln uses the server's `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. With an `endpoint`, Kiln uses path-style URLs unless `forcePathStyle: false`.

Kiln remembers where each object went, so changing the settings later does not lose anything. Existing objects are not moved. Check a target with `POST /api/v1/teams/<team>/storage/<category>/test`, which writes a small object and reads it back.

Team-managed model keys (Anthropic, OpenAI, OpenRouter, Bedrock) are team secrets with fixed names. See [Secrets, MCP servers and environments](secrets-mcps-environments.md#team-managed-model-keys).

## Factory roles

| Factory role | Can | Scopes |
| --- | --- | --- |
| User | See the factory, send work, decide spec, preview and question gates, propose memories. | `read`, `send`, `decide:spec`, `decide:preview`, `decide:question` |
| Editor | Everything a User can, plus edit the definition, agents, repos and automations, attach secrets, MCP servers and runners, and confirm merges. | adds `definitions:write`, `decide:merge` |
| Admin | Everything, including factory members and forcing a definition change that waits for a second approval (`POST /api/v1/proposals/<id>/approve` with `{ "force": true }`). | `admin` |

Team owners and admins are always Admin. Members get the team's `defaultFactoryRole`, or a higher role from a factory membership. Manage factory memberships with `GET`, `POST`, `PATCH` and `DELETE /api/v1/factories/<id>/members`. The person must be in the factory's team first.

Kiln turns roles into the same per-factory scopes that tokens use, when each request arrives. Every route checks scopes the same way for users and tokens. See [Admin, RBAC and audit](admin-rbac-audit.md).

Team-wide actions, and applying a definition for a factory that does not exist yet, are decided by the team role. Members may read and send. Owners and admins may do everything.

## API keys

Create keys in user settings (`POST /api/v1/api-keys`). Keys use the `kiln_` format and are shown once.

| Type | Acts as | Who creates it |
| --- | --- | --- |
| `personal` | You, with your roles. Usage counts as yours. | Anyone |
| `agent` | A team service account: `read` and `send` on the team's factories, never decide or merge. Usage counts as the team's. | Team owners and admins |
| `worker` | A self-hosted worker. It has no API scopes. | Team owners and admins |

Expiry is `1d`, `30d` (the default), `90d` or `never`. The key list shows when each key was last used. Revoke a key with `DELETE /api/v1/api-keys/<id>`. Team owners and admins also see and revoke the team's agent and worker keys.

## User settings

`PATCH /api/v1/me` changes:

- `name` and `email`.
- `avatar`: a URL, or `null` to clear it. You can also upload an image with `PUT /api/v1/me/avatar` (PNG, JPEG, GIF, WebP or SVG, at most 1 MiB).
- `appearance`: `light`, `dark` or `system`.
- `notifications`: for each kind (`spec`, `preview`, `question`, `merge` (pull request review), `custom`, `blocked`, `failed`), whether to notify by `email`, `slack` and `discord`.
- `digest`: `{ daily, hourUtc, channels, only }`. With `daily: true`, Kiln sends one summary of the decisions waiting on you each day at or after `hourUtc`. With `only: true`, it sends nothing right away.

Change your password with `PUT /api/v1/me/password`.

### Notifications

When a gate opens (a spec, preview, question, pull request review or custom decision), Kiln notifies its assignees. When work moves to `blocked` or `failed`, it notifies the requester. Only people with an account are notified, and only on the channels their preferences allow:

- **Email:** set `KILN_SMTP_URL` on the server, for example `smtp://user:password@mail.acme.test:587?from=kiln@acme.test`, or `smtps://…:465` for implicit TLS. Kiln upgrades to STARTTLS when the server offers it. `KILN_MAIL_FROM` sets the sender.
- **Slack and Discord:** a direct message to your linked account, through the chat integration for that provider.

`GET /api/v1/me/notifications` lists what Kiln sent you and whether it arrived. Failed deliveries are also in the audit log as `notify.failed`.

`GET /api/v1/me` returns your user, your teams, the current team, your role in it, your role on each factory, and the token's grants.

### Linked accounts

Linked accounts tell Kiln who you are on other systems. Supported providers: `github`, `slack`, `discord`, `linear`, `jira`, `teams`, `gitlab` and `azure_devops`.

- Link one with `POST /api/v1/me/linked-accounts` and `{ "provider": "slack", "externalId": "U024BE7LH" }`. Add `handle` for a login name such as a GitHub username.
- Unlink with `DELETE /api/v1/me/linked-accounts/<provider>`.
- One external account belongs to one user.

When an event arrives, for example a Slack reply in a work item's thread, Kiln looks up the author:

1. A linked account.
2. The server's `identities` option.
3. An email that matches an account. Linear and Jira send emails.

The result becomes the work item's requester and the person who decides a gate from a reply. GitHub login links your GitHub account automatically.

## Related pages

- [Admin, RBAC and audit](admin-rbac-audit.md)
- [Secrets, MCP servers and environments](secrets-mcps-environments.md)
- [Usage and spend limits](usage-and-spend-limits.md)
- [API reference](../developer-tools/api.md)
- [Self-hosting](../infrastructure/self-hosting.md)
