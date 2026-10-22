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
| GET | `/metrics` | — | Prometheus metrics (KILN_METRICS_TOKEN protects it when set) |

## Users

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | — | You: user, teams, current team, role, per-factory roles and grants |
| PATCH | `/api/v1/me` | — | Update your profile, email, appearance and notification preferences |
| PUT | `/api/v1/me/password` | — | Change your password |
| PUT | `/api/v1/me/avatar` | — | Upload your avatar (raw image body, at most 1 MiB) |
| GET | `/api/v1/users/{id}/avatar` | — | A user's uploaded avatar |
| GET | `/api/v1/me/notifications` | — | Recent notifications Kiln sent you (email, Slack, Discord) and their status |
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
| POST | `/api/v1/teams/{team}/storage/{category}/test` | — | Check a storage target (artifacts, transcripts, attachments) by writing and reading an object |
| GET | `/api/v1/teams/{team}/model-keys` | — | Which team-managed model keys are set |
| PUT | `/api/v1/teams/{team}/model-keys/{provider}` | — | Set the team's Anthropic, OpenAI, OpenRouter or Bedrock key |
| DELETE | `/api/v1/teams/{team}/model-keys/{provider}` | — | Remove a team-managed model key |
| GET | `/api/v1/teams/{team}/claude-tokens` | — | The team's Claude subscription tokens with status and 5-hour and 7-day usage |
| POST | `/api/v1/teams/{team}/claude-tokens/{name}/check` | — | Check a Claude token with one minimal run (uses a little of its quota) |
| GET | `/api/v1/teams/{team}/chatgpt-logins` | — | The team's ChatGPT logins (and yours) with status and usage |
| POST | `/api/v1/teams/{team}/chatgpt-logins/sign-in` | — | Sign in with ChatGPT: returns a link and a one-time code to approve |
| GET | `/api/v1/teams/{team}/chatgpt-logins/sign-in/{id}` | — | A ChatGPT sign-in: pending, succeeded, failed or cancelled |
| DELETE | `/api/v1/teams/{team}/chatgpt-logins/sign-in/{id}` | — | Cancel a pending ChatGPT sign-in |
| POST | `/api/v1/teams/{team}/chatgpt-logins/{name}/check` | — | Check a ChatGPT login with one minimal Codex run (uses a little of its quota) |

