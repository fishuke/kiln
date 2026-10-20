---
title: Self-hosting
description: Run Kiln on your own infrastructure, what it needs, how to connect integrations and sandboxes, and where to look when something goes wrong.
owner: docs
section: Infrastructure
---

Kiln runs on your own infrastructure: a single host with Docker for small installs, or a Kubernetes cluster with gVisor for production.

## Requirements

| Component | Purpose |
| --- | --- |
| Node 22 and pnpm 10 | Kiln's services are TypeScript on Node. |
| A data directory (a volume) | Runtime state (work items, runs, gates, scores, tokens, audit log) in `kiln.json`, and objects (videos, reports, snapshots) under `objects/`. Back it up by copying it. |
| Docker, or Kubernetes with a `gvisor` RuntimeClass | Sandboxes for agent runs. Without either, runs use host directories (development only). |
| An egress proxy | Enforces each runner's `egress` host list. Included in `docker-compose.yml` and the Helm chart. See [Sandboxes](sandboxes.md#egress). |
| Optional: an OpenAI-compatible gateway (LiteLLM) | The LLM fallback for typed decisions and judges. |

Postgres, Temporal, NATS and S3 are not required in v1; see ADR-002 and ADR-005 for why and for the path to them.

## Install

### Try it locally

```bash
git clone https://github.com/fishuke/klin kiln && cd kiln
pnpm install
pnpm dev            # API on :4000 with demo data, web app on :3000
```

Open http://localhost:3000. Demo factories run on a git-backed local forge with scripted agents, so nothing needs an account.

### One machine with Docker Compose

```bash
cp .env.example .env          # add your keys: CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or API keys
echo KILN_AGENTS=real >> .env  # run Claude Code, Codex and OpenCode instead of scripted agents
docker build -t kiln-runner-node runners/images/node
docker compose up -d --build
pnpm health
```

The API prints a bootstrap admin token on first start (also in the data volume as `admin-token`). Put it in `.env` as `KILN_TOKEN` so the web app can call the API, then restart `web`.

Then create your account: the first signup (`POST /api/v1/auth/signup`) becomes the owner of the default team, and existing factories move into that team. Invite everyone else. See [Teams and users](../management/teams-and-users.md).

### Kubernetes with Helm

```bash
kubectl create secret generic kiln-env --from-env-file=.env
helm install kiln deploy/helm/kiln \
  --set publicUrl=https://kiln.example.com --set webUrl=https://kiln.example.com \
  --set ingress.host=kiln.example.com
```

The chart creates the `kiln-sandboxes` namespace with the restricted pod security level, a `gvisor` RuntimeClass (handler `runsc`, which your nodes must provide), the egress proxy, a default-deny NetworkPolicy, and a Role that lets the API create sandbox pods there.

### First factory

```bash
pnpm kiln init my-factory --template sdlc
# edit my-factory/factory.yaml: repositories, alias, integrations
pnpm kiln validate my-factory
KILN_URL=http://localhost:4000 KILN_TOKEN=... pnpm kiln apply my-factory
pnpm kiln send "Fix the typo in the README" --factory <alias>
```

Or push the folder to a GitHub repo and connect it under Create factory; merges to its default branch then apply automatically.

## Connect your systems

### Public URLs

Kiln needs two URLs:

- **Public URL:** where agents in sandboxes reach the API. Kiln uses it for the Claude Code command-guard hook (`/api/v1/guard`) and the Kiln MCP (`/mcp`). Without it, neither is installed in runs.
- **Web URL:** where people open links. Kiln uses it in the links it posts, such as `<web URL>/inbox/<gate>` and `<web URL>/runs/<work item>`.

### Webhooks and secrets

Point each provider's webhooks at Kiln and set the matching secret. For the provider endpoints, Kiln reads the server environment variable with the secret's name (for example `GITHUB_WEBHOOK_SECRET`) first, then its secrets store, then `KILN_SECRET_<NAME>`, then the provider's [connection](../integrations/connections.md). A custom webhook's secret comes from the secrets store or `KILN_SECRET_<secretName>`.

| Provider | Endpoint | Secret |
| --- | --- | --- |
| GitHub | `POST /webhooks/github` | `GITHUB_WEBHOOK_SECRET` |
| GitLab | `POST /webhooks/gitlab` | `GITLAB_WEBHOOK_TOKEN` (`X-Gitlab-Token`) |
| Azure DevOps | `POST /webhooks/azure-devops` | `AZURE_DEVOPS_WEBHOOK_PASSWORD` (basic auth) |
| Bitbucket | `POST /webhooks/bitbucket` | `BITBUCKET_WEBHOOK_SECRET` |
| Slack | `POST /webhooks/slack` | `SLACK_SIGNING_SECRET` |
| Microsoft Teams | `POST /webhooks/teams` | Bot Framework token for `TEAMS_APP_ID` |
| Discord | `POST /webhooks/discord` | Ed25519 with `DISCORD_PUBLIC_KEY` |
| Discord bridge | `POST /webhooks/discord/events` | `DISCORD_EVENTS_TOKEN` (bearer) |
| Linear | `POST /webhooks/linear` | `LINEAR_WEBHOOK_SECRET` |
| Jira | `POST /webhooks/jira?token=<token>` | `JIRA_WEBHOOK_TOKEN` |
| Custom | `POST /webhooks/w/<uid>` (or `/webhooks/<factory>/<name>`) | The webhook's secret |

