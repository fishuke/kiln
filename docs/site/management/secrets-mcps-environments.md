---
title: Secrets, MCP servers and environments
description: Team and personal secrets, team-managed model keys, the MCPs and apps registry, and environment templates that runs start from.
owner: docs
section: Management
---

Secrets, MCP servers and environments belong to a team. Agents use them by name, and Kiln resolves them for each run.

## Secrets

A secret has a scope, a name, a type, an optional description, and who created and last changed it and when. Values are write-only: the API returns metadata, never values. A value can be at most 128 KiB.

| Scope | Who manages it | Which runs get it |
| --- | --- | --- |
| `team` | Team owners and admins | Runs of the team's factories, when the agent asks for it |
| `personal` | You | Only runs you triggered: work you sent, or work whose requester resolves to your account |

When both scopes have a secret with the same name, a run you triggered gets your personal one.

### Types

| Type | Value | Gives the run |
| --- | --- | --- |
| `raw` | a string | An environment variable named after the secret |
| `docker_registry` | `{ host, username, password }` | Nothing in the environment. It is a private image credential. See [Private images](#private-images). |
| `aws_ecr` | `{ roleArn, region }` (team scope only) | Nothing in the environment. It is an image credential. See [Private images](#private-images). |
| `anthropic_api_key` | a string | `ANTHROPIC_API_KEY` |
| `claude_oauth_token` | a string from `claude setup-token` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `chatgpt_auth` | Codex's `auth.json` from a ChatGPT sign-in (use **Sign in with ChatGPT** under Team settings → Model keys) | Nothing in the environment. Codex runs get it as their `auth.json`. See [ChatGPT logins](../infrastructure/harnesses.md#chatgpt-logins). |
| `anthropic_bedrock_api_key` | a string, or `{ apiKey, region }` | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK=1` |
| `anthropic_bedrock_access_key` | `{ accessKeyId, secretAccessKey, sessionToken?, region }` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK=1` |
| `openai_api_key` | a string | `OPENAI_API_KEY` |
| `openrouter_api_key` | a string | `OPENROUTER_API_KEY` |
| `google_api_key` | a string | `GOOGLE_GENERATIVE_AI_API_KEY` |

Kiln checks each value against its type. Secret names use letters, digits and underscores.

Manage secrets with `GET /api/v1/managed-secrets`, `POST /api/v1/managed-secrets`, `PATCH /api/v1/managed-secrets/<scope>/<name>` (new value or description) and `DELETE /api/v1/managed-secrets/<scope>/<name>`.

### How runs get secrets

- **Agent secrets:** an agent's `secrets` list names the secrets its runs get. Typed secrets give their provider variables. Agents get no secrets they do not list.
- **Harness credentials:** with `harness.auth: { source: secret, secretName: X }`, a typed secret `X` gives its provider variables. A raw secret goes to the harness's usual variable. Without `harness.auth`, Kiln picks the first credential the harness can use, from typed secrets and the names in [Harnesses](../infrastructure/harnesses.md#credentials). Claude Code also accepts Bedrock credentials.
- **Lookup order** for a name: your personal secret (for runs you triggered), then the team secret, then the server's secrets (the older admin `PUT /api/v1/secrets/<name>` store, model-provider environment variables and `KILN_SECRET_<NAME>`).
- **Redaction:** Kiln replaces every secret value a run could see with `[redacted]` in its events, tool output and summary.
- **Encryption:** with `KILN_SECRET_KEY` set, values are sealed with AES-256-GCM in the store. Without it they are stored in plain text, so set it on any shared server.
- **Rotating the key:** set the new value as `KILN_SECRET_KEY` and the old one as `KILN_SECRET_KEY_PREVIOUS`, then restart the API. It reads secrets sealed with either key, reseals them (and the GitHub App's credentials) with the new one, and logs how many. Remove `KILN_SECRET_KEY_PREVIOUS` afterwards. Run tokens signed with the old key stop working at once, so runs in progress lose access to the API; a new key alone, without the previous one, leaves sealed secrets unreadable and the API does not start.

### Team-managed model keys

Team owners and admins set one key per provider with `PUT /api/v1/teams/<team>/model-keys/<provider>`:

| Provider | Team secret | Type |
| --- | --- | --- |
| `anthropic` | `KILN_MODEL_ANTHROPIC` | `anthropic_api_key` |
| `openai` | `KILN_MODEL_OPENAI` | `openai_api_key` |
| `openrouter` | `KILN_MODEL_OPENROUTER` | `openrouter_api_key` |
| `bedrock` | `KILN_MODEL_BEDROCK` | `anthropic_bedrock_access_key`, or `anthropic_bedrock_api_key` when you send an API key |

Runs without their own harness credential use these. `GET /api/v1/teams/<team>/model-keys` shows which keys are set.

## MCP servers ("MCPs and apps")

Team owners and admins register MCP servers for the team. Agents name them in `mcpServers`, by name or id.

A server is opt-in: an agent gets it only when it lists it. Turn on **Give to all agents** (`allAgents: true` in the API) and every agent in every factory of the team gets it on top of its own list, including automation runs that replace `mcpServers`. Use it for shared tools like an observability server.

```json
{ "name": "figma", "url": "https://mcp.figma.com/mcp", "headers": { "Authorization": "Bearer {{FIGMA_TOKEN}}" } }
{ "name": "sentry", "command": "npx", "args": ["-y", "@sentry/mcp-server"], "env": { "SENTRY_TOKEN": "{{SENTRY_TOKEN}}" }, "mode": "direct" }
```

- A server has either `command` with `args` and `env`, or `url` with `headers`.
- `{{NAME}}` refers to a secret, looked up the same way as agent secrets.
- **Connection mode `managed`** (the default for URL servers): Kiln puts the secret values into the harness's MCP config.
- **Connection mode `direct`** (the default for command servers): the config keeps `${NAME}` references, and the values go into the run's environment. Values are never written to disk.
- A server whose secrets are missing, or a name Kiln does not know, is skipped. The run shows an `mcp_skipped` event.
- A run may reach the servers it gets: the host of a URL server, and the host of any URL-valued secret a server uses (such as `JIRA_BASE_URL`), are added to its egress allowlist.

### Templates

**New** under MCPs and apps, or **Add MCP** on an agent, offers templates for common servers: observability (SigNoz, Datadog, New Relic, Better Stack), Sentry, Figma, Linear, GitHub, Playwright and Postgres. A template asks for what the server needs, one labeled field each, with where to find the value. Keys are saved as team secrets and the server is registered for the team under the template's name, so any agent can list it. Some templates ask first how the server runs: SigNoz offers **SigNoz Cloud** (the hosted MCP endpoint for your region) or **Self-hosted** (your own SigNoz; each run starts `signoz-mcp-server`, which the sandbox image ships, with your SigNoz URL and API key). A run can reach the URLs a server is configured with, so a self-hosted SigNoz needs no egress change. Anything else is a custom server: paste its JSON.

### Testing servers

**Test** connects to a server with the team's secrets the way a harness would (MCP `initialize`, then `tools/list`) and shows its tools, or what went wrong: refused credentials, a wrong path, an unreachable host or a missing secret. The same test runs in every scope:

| Where | What it tests |
| --- | --- |
| MCPs and apps → **Test all**, or **Test** on a row | The team's servers, or one of them |
| Factory settings → agent and scorer defaults | The servers in the list, with the factory team's secrets |
| An agent's settings | That agent's servers |

API: `POST /api/v1/mcp-servers/test` with `{}` (the team, admins only), `{ "factory": "<id>" }`, `{ "factory": "<id>", "agent": "<name>" }`, and optionally `"servers": ["<name>"]` to narrow any of them. Command servers start only inside a run's sandbox, so their test checks their secrets and reports `untested`. Kiln never tests servers on `localhost`, loopback or link-local addresses (such as the cloud metadata service).

### Built-in integration servers

These servers can be referenced by id without registering them. They are listed as connected once their secrets exist in the team or on the server.

| `kiln_id` | Server | Needs |
| --- | --- | --- |
| `linear` | Linear's hosted MCP | `LINEAR_API_KEY` |
| `slack` | `@modelcontextprotocol/server-slack` | `SLACK_BOT_TOKEN` |
| `jira` | `mcp-atlassian` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| `github` | GitHub's hosted MCP | `GITHUB_MCP_TOKEN` (use a read-mostly token; agents never get merge rights) |
| `discord` | `mcp-discord` | `DISCORD_BOT_TOKEN` |

Every run also gets the Kiln MCP server with its own run token.

## Environments

An environment is a team template: a Docker image, repositories, setup commands and secrets. Point a factory at one with `environmentId` in `agentDefaults`, an agent or an automation. You can use the id or the name. The most specific setting wins.

```yaml
# factory.yaml
agentDefaults:
  harness: { type: claude-code }
  environmentId: node-24
```

At run time:

- The image is used when the agent names no runner.
- The environment's repositories are cloned next to the factory's.
- Its setup commands run after the runner's setup commands.
- Its secrets are added to the agent's secrets.
- An `environmentId` that the team does not have stops the run with a clear error.

Manage environments with `GET`, `POST`, `PATCH` and `DELETE /api/v1/environments`.

## Private images

A runner pulls a private image with a team secret of type `docker_registry` or `aws_ecr`:

```yaml
# runners/private.yaml
image: ghcr.io/acme/runner:2
backend: docker
platform:
  linux:
    registryCredentialSecretName: GHCR
```

An environment does the same with `registryCredentialSecretName` next to its `image`. That credential is used when the agent names no runner.

- **`docker_registry`:** the secret's `host` must be the image's registry. Bare names such as `acme/runner` are on Docker Hub (`docker.io`).
- **`aws_ecr`:** the image must be on an ECR registry (`<account>.dkr.ecr.<region>.amazonaws.com`). Kiln gets a short-lived password by running `aws ecr get-login-password --region <region>` on the server, with `AWS_ROLE_ARN` set to the secret's role. The server's AWS credentials must be allowed to call `ecr:GetAuthorizationToken`.
- **Docker** pulls with a temporary `DOCKER_CONFIG` that is deleted right after the pull. The credential never enters the container.
- **Kubernetes** gets a `kubernetes.io/dockerconfigjson` Secret as the pod's `imagePullSecrets`. Kiln deletes it with the sandbox.

## Related pages

- [Teams and users](teams-and-users.md)
- [Harnesses](../infrastructure/harnesses.md)
- [Agents](../configuration/agents.md)
- [Admin, RBAC and audit](admin-rbac-audit.md)