## Integrations

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/api/v1/connections/github/app-manifest` | — | Start creating Kiln's own GitHub App from a manifest (admins); post `manifest` to `action` from the browser |
| GET | `/api/v1/connections/github/app` | — | Kiln's first GitHub App, if one was created here (no secrets) |
| GET | `/api/v1/connections/github/apps` | — | Every GitHub App created here, one per account or organization (no secrets) |
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
| POST | `/api/v1/factories` | `definitions:write` | Create a factory (the setup wizard in one call): repos, agents, communications, tracker, cost preset, self-improvement, automation templates |
| POST | `/api/v1/factories/{id}/learning` | `definitions:write` | Enable learning: a run that studies the repos and tools and proposes memories and prompt changes |
| GET | `/api/v1/forge/repositories` | — | Repositories the code forge can reach (for the wizard and list_forge_repositories) |
| GET | `/api/v1/tracker/scopes` | — | Tracker teams or projects (for the wizard and list_tracker_scopes) |

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
| POST | `/api/v1/mcp-servers/test` | — | Test MCP servers: the team's, a factory's agents' or one agent's (connects and lists tools) |
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
| GET | `/api/v1/variables` | — | Variable layers of a team, project, factory or App, one per environment (no secret values) |
| GET | `/api/v1/variables/resolve` | — | The variables an environment resolves to for a project, factory or App, and where each comes from |
| PUT | `/api/v1/variables/{scope}/{owner}/{environment}` | — | Replace a layer's variables (a secret sent without a value keeps its value) |
| DELETE | `/api/v1/variables/{scope}/{owner}/{environment}` | — | Delete a layer |

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
| GET | `/api/v1/factory-files/schemas` | — | Published definition schema versions (no token; ETag) |
| GET | `/api/v1/factory-files/schemas/{version}` | — | Every schema document of a version (no token; ETag) |
| GET | `/api/v1/factory-files/schemas/{version}/{document}` | — | One schema document, e.g. agent.schema.json (no token; ETag) |
| POST | `/api/v1/factory-files/validate` | — | Validate files without saving: diagnostics and deferred resolutions (no token; ≤256 files, ≤256 KB each, ≤2 MB) |
| GET | `/api/v1/factories/{id}/files` | `read` | Every file of the applied definition (path and size) |
| GET | `/api/v1/factories/{id}/files/{path}` | `read` | One definition file |
| PUT | `/api/v1/factories/{id}/files/{path}` | `definitions:write` | Write one file: managed factories validate and apply; repo-backed factories get a PR |
| DELETE | `/api/v1/factories/{id}/files/{path}` | `definitions:write` | Delete one file (same rules as PUT) |
| POST | `/api/v1/factories/{id}/files:batch` | `definitions:write` | Change several files in one commit: {changes:[{path, content|null}], message} → {applied: sha} or {pullRequest: url} |
| POST | `/api/v1/factories/{id}/files/commit` | `definitions:write` | Change several files in one commit with a message (null deletes); dryRun validates only |
| GET | `/api/v1/factories/{id}/agents` | `read` | Agents with their resolved settings and prompts |
| PUT | `/api/v1/factories/{id}/agents/{name}` | `definitions:write` | Create or update an agent (prompt, harness, model, runner, workerHost, MCPs, secrets, spawnableBy, idle timeout, computer use, network policy) |
| DELETE | `/api/v1/factories/{id}/agents/{name}` | `definitions:write` | Delete an agent (not the foreman) |
| PUT | `/api/v1/factories/{id}/automations/{name}` | `definitions:write` | Create or update an automation |
| DELETE | `/api/v1/factories/{id}/automations/{name}` | `definitions:write` | Delete an automation |
| PUT | `/api/v1/factories/{id}/runners/{name}` | `definitions:write` | Create or update a runner (image or platform, shape, setup commands, egress, failure retention) |
| DELETE | `/api/v1/factories/{id}/runners/{name}` | `definitions:write` | Delete a runner |
| PUT | `/api/v1/factories/{id}/routers/{name}` | `definitions:write` | Create or replace a model router (complexity or prompt) |
| DELETE | `/api/v1/factories/{id}/routers/{name}` | `definitions:write` | Delete a router |
| PUT | `/api/v1/factories/{id}/skills/{name}` | `definitions:write` | Create or update a skill (shared, or one agent's with `agent`) |
| DELETE | `/api/v1/factories/{id}/skills/{name}` | `definitions:write` | Delete a skill (?agent= for an agent's own) |
| GET | `/api/v1/factories/{id}/settings` | `read` | Factory settings from factory.yaml plus the avatar and where the definition lives |
| PATCH | `/api/v1/factories/{id}/settings` | `definitions:write` | Change name, alias, description, repositories, credential strategy, agent and scorer defaults, self-improvement, benchmarking model |
| POST | `/api/v1/factories/{id}/avatar` | `definitions:write` | Set the avatar from an uploaded image (file key) |
| POST | `/api/v1/factories/{id}/migrate` | `definitions:write` | Move a Kiln-managed factory to a GitHub repo (opens a PR; the merge switches it over) |
| POST | `/api/v1/factories/{id}/migrate/complete` | `definitions:write` | Finish the move once the migration PR merged |

## Work items

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/work-items` | `read` | List work items |
| POST | `/api/v1/work-items` | `send` | Send work to a factory |
| GET | `/api/v1/work-items/{id}` | `read` | A work item with its runs, gates and decisions |
| POST | `/api/v1/work-items/{id}/messages` | `send` | Message the foreman (answers an open question, or resumes a blocked task with none open) |
| POST | `/api/v1/work-items/{id}/retry` | `send` | Restart a blocked work item at the stage that stopped |
| POST | `/api/v1/work-items/{id}/cancel` | `send` | Cancel a work item |
| POST | `/api/v1/work-items/{id}/complete` | `decide:merge` | Confirm a handed-off item landed (human only) |
| POST | `/api/v1/work-items/{id}/pull` | `send` | Take a task to a local worktree |
| POST | `/api/v1/work-items/{id}/handback` | `send` | Hand a local task back to the factory |

