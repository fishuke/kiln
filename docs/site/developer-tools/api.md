---
title: API reference
description: Every REST endpoint with its scope, generated from the route table.
owner: docs
section: Developer tools
generated: true
---

Kiln's REST API lives under `/api/v1`. Send `Authorization: Bearer <token>` (a session token from login, an API key or a scoped token); each route needs the scope shown for the factory it touches (`admin` grants every scope). People's scopes come from their team and factory roles. Send `X-Kiln-Team: <team id or slug>` to act in a team other than your first. The machine-readable document is at `/api/v1/openapi.json`, and the TypeScript SDK (`@kiln/sdk-ts`) wraps every route.

## System

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | Health check |
| POST | `/api/v1/guard` | — | Check a shell command against the guardrail (run token) |

## Users

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | — | You: user, teams, current team, role, per-factory roles and grants |
| PATCH | `/api/v1/me` | — | Update your profile, email, appearance and notification preferences |
| PUT | `/api/v1/me/password` | — | Change your password |
| PUT | `/api/v1/me/avatar` | — | Upload your avatar (raw image body, at most 1 MiB) |
| GET | `/api/v1/users/{id}/avatar` | — | A user's uploaded avatar |
| GET | `/api/v1/me/linked-accounts` | — | Your linked accounts (identity mapping) |
| POST | `/api/v1/me/linked-accounts` | — | Link a GitHub, Slack, Discord, Linear, Jira, Teams, GitLab or Azure DevOps identity |
| DELETE | `/api/v1/me/linked-accounts/{provider}` | — | Unlink an identity |
| GET | `/api/v1/api-keys` | — | Your API keys, plus the team's agent and worker keys for team admins |
| POST | `/api/v1/api-keys` | — | Create a personal, agent or worker API key (shown once) |
| DELETE | `/api/v1/api-keys/{id}` | — | Revoke an API key |

## Auth

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/providers` | — | Login methods and whether signup is open |
| POST | `/api/v1/auth/signup` | — | Create an account (the first one owns the default team; later ones need an invite unless signup is open) |
| POST | `/api/v1/auth/login` | — | Log in with email and password; returns a session token |
| POST | `/api/v1/auth/logout` | — | Revoke the current session token |
| GET | `/api/v1/auth/github/start` | — | Start GitHub login (redirects, or JSON with Accept: application/json) |
| GET | `/api/v1/auth/github/callback` | — | GitHub login callback; returns or redirects with a session token |
| GET | `/api/v1/invites/{token}` | — | Look at an invite link |
| POST | `/api/v1/invites/accept` | — | Accept an invite with your account |

## Teams

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/teams` | — | Your teams with your role |
| POST | `/api/v1/teams` | — | Create a team (you become its owner) |
| GET | `/api/v1/teams/{team}` | — | A team with its settings and factories |
| PATCH | `/api/v1/teams/{team}` | — | Rename a team, change its slug or avatar URL (team admin) |
| PUT | `/api/v1/teams/{team}/avatar` | — | Upload the team avatar (team admin) |
| GET | `/api/v1/teams/{team}/avatar` | — | The team's uploaded avatar |
| GET | `/api/v1/teams/{team}/members` | — | Team members and roles |
| PATCH | `/api/v1/teams/{team}/members/{userId}` | — | Change a member's role (only owners grant ownership) |
| DELETE | `/api/v1/teams/{team}/members/{userId}` | — | Remove a member, or leave the team |
| GET | `/api/v1/teams/{team}/invites` | — | Pending invites (team admin) |
| POST | `/api/v1/teams/{team}/invites` | — | Invite by email; the link expires in 7 days |
| POST | `/api/v1/teams/{team}/invites/{inviteId}/resend` | — | New link and 7 more days; the old link stops working |
| DELETE | `/api/v1/teams/{team}/invites/{inviteId}` | — | Revoke an invite |
| GET | `/api/v1/teams/{team}/settings` | — | Spend limit, GitHub orgs, sandbox host, egress allowlist, data storage, default factory role |
| PATCH | `/api/v1/teams/{team}/settings` | — | Change team settings (team admin) |
| GET | `/api/v1/teams/{team}/model-keys` | — | Which team-managed model keys are set |
| PUT | `/api/v1/teams/{team}/model-keys/{provider}` | — | Set the team's Anthropic, OpenAI, OpenRouter or Bedrock key |
| DELETE | `/api/v1/teams/{team}/model-keys/{provider}` | — | Remove a team-managed model key |

