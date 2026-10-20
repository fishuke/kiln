---
title: API reference
description: Every REST endpoint with its scope, generated from the route table.
owner: docs
section: Developer tools
generated: true
---

Kiln's REST API lives under `/api/v1`. Send `Authorization: Bearer <token>`; each route needs the scope shown for the factory it touches (`admin` grants every scope). The machine-readable document is at `/api/v1/openapi.json`, and the TypeScript SDK (`@kiln/sdk-ts`) wraps every route.

## System

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | Health check |
| GET | `/api/v1/me` | — | The token's subject and grants |
| POST | `/api/v1/guard` | — | Check a shell command against the guardrail (run token) |

## Factories

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/factories` | `read` | List factories you can read |
| GET | `/api/v1/factories/{id}` | `read` | A factory with its resolved definition |

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

## Webhooks

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| POST | `/webhooks/github` | — | GitHub webhook (X-Hub-Signature-256) |
| POST | `/webhooks/slack` | — | Slack Events API (signing secret) |
| POST | `/webhooks/linear` | — | Linear webhook (Linear-Signature) |
| POST | `/webhooks/jira` | — | Jira webhook (?token=) |
| POST | `/webhooks/{factory}/{name}` | — | A factory's custom webhook from webhooks/<name>.yaml |

## Errors

Errors are JSON: `{ "error": "message" }` with status 400 (invalid request; `issues` lists the fields), 401 (missing or invalid token), 403 (token lacks the scope), 404 (unknown resource) or 409 (wrong state).

## Related pages

- [CLI reference](cli.md)
- [Kiln MCP](mcp.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