## Runs

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/runs` | `read` | List runs: state[], task_status[], source[], factory_uid[], ancestor_run_id, artifact_type, q, creator, mine, created/updated filters, metadata[key]=, sort_by, cursor |
| GET | `/api/v1/runs/{id}` | `read` | A run with its state, source, root run, task and scores |
| GET | `/api/v1/runs/{id}/events` | `read` | Run events after a sequence number |
| GET | `/api/v1/runs/{id}/stream` | `read` | Run events as server-sent events |
| POST | `/api/v1/runs/{id}/steer` | `send` | Send a steering message to a running agent |
| POST | `/api/v1/runs/{id}/replay` | `send` | Replay from the saved start state, optionally under another sha |
| POST | `/api/v1/runs/{id}/pause` | `send` | Snapshot and pause a running agent |
| POST | `/api/v1/runs/{id}/resume` | `send` | Resume a paused run on any node |
| POST | `/api/v1/runs/{id}/cancel` | `send` | Cancel a run |
| POST | `/api/v1/agent-runs` | `send` | Start a run of one agent directly (no task): prompt, mode, metadata, attachments, model, workerHost |
| GET | `/api/v1/runs/{id}/timeline` | `read` | Lifecycle, events and subagent starts/finishes in time order |
| GET | `/api/v1/runs/{id}/conversation` | `read` | The run as normalized messages (instructions, prompt, agent, tools, steering) |
| GET | `/api/v1/runs/{id}/transcript` | `read` | Plain-text transcript |
| GET | `/api/v1/runs/{id}/scores` | `read` | Every score of the run, with how it was triggered |
| POST | `/api/v1/runs/{id}/followups` | `send` | Follow-up message (with attachments): steers a live run, continues a finished one |
| POST | `/api/v1/runs/{id}/score` | `send` | Score the run now with the scorers that cover its agent (or `scorers`); re-scoring replaces |
| POST | `/api/v1/runs/{id}/interrupt` | `send` | Stop what the agent is doing; the run waits (BLOCKED) for a follow-up |
| POST | `/api/v1/runs/{id}/spawn` | `send` | Start a subagent (run token of this run, or send scope); spawnableBy decides who may start whom |
| POST | `/api/v1/runs/{id}/run-agents` | `send` | Start several subagents at once |
| POST | `/api/v1/runs/{id}/questions` | `send` | Ask the requester (single or multi select, recommended option); answer arrives on the gate |
| PUT | `/api/v1/runs/{id}/sharing` | `send` | Share the run with signed-in people as VIEWER or EDITOR (null stops sharing) |
| GET | `/api/v1/run-by-external-reference` | `read` | The run behind a PR, issue, thread or Kiln URL (?url=) |
| GET | `/api/v1/errors` | — | Error catalog: codes, HTTP status, retryable, FAILED vs ERROR |

## Benchmarks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/api/v1/runs/{id}/save-benchmark` | `definitions:write` | Save a finished run as a benchmark task |
| GET | `/api/v1/factories/{id}/benchmarks` | `read` | Benchmark results and Pareto summary |
| POST | `/api/v1/factories/{id}/benchmarks/{suite}/run` | `definitions:write` | Run a benchmark suite |
| POST | `/api/v1/factories/{id}/benchmarks/{suite}/router` | `definitions:write` | Propose routing rules from results |
| GET | `/api/v1/factories/{id}/benchmark-suites` | `read` | Benchmark suites with their tasks |
| POST | `/api/v1/factories/{id}/benchmark-suites` | `definitions:write` | Create a suite (with its first task) |
| GET | `/api/v1/factories/{id}/benchmark-suites/{suite}` | `read` | One suite |
| PATCH | `/api/v1/factories/{id}/benchmark-suites/{suite}` | `definitions:write` | Update a suite (agent, configurations, tasks) |
| DELETE | `/api/v1/factories/{id}/benchmark-suites/{suite}` | `definitions:write` | Delete a suite's files (runs and results stay) |
| POST | `/api/v1/factories/{id}/benchmark-suites/{suite}/tasks` | `definitions:write` | Add a task (idempotent on identical content; same title is a conflict) |
| GET | `/api/v1/factories/{id}/benchmark-suites/{suite}/tasks/{task}` | `read` | One task |
| PATCH | `/api/v1/factories/{id}/benchmark-suites/{suite}/tasks/{task}` | `definitions:write` | Update a task |
| DELETE | `/api/v1/factories/{id}/benchmark-suites/{suite}/tasks/{task}` | `definitions:write` | Delete a task |
| POST | `/api/v1/factories/{id}/benchmark-suites/{suite}/runs` | `definitions:write` | Run the suite: configurations (harness/model/router/runner per agent), repetitions, scorers, tasks. Not idempotent |
| GET | `/api/v1/factories/{id}/benchmark-suites/{suite}/runs` | `read` | Benchmark runs of a suite (?state=) |
| GET | `/api/v1/benchmark-runs/{id}` | `read` | A benchmark run |
| POST | `/api/v1/benchmark-runs/{id}/cancel` | `definitions:write` | Cancel while running or scoring |
| GET | `/api/v1/benchmark-runs/{id}/results` | `read` | Per-configuration metrics, recommendation, Pareto chart data, spend and narrative |
| GET | `/api/v1/benchmark-runs/{id}/trials` | `read` | Trials (?task, configuration, agent_run_id) |
| GET | `/api/v1/benchmark-trials/{id}` | `read` | One trial with its scores |
| POST | `/api/v1/runs/{id}/benchmark-task` | `definitions:write` | Turn a finished run into a benchmark task of a suite |