## Factories

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories/{id}/members` | `read` | Everyone with a role on the factory and where the role comes from |
| POST | `/api/v1/factories/{id}/members` | `admin` | Give a team member a factory role (user, editor, admin) |
| PATCH | `/api/v1/factories/{id}/members/{userId}` | `admin` | Change a factory role |
| DELETE | `/api/v1/factories/{id}/members/{userId}` | `admin` | Remove a factory role |
| GET | `/api/v1/factories` | `read` | List factories you can read |
| GET | `/api/v1/factories/{id}` | `read` | A factory with its resolved definition |
| DELETE | `/api/v1/factories/{id}` | `admin` | Delete a factory: cancels open work, removes its routing labels and webhooks (irreversible) |

## Secrets

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/managed-secrets` | — | Team secrets and your personal secrets (metadata only) |
| POST | `/api/v1/managed-secrets` | — | Create a team or personal secret (raw, registry, ECR or harness credential) |
| PATCH | `/api/v1/managed-secrets/{scope}/{name}` | — | Replace a secret's value or description |
| DELETE | `/api/v1/managed-secrets/{scope}/{name}` | — | Delete a secret |

## MCPs and apps

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/mcp-servers` | — | The team's MCP servers and built-in integration servers |
| POST | `/api/v1/mcp-servers` | — | Add an MCP server (command + args + env, or url + headers) |
| GET | `/api/v1/mcp-servers/{id}` | — | One MCP server |
| PATCH | `/api/v1/mcp-servers/{id}` | — | Change an MCP server |
| DELETE | `/api/v1/mcp-servers/{id}` | — | Remove an MCP server |

## Environments

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/environments` | — | The team's environment templates |
| POST | `/api/v1/environments` | — | Create an environment (image, repos, setup commands, secrets) |
| GET | `/api/v1/environments/{id}` | — | One environment |
| PATCH | `/api/v1/environments/{id}` | — | Change an environment |
| DELETE | `/api/v1/environments/{id}` | — | Delete an environment |

## Usage

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/usage` | — | Team usage from run costs: totals, spend limit, by day, factory, agent, model and user |

## Definitions

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories/{id}/definition` | `read` | The definition tree at the applied (or given) sha |
| POST | `/api/v1/definitions/validate` | — | Validate a definition tree |
| POST | `/api/v1/definitions/diff` | `read` | Diff a tree against the applied definition |
| POST | `/api/v1/definitions/apply` | `definitions:write` | Apply a tree atomically, optionally as a canary or dry run |
| POST | `/api/v1/factories/connect` | `definitions:write` | Bind a factory to a GitHub config repo and apply it |
| POST | `/api/v1/factories/{id}/sync` | `definitions:write` | Pull the config repo and apply it |
| POST | `/api/v1/factories/{id}/canary/{action}` | `definitions:write` | Promote or roll back the canary definition |

## Work items

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/work-items` | `read` | List work items |
| POST | `/api/v1/work-items` | `send` | Send work to a factory |
| GET | `/api/v1/work-items/{id}` | `read` | A work item with its runs, gates and decisions |
| POST | `/api/v1/work-items/{id}/messages` | `send` | Message the foreman (answers an open question) |
| POST | `/api/v1/work-items/{id}/cancel` | `send` | Cancel a work item |
| POST | `/api/v1/work-items/{id}/complete` | `decide:merge` | Confirm a handed-off item landed (human only) |
| POST | `/api/v1/work-items/{id}/pull` | `send` | Take a task to a local worktree |
| POST | `/api/v1/work-items/{id}/handback` | `send` | Hand a local task back to the factory |

## Runs

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/runs` | `read` | List runs |
| GET | `/api/v1/runs/{id}` | `read` | A run with its scores |
| GET | `/api/v1/runs/{id}/events` | `read` | Run events after a sequence number |
| GET | `/api/v1/runs/{id}/stream` | `read` | Run events as server-sent events |
| POST | `/api/v1/runs/{id}/steer` | `send` | Send a steering message to a running agent |
| POST | `/api/v1/runs/{id}/replay` | `send` | Replay from the saved start state, optionally under another sha |
| POST | `/api/v1/runs/{id}/pause` | `send` | Snapshot and pause a running agent |
| POST | `/api/v1/runs/{id}/resume` | `send` | Resume a paused run on any node |
| POST | `/api/v1/runs/{id}/cancel` | `send` | Cancel a run |

