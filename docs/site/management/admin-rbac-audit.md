---
title: Admin, RBAC and audit
description: Issue API and MCP tokens with scopes per factory, manage secrets, and read the audit log.
owner: docs
section: Management
---

Access to Kiln's API and MCP is controlled by tokens whose scopes are granted per factory, and every change people or Kiln make is written to the audit log.

## Tokens

A token belongs to a subject (a person or a service), has a name, a list of grants and an optional lifetime in hours. Kiln shows the token once, when it is issued, and stores only its hash. Tokens can be revoked; a revoked or expired token is refused.

Send it as `Authorization: Bearer <token>` to the API, and configure it in your MCP client for the Kiln MCP. See the [API overview](../developer-tools/api.md) and the [MCP reference](../developer-tools/mcp.md).

Only tokens with `admin` on `*` (or team owners and admins) can issue scoped tokens, list them, manage server secrets and read the audit log.

### Token types

| Type | Grants |
| --- | --- |
| `scoped` | The explicit grants it was issued with (`POST /api/v1/tokens`). The bootstrap admin token is one. |
| `session` | A login. Grants come from the user's team and factory roles, computed on every request. |
| `personal` | An API key that acts as its user, like a session. |
| `agent` | A team service account: `read` and `send` on the team's factories. |
| `worker` | A self-hosted worker. It has no API scopes. |

Sessions and personal, agent and worker keys are covered in [Teams and users](teams-and-users.md).

## Scopes

Each grant pairs one scope with one factory ID, or `*` for all factories.

| Scope | Allows |
| --- | --- |
| `read` | See factories, definitions, work items, runs, gates, scores, metrics, self-improvement proposals, benchmarks and memories. |
| `send` | Send work items, post messages, cancel work, pull a task to a local worktree and hand it back, steer, replay, pause, resume and cancel runs, propose memories, and create and plan projects. |
| `decide:spec` | Approve or reject spec gates. |
| `decide:preview` | Approve or reject preview gates. |
| `decide:question` | Answer, approve or reject question gates. |
| `decide:merge` | Decide merge and custom gates, and confirm a handed-off work item complete without a merge. |
| `definitions:write` | Apply, sync and connect definitions, promote or roll back canaries, run self-improvement and benchmarks, approve or reject proposals, accept or reject memories, save benchmark tasks, publish and install skills. |
| `admin` | Everything above on the granted factories, plus tokens, secrets and the audit log when granted on `*`. |

Rules:

- `admin` implies every other scope.
- There are no wildcard scopes such as `decide:*`. Grant each one you need.
- A grant for one factory never covers another. Only `*` covers all.
- Connecting a new config repo needs `definitions:write` on `*`, because the factory does not exist yet.

### Grant strings

Grants can be written as a comma-separated string of `<scope>:<factory>`:

```text
read:*,send:webapp,decide:spec:webapp,decide:preview:webapp
```

An unknown scope is an error.

### Typical tokens

| Who | Grants |
| --- | --- |
| Product owner | `read:*`, `send:<factory>`, `decide:spec:<factory>`, `decide:preview:<factory>`, `decide:question:<factory>` |
| Engineer | `read:*`, `send:<factory>`, `decide:question:<factory>`, `decide:merge:<factory>` |
| Factory engineer | `read:*`, `send:<factory>`, `definitions:write:<factory>` |
| CI validating definitions | Any valid token; validation needs no scope. Add `definitions:write:<factory>` to apply. |
| Admin | `admin:*` |

A product owner's token cannot touch definitions, and a `decide:preview` token cannot apply definition changes.

### Roles map onto scopes

People do not need hand-made grants. Their factory role (User, Editor or Admin) gives them the scopes in [Factory roles](teams-and-users.md#factory-roles), and team owners and admins are Admin on every factory in their team. A team-wide check (`*`), or a factory that does not exist yet, is decided by the team role. Members may `read` and `send`. Owners and admins may do everything.

## Run tokens are different

Agents never get API tokens. Each run gets its own run token, valid for 60 minutes, that can only push `kiln/*` branches of the run's repositories, open pull requests, comment and add labels. It can never approve or merge. See [Architecture and security](../infrastructure/architecture-and-security.md).

## Secrets

Admins store named secrets, such as webhook secrets and API keys, in Kiln. Listing secrets returns names only; values never leave the server through the API. When a secret is not in the store, Kiln looks for the server environment variable `KILN_SECRET_<NAME>`. The only plain environment variables Kiln reads as secrets are model-provider keys: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENROUTER_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`. This way an agent definition cannot ask for the server's own credentials by name. Listing secrets includes names found in the environment.

These server secrets are the last place Kiln looks. Typed team and personal secrets, which most teams should use, are described in [Secrets, MCP servers and environments](secrets-mcps-environments.md).

## Audit log

Kiln writes an entry with the time, the actor, the action and the target for:

| Area | Actions |
| --- | --- |
| Definitions | `definition.applied` (with SHA, diff and canary share), `definition.rejected` (with errors), `canary.promoted`, `canary.rolled_back` |
| Work items | `work_item.created`, `work_item.cancelled`, `notify.failed` |
| Gates | `gate.approve`, `gate.reject`, `gate.answer`, with the surface used |
| Runs | `run.steered` (with the message), `run.cancelled`, `run.paused`, `run.resumed` |
| Self-improvement | `proposal.opened`, `proposal.approved`, `proposal.force_approved`, `proposal.rejected`, `proposal.empty`, `proposal.invalid` |
| Accounts | `user.created`, `user.password_changed`, `user.email_changed`, `user.account_linked`, `user.account_unlinked`, `auth.login`, `auth.login_failed`, `auth.logout`, `api_key.created`, `api_key.revoked` |
| Teams | `team.created`, `team.updated`, `team.avatar_changed`, `team.settings_changed`, `team.member_added`, `team.member_role_changed`, `team.member_removed`, `team.invite_created`, `team.invite_resent`, `team.invite_revoked`, `team.invite_accepted` |
| Factory roles | `factory.team_assigned`, `factory.member_added`, `factory.member_role_changed`, `factory.member_removed` |
| Secrets, MCP servers and environments | `secret.created`, `secret.updated`, `secret.deleted`, `mcp.created`, `mcp.updated`, `mcp.deleted`, `environment.created`, `environment.updated`, `environment.deleted` |
| Skills, memories and routers | `skill.published`, `skill.installed`, `memory.accepted`, `memory.rejected`, `router.proposed` |
| Planning and benchmarks | `project.created`, `roadmap.created`, `benchmark.ran` |
| Scoring | `score.invalid_label` |
| Admin | `token.issued`, `secret.set` |

The audit log returns the newest entries first, 200 by default.

Typed decisions have their own log with inputs, answers, action, provider, fallback and latency. See [Typed decisions](../configuration/decisions.md#logs).

## Related pages

- [Teams and users](teams-and-users.md)
- [Secrets, MCP servers and environments](secrets-mcps-environments.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
- [Inbox](inbox.md)
- [Self-hosting](../infrastructure/self-hosting.md)
- [API overview](../developer-tools/api.md)
- [Kiln MCP](../developer-tools/mcp.md)