## Inbox

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/inbox` | — | Open decisions (gates), most urgent first |
| GET | `/api/v1/gates/{id}` | `read` | A gate with its work item |
| POST | `/api/v1/gates/{id}/decide` | `decide:*` | Approve, reject or answer (scope depends on the gate kind) |
| GET | `/api/v1/inbox/items` | — | Inbox items: question, answer_question, spec_review, pr_review, studio_pr_review, blocked, failed (scope mine|team, factory, kind, read, q) |
| POST | `/api/v1/inbox/read` | — | Mark items read |
| POST | `/api/v1/inbox/unread` | — | Mark items unread |
| POST | `/api/v1/inbox/resolve` | — | Resolve (hide) items for you |
| POST | `/api/v1/inbox/unresolve` | — | Undo a resolve |
| GET | `/api/v1/gates/{id}/retry` | `decide:spec` | What a spec retry can run on: the spec agent's harness and model, the factory's routers and the model that wrote the spec |
| POST | `/api/v1/gates/{id}/retry` | `decide:spec` | Write the spec again from scratch (a spec review or a failed spec), optionally on another model for that run |
| GET | `/api/v1/factories/{id}/definition-changes` | `read` | Proposed definition changes (?state=open|merged|changes_requested|rejected) |
| POST | `/api/v1/factories/{id}/definition-changes` | `send` | Propose a definition change for review (agents and people) |
| GET | `/api/v1/definition-changes/{id}` | `read` | A proposed change with its diff and comments |
| POST | `/api/v1/definition-changes/{id}/approve` | `definitions:write` | Approve & merge: apply it (managed) or open the config-repo PR |
| POST | `/api/v1/definition-changes/{id}/request-changes` | `definitions:write` | Request changes; the comments go back to the proposing agent |
| POST | `/api/v1/definition-changes/{id}/comments` | `read` | Comment on the diff (optionally a path and line) |
| POST | `/api/v1/definition-changes/{id}/reject` | `definitions:write` | Reject the change |

## Planning

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/projects` | — | List projects |
| POST | `/api/v1/projects` | `send` | Create a project over factories |
| GET | `/api/v1/projects/{id}` | — | A project with its roadmap and work items |
| POST | `/api/v1/projects/{id}/plan` | `send` | Goal or PRD to roadmap and tracker issues |
| GET | `/api/v1/portfolio` | — | Cross-factory rollup |
| GET | `/api/v1/digest` | — | Pending decisions per person (current team) |
| GET | `/api/v1/decisions` | — | Typed decision logs for work and runs you can see (optionally one work item) |

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
| GET | `/api/v1/factories/{id}/metrics` | `read` | Runs, PRs, merged, autonomy funnel, impact, PR latency medians, human interactions per PR, deltas (start_date, end_date (RFC 3339, default last 30 days), group_by_period day|week|month) |
| GET | `/api/v1/factories/{id}/costs/per-pr` | `read` | Cost per PR: total, mean, median by component (start_date, end_date (RFC 3339, default last 30 days), group_by_period day|week|month) |
| GET | `/api/v1/factories/{id}/costs/breakdown` | `read` | Spend by group_by=source|user|agent|model (source and user roll up to the root run) |
| GET | `/api/v1/factories/{id}/costs/per-pr/top` | `read` | Most expensive PRs (?limit ≤ 50, default 20) |
| GET | `/api/v1/factories/{id}/costs/per-pr/by-size` | `read` | Cost per PR by size: S < 100, M < 500, L < 1000, XL changed lines |
| GET | `/api/v1/factories/{id}/metrics/run-breakdown` | `read` | Run counts by group_by=agent_type|status|source|root_vs_subrun|model|harness |
| GET | `/api/v1/factories/{id}/pull-requests` | `read` | PRs produced by the factory: repo, state[], opened/merged after/before, updated_after, cursor |
| GET | `/api/v1/factories/{id}/self-improvement/settings` | `read` | Self-improvement toggle, threshold, reviewers, model and per-scorer toggles |
| PUT | `/api/v1/factories/{id}/self-improvement/settings` | `definitions:write` | Change self-improvement settings and per-scorer toggles in one change |

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