## Benchmarks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/api/v1/runs/{id}/save-benchmark` | `definitions:write` | Save a finished run as a benchmark task |
| GET | `/api/v1/factories/{id}/benchmarks` | `read` | Benchmark results and Pareto summary |
| POST | `/api/v1/factories/{id}/benchmarks/{suite}/run` | `definitions:write` | Run a benchmark suite |
| POST | `/api/v1/factories/{id}/benchmarks/{suite}/router` | `definitions:write` | Propose routing rules from results |

## Inbox

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/inbox` | — | Open decisions, most urgent first |
| GET | `/api/v1/gates/{id}` | `read` | A gate with its work item |
| POST | `/api/v1/gates/{id}/decide` | `decide:*` | Approve, reject or answer (scope depends on the gate kind) |

## Planning

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/projects` | — | List projects |
| POST | `/api/v1/projects` | `send` | Create a project over factories |
| GET | `/api/v1/projects/{id}` | — | A project with its roadmap and work items |
| POST | `/api/v1/projects/{id}/plan` | `send` | Goal or PRD to roadmap and tracker issues |
| GET | `/api/v1/portfolio` | — | Cross-factory rollup |
| GET | `/api/v1/digest` | — | Pending decisions per person |

## Measure

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/metrics` | `read` | Factory metrics: PRs, autonomy, cycle time, cost, scores |
| GET | `/api/v1/metrics/raw` | `read` | Raw runs, scores or work items |
| GET | `/api/v1/scores` | `read` | Scores for a factory |
| GET | `/api/v1/factories/{id}/self-improvement` | `read` | Proposals and unreviewed failures |
| POST | `/api/v1/factories/{id}/self-improvement/run` | `definitions:write` | Run self-improvement now |
| POST | `/api/v1/proposals/{id}/approve` | `definitions:write` | Approve a proposal (ships as a canary) |
| POST | `/api/v1/proposals/{id}/reject` | `definitions:write` | Reject a proposal (kept as a negative example) |

## Memories and skills

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories/{id}/memories` | `read` | Factory memories |
| POST | `/api/v1/factories/{id}/memories` | `send` | Propose a memory |
| POST | `/api/v1/memories/{id}/accept` | `definitions:write` | Accept a memory into the definition |
| GET | `/api/v1/skills` | — | Org-wide skills catalog |
| POST | `/api/v1/skills/publish` | `definitions:write` | Publish a factory skill to the catalog |
| POST | `/api/v1/skills/{id}/install` | `definitions:write` | Install a catalog skill into a factory |

## Admin

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/audit` | `admin` | Audit log |
| GET | `/api/v1/tokens` | `admin` | List API tokens |
| POST | `/api/v1/tokens` | `admin` | Issue a scoped token |
| PUT | `/api/v1/secrets/{name}` | `admin` | Set a managed secret |

## Integrations

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/connections` | `admin` | Workspace connections to every provider, with status |
| POST | `/api/v1/connections/{provider}/start` | `admin` | Start connecting: an OAuth/install URL and setup steps |
| POST | `/api/v1/connections/{provider}/complete` | `admin` | Finish connecting (OAuth code + state, or manual fields) |
| POST | `/api/v1/connections/{provider}/test` | `admin` | Test a connection's credentials |
| DELETE | `/api/v1/connections/{provider}` | `admin` | Disconnect and delete stored credentials |
| PUT | `/api/v1/connections/{provider}/directory` | `admin` | Set the names → ids used to resolve alias filters |
| GET | `/api/v1/connections/{provider}/approval-links` | `admin` | Approval links sent to someone else |
| POST | `/api/v1/connections/{provider}/approval-links` | `admin` | Send an approval link to an admin (expires in 7 days) |
| POST | `/api/v1/approval-links/{id}/resend` | `admin` | Resend an approval link (new token, 7 more days) |
| DELETE | `/api/v1/approval-links/{id}` | `admin` | Revoke an approval link |
| POST | `/api/v1/me/linked-accounts/claim` | — | Link a chat account from a sign-in token (Slack, Teams, Discord `sign in`) |
| POST | `/api/v1/me/linked-accounts/github/start` | — | Start linking your GitHub account (OAuth URL) |
| GET | `/api/v1/factories/{id}/integrations` | `read` | A factory's integrations, settings and connection status |
| PUT | `/api/v1/factories/{id}/integrations` | `definitions:write` | Opt a Kiln-managed factory into integrations (applies factory.yaml) |
| GET | `/api/v1/notification-routes` | — | Where a factory can notify a person (?factory, ?workItem, ?subject) |
| GET | `/api/v1/integrations/teams/app-package` | `admin` | Microsoft Teams app package (manifest and icons, zip) |
| POST | `/api/v1/integrations/discord/commands` | `admin` | Register the /kiln Discord command (global or one server) |