GitLab, Azure DevOps, Bitbucket, Teams and Discord refuse every call until their secret is set. For GitHub, Slack, Linear and Jira, Kiln accepts webhooks without checking signatures when the secret is not set. Set every secret before you expose Kiln to the internet.

OAuth providers redirect to `GET /oauth/<provider>/callback` on the public URL; register that URL in each OAuth app. Every provider's variables are listed on [Connections](../integrations/connections.md#environment-variables).

Admins can set secrets through the API; values are never returned, only names. See the [API overview](../developer-tools/api.md).

### Model credentials

Runs use your own model keys. Store `CLAUDE_CODE_OAUTH_TOKEN` (a Claude subscription token from `claude setup-token`) or `ANTHROPIC_API_KEY` for Claude Code, `OPENAI_API_KEY` or `CODEX_API_KEY` for Codex, and the keys OpenCode's providers need. You can store them as Kiln secrets or set them as plain environment variables on the server. Agents can also name their own secret with `harness.auth`. See [Harnesses](harnesses.md#credentials).

### Accounts and login

| Variable | What it does |
| --- | --- |
| `KILN_OPEN_SIGNUP=1` | Anyone may sign up and join the default team. Otherwise, after the first owner, signup needs an invite. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Turn on GitHub login. The OAuth app's callback URL is `<KILN_PUBLIC_URL>/api/v1/auth/github/callback`. `GITHUB_OAUTH_URL` and `GITHUB_API_URL` point at GitHub Enterprise. |
| `KILN_SECRET_KEY` | Seals team and personal secrets with AES-256-GCM, and signs run tokens. Set it, and keep it stable across restarts. |
| `KILN_DEV_AUTH=1` | Local development only: requests without a token act as `dev@kiln.local`, owner of the default team. |

### Identities

Gate assignees are people, such as `po@acme.test`. To let replies in Slack or on issues decide gates, people link their Slack, GitHub, Linear, Jira, Discord, Teams, GitLab or Azure DevOps accounts in user settings. See [Linked accounts](../management/teams-and-users.md#linked-accounts). The server option `identities` still works as a fallback. It is keyed by `<provider>:<user>`, for example `slack:U024BE7LH` → `po@acme.test`. See [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

### Roles

Gates name approvers by role, such as `role:po` or `role:code-owners`. Kiln's server configuration maps each role to people. Kiln uses these roles:

| Role | Used by |
| --- | --- |
| `po` | Built-in spec and preview gates |
| `code-owners` | The built-in merge gate, and high-risk reviews |
| `admins` | Command approvals for runs without a requester |

### Sandboxes

- **Docker:** create the `kiln-egress` network and run the egress proxy on it as `kiln-egress-proxy`, listening on port 3128.
- **Kubernetes:** create the `kiln-sandboxes` namespace, install gVisor with a RuntimeClass named `gvisor`, and deploy the egress proxy with the label `app.kubernetes.io/name: kiln-egress-proxy` on port 3128.
- Build runner images with the harness programs (`claude`, `codex`, `opencode`), git and your toolchain installed.

### Cloud identity federation

When a factory sets `cloudProviders` in `factory.yaml`, its runs get the federation settings as environment variables and exchange their own identity token for short-lived cloud credentials. Kiln never holds long-lived cloud keys. See [Definitions as code](../configuration/definitions-as-code.md#cloud-identity-federation).

### Forge identity

Kiln talks to GitHub as a GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`), minting a short-lived installation token for each call, or with a plain `GITHUB_TOKEN`. GitLab, Azure DevOps and Bitbucket use the tokens on their pages. It needs to read repositories, push `kiln/*` branches, open and update pull requests, comment, add labels and read check runs. Do not give it a branch-protection bypass. Agents never see this token; each run gets its own short-lived run token instead.

## Timers

Kiln runs a timer pass that:

- sends gate nudges and applies gate expiry,
- fires due schedules,
- retries verify stages that wait for CI,
- promotes or rolls back canaries after 7 days,
- when self-improvement checks are switched on for the pass, runs the check for every factory.

## Monitoring

- `GET /api/v1/health` returns `ok`, the number of factories and the server time.
- Each run records a trace ID, so you can match its events with your logs and traces.
- The audit log lists who applied definitions, decided gates, steered runs, issued tokens and set secrets.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A definition push did not apply | The factory's last error shows the first validation error. Run `kiln validate`. |
| An automation never fires | The trigger's `provider` and `event` match the event name exactly, and every filter key matches (GitHub events carry both `repo` and `repos`). |
| A work item is `blocked` | Its blocked reason says why: an expired gate, a stage that failed too often, the budget, or an error. Answer the open question to resume. |
| A run fails at install | The runner's `egress` list is missing a package registry or another host the run needs. Repository hosts are always allowed. |
| Verify waits forever | CI checks on the branch are still pending. Kiln checks again on each timer pass. |
| Every command is blocked | The Claude Code hook cannot reach the public URL, so it blocks by design. |
| Webhooks return 401 | The secret in Kiln does not match the provider's, or (Teams, Discord, GitLab, Azure DevOps, Bitbucket) it is not set. |
| An automation with `teams` or `channels` fails to apply | The names did not resolve. Connect the provider, or set its directory. See [Connections](../integrations/connections.md#alias-directory). |

## Related pages

- [Architecture and security](architecture-and-security.md)
- [Sandboxes](sandboxes.md)
- [Harnesses](harnesses.md)
- [GitHub](../integrations/github.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