## Automations

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/automation-templates` | — | Default and suggested automation files (?factory fills them in) |
| POST | `/api/v1/factories/{id}/automations/from-template` | `definitions:write` | Add a template to a Kiln-managed factory |
| GET | `/api/v1/automation-catalog` | — | Every trigger provider, event and filter key |
| GET | `/api/v1/deliveries` | `admin` | Recent provider deliveries |
| POST | `/api/v1/factories/{id}/automations/{name}/run` | `send` | Run an automation now, as the caller |
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

## Files

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/api/v1/uploads` | `send` | Upload files (multipart, up to 25 files of 25 MB): {key, name, contentType, size} of the first plus `attachments` |
| GET | `/api/v1/files/{key}` | `read` | Download a stored file (uploads, run artifacts, evidence) with its content type; supports Range |

## Tasks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/api/v1/factories/{id}/runs` | `send` | Dispatch a prompt to the factory's foreman (optional ticket_ref, ticket_url, branch, mode) |
| GET | `/api/v1/factories/{id}/tasks` | `read` | List tasks: stage[], created_by[], q, created/updated after/before, sort, cursor, include_current_run |
| POST | `/api/v1/factories/{id}/tasks` | `send` | Create a task for a conversation without starting work (one live task per conversation) |
| GET | `/api/v1/factories/{id}/tasks/{taskId}` | `read` | A task with its stage, outputs and current run |
| PATCH | `/api/v1/factories/{id}/tasks/{taskId}` | `send` | Change title, description or stage (any direction; COMPLETE and CANCELLED close it) |
| DELETE | `/api/v1/factories/{id}/tasks/{taskId}` | `send` | Soft-delete a task (cancels it first when it is still active) |
| POST | `/api/v1/factories/{id}/tasks/{taskId}/cancel` | `send` | Cancel the task and every run and subagent of it that is still going |
| POST | `/api/v1/factories/{id}/tasks/{taskId}/complete` | `send` | complete_task: close the task after its PR merged (agents) or as a person's confirmation (decide:merge) |
| GET | `/api/v1/factories/{id}/tasks/{taskId}/outputs` | `read` | Task outputs newest first: PLAN, PULL_REQUEST, SCREENSHOT, FILE, EXTERNAL_REFERENCE |
| GET | `/api/v1/factories/{id}/task-by-run` | `read` | The task a run (any run in its tree) belongs to (?run_id=) |
| GET | `/api/v1/factories/{id}/task-by-conversation` | `read` | The task of a conversation (?conversation_id=) |
| GET | `/api/v1/tasks` | `read` | Tasks across the factories you can read (same filters as the factory list, plus factory) |
| GET | `/api/v1/tasks/lookup` | `read` | Find a task by id, run, PR or issue URL, tracker key or branch (?reference=, &start_working=true for local commands) |
| POST | `/api/v1/tasks/{taskId}/handback` | `send` | Hand a locally worked task back with a note and the pushed branch or PR |
| GET | `/api/v1/tasks/{id}/review` | `read` | The task's pull request for review: changed files with patches, review findings, and whether you can review as your linked GitHub account |
| POST | `/api/v1/tasks/{id}/review` | `decide:merge` | Submit a review (APPROVE, REQUEST_CHANGES, COMMENT, line comments) as your linked GitHub account; requested changes go to the agents |
| POST | `/api/v1/tasks/{id}/merge` | `decide:merge` | Merge the task's pull request as your linked GitHub account |
| GET | `/api/v1/ready-to-merge` | — | Handed-off tasks that need no code review, only a person's merge (?factory=) |