## Automations

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/automation-templates` | — | Default and suggested automation files (?factory fills them in) |
| POST | `/api/v1/factories/{id}/automations/from-template` | `definitions:write` | Add a template to a Kiln-managed factory |
| GET | `/api/v1/automation-catalog` | — | Every trigger provider, event and filter key |
| GET | `/api/v1/deliveries` | `admin` | Recent provider deliveries |
| POST | `/api/v1/factories/{id}/automations/{name}/test-filter` | `read` | Test an automation's triggers against a stored delivery |

## Custom webhooks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories/{id}/webhooks` | `read` | A factory's custom webhooks (managed and file) |
| POST | `/api/v1/factories/{id}/webhooks` | `definitions:write` | Create a webhook; the secret is shown once |
| GET | `/api/v1/webhooks/{uid}` | `read` | A webhook with its ingress URL |
| PATCH | `/api/v1/webhooks/{uid}` | `definitions:write` | Enable, disable or set the delivery id header |
| DELETE | `/api/v1/webhooks/{uid}` | `definitions:write` | Delete a webhook (automations stay but stop firing) |
| POST | `/api/v1/webhooks/{uid}/rotate` | `definitions:write` | Rotate the secret immediately |
| POST | `/api/v1/webhooks/{uid}/finish` | `definitions:write` | Finish setup with the provider's secret and enable |
| GET | `/api/v1/webhooks/{uid}/deliveries` | `read` | Recent deliveries and their status |
| GET | `/api/v1/webhooks/{uid}/deliveries/{delivery}` | `read` | One delivery with its stored payload |

## Webhooks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/webhooks/github` | — | GitHub App webhook (X-Hub-Signature-256) |
| POST | `/webhooks/gitlab` | — | GitLab group webhook (X-Gitlab-Token) |
| POST | `/webhooks/azure-devops` | — | Azure DevOps service hooks (basic auth) |
| POST | `/webhooks/bitbucket` | — | Bitbucket Cloud webhook (X-Hub-Signature) |
| POST | `/webhooks/slack` | — | Slack Events API (signing secret) |
| POST | `/webhooks/teams` | — | Microsoft Teams Bot Framework activities (JWT) |
| POST | `/webhooks/discord` | — | Discord interactions (Ed25519) |
| POST | `/webhooks/discord/events` | — | Discord gateway events from a bridge (bearer token) |
| POST | `/webhooks/linear` | — | Linear webhook (Linear-Signature) |
| POST | `/webhooks/jira` | — | Jira webhook (?token=) |
| POST | `/webhooks/w/{uid}` | — | Custom webhook ingress: 202 {delivery_id} |
| POST | `/webhooks/w/{uid}/{token}` | — | Custom webhook ingress with a URL token |
| POST | `/webhooks/{factory}/{name}` | — | A factory's file webhook by name (older URL) |
| GET | `/oauth/{provider}/callback` | — | OAuth / app install callback (browser redirect) |
| GET | `/connect/approve/{token}` | — | Open an approval link (browser redirect) |
| GET | `/oauth/github-user/callback` | — | GitHub account linking callback (browser redirect) |

## Errors

Errors are JSON: `{ "error": "message" }` with status 400 (invalid request; `issues` lists the fields), 401 (missing or invalid token), 402 (`{ "error": "budget_exceeded", "message": ... }`: the team's spend limit is reached and auto-stop is on), 403 (token lacks the scope), 404 (unknown resource), 409 (wrong state or already exists), 410 (expired invite) or 413 (upload too large).

## Related pages

- [CLI reference](cli.md)
- [Kiln MCP](mcp.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
- [Teams and users](../management/teams-and-users.md)