## Scorers

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories/{id}/scorers` | `read` | Scorers with result counts, last scored time and kind (user | benchmark_task_correctness) |
| POST | `/api/v1/factories/{id}/scorers` | `definitions:write` | Create a scorer (writes scorers/<slug>/scorer.md; a PR for repo-backed factories). Does not score past runs |
| GET | `/api/v1/factories/{id}/scorers/{slug}` | `read` | One scorer with its rubric |
| PATCH | `/api/v1/factories/{id}/scorers/{slug}` | `definitions:write` | Update a scorer (bumps its version) |
| DELETE | `/api/v1/factories/{id}/scorers/{slug}` | `definitions:write` | Delete a scorer and every score it recorded |
| GET | `/api/v1/factories/{id}/scorers/{slug}/results` | `read` | Results (classification, score, outcome, reason with include_reasons, run_id filter, cursor) |
| GET | `/api/v1/factories/{id}/scorers/{slug}/metrics` | `read` | Pass/fail counts, pass rate and series; include_cost adds judge cost |
| POST | `/api/v1/factories/{id}/scorers/{slug}/dispatch` | `send` | Score up to 100 runs now (bypasses sampling; re-scoring replaces) |
| POST | `/api/v1/factories/{id}/runs/{runId}/scorer-dispatch` | `send` | Score a run with up to 100 scorers now |

## Workers

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/workers` | `read` | Connected self-hosted workers with their last heartbeat, and the run queue |
| POST | `/api/v1/workers/connect` | `worker` | A worker process connects (kiln worker) and gets its instance id |
| POST | `/api/v1/workers/{instance}/heartbeat` | `worker` | Heartbeat; the reply carries cancellations and steering for its runs |
| POST | `/api/v1/workers/{instance}/claim` | `worker` | Long-poll for a run routed to this worker id (?wait= seconds, default 25) |
| POST | `/api/v1/workers/{instance}/runs/{runId}/events` | `worker` | Stream a run's events back |
| POST | `/api/v1/workers/{instance}/runs/{runId}/complete` | `worker` | Report a run's result, artifacts and pushed branches |
| DELETE | `/api/v1/workers/{instance}` | `worker` | Disconnect; its running runs fail and are retried |

## Studio

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/studio/apps` | `read` | Your team's Studio Apps |
| POST | `/api/v1/studio/apps` | `send` | Create an App from a template or a repository your team may use; it starts as creating |
| GET | `/api/v1/studio/apps/{id}` | `read` | An App with its chats and versions (newest first) |
| PATCH | `/api/v1/studio/apps/{id}` | `send` | Rename an App, change its Kiln Project or dev command |
| PUT | `/api/v1/studio/apps/{id}/ship-mode` | `send` | Change an App's ship mode, up to the highest mode the App's policy allows your team role |
| POST | `/api/v1/studio/apps/{id}/ship` | `send` | Open or update the App's pull request; as its author, mark it ready for review; or cancel it |
| POST | `/api/v1/studio/apps/{id}/pause` | `send` | Snapshot an App's workspace and free its sandbox; the next use resumes it |
| POST | `/api/v1/studio/apps/{id}/chats` | `send` | Start a chat (its own worktree and preview), optionally with a first message |
| GET | `/api/v1/studio/chats/{id}` | `read` | A chat with its turns (oldest first) |
| POST | `/api/v1/studio/chats/{id}/messages` | `send` | Send a message: starts a turn, or steers the running one |
| POST | `/api/v1/studio/chats/{id}/apply` | `send` | Apply a chat's checkpoints to the App's main line as a version |
| GET | `/api/v1/studio/chats/{id}/diff` | `read` | The chat's changes since it branched or was last applied |
| GET | `/api/v1/studio/chats/{id}/preview` | `read` | The chat's live preview (starts its dev server) |
| GET | `/api/v1/studio/chats/{id}/events` | `read` | Server-sent events from the chat's Studio events: the chat and the turn each event names |
| POST | `/api/v1/studio/versions/{id}/restore` | `send` | Restore a version as a new version |
| POST | `/api/v1/studio/versions/{id}/bookmark` | `send` | Pin or unpin a version |
| GET | `/api/v1/studio/versions/{id}/diff` | `read` | A version's changes against its parent |
| GET | `/api/v1/studio/versions/{id}/preview` | `read` | Preview an earlier version |
| GET | `/api/v1/studio/status` | `read` | What is working and what needs you, across your team's Apps |
| GET | `/api/v1/studio/events` | `read` | Server-sent events for your team's Apps: Studio events and merge gate reviews |
| POST | `/api/v1/studio/tools/{name}` | `send` | Run a Studio tool by name (status, open_app, new_chat, send, apply, restore, bookmark, look, ship, set_ship_mode, focus, show); status, look, focus and show need read, the rest send |
| GET | `/api/v1/studio/apps/{id}/definition` | — | An App's own Studio definition layer: tree, sha and history |
| PUT | `/api/v1/studio/apps/{id}/definition` | — | Replace an App's own definition layer (kiln/v1 App tree) |
| PATCH | `/api/v1/studio/apps/{id}/definition` | — | Change an App's own definition layer from settings |
| POST | `/api/v1/studio/apps/{id}/definition/use` | — | Point an App's own definition layer at an earlier sha |
| GET | `/api/v1/studio/projects/{id}/definition` | — | A Kiln Project's Studio definition layer: tree, sha and history |
| PUT | `/api/v1/studio/projects/{id}/definition` | — | Replace a Kiln Project's definition layer (kiln/v1 App tree) |
| PATCH | `/api/v1/studio/projects/{id}/definition` | — | Change a Kiln Project's definition layer from settings |
| POST | `/api/v1/studio/projects/{id}/definition/use` | — | Point a Kiln Project's definition layer at an earlier sha |
| GET | `/api/v1/studio/team/definition` | — | The team's Studio definition layer: tree, sha and history |
| PUT | `/api/v1/studio/team/definition` | — | Replace the team's definition layer (kiln/v1 App tree) |
| PATCH | `/api/v1/studio/team/definition` | — | Change the team's definition layer from settings |
| POST | `/api/v1/studio/team/definition/use` | — | Point the team's definition layer at an earlier sha |
| GET | `/api/v1/studio/apps/{id}/settings` | — | An App's resolved settings and its own values |
| GET | `/api/v1/studio/team/settings` | — | The team's Studio defaults, resolved |
| GET | `/api/v1/studio/projects/{id}/settings` | — | A Kiln Project's Studio defaults, resolved |
| GET | `/api/v1/studio/apps/{id}/definition/export` | — | An App's definition in kiln/v1 layout (?resolved=false for its own layer) |

## Merge gate

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/merge-gate/reviews` | — | Pull requests the merge gate judged for the current team's Studio Apps (?state=) |
| GET | `/api/v1/merge-gate/reviews/{id}` | — | One merge gate review: merged or sent to review, the reasons and the merge-safety answers |

## Errors

Errors are JSON: `{ "error": "message" }` with status 400 (invalid request; `issues` lists the fields), 401 (missing or invalid token), 402 (`{ "error": "budget_exceeded", "message": ... }`: the team's spend limit is reached and auto-stop is on), 403 (token lacks the scope), 404 (unknown resource), 409 (wrong state or already exists), 410 (expired invite) or 413 (upload too large).

## Related pages

- [CLI reference](cli.md)
- [Kiln MCP](mcp.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
- [Teams and users](../management/teams-and-users.md)
