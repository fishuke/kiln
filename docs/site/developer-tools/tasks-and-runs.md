---
title: Tasks, runs and subagents
description: How tasks and runs look through the API, MCP and SDK — stages, states, sources, errors, follow-ups, subagents and what an agent's run token may do.
owner: docs
section: Developer tools
---

A **task** is a work item seen through the API: one request with its conversation, runs and outputs. A **run** is one agent execution. The foreman path starts several runs per task; agents can start subagents, so runs form a tree whose first run is the task's root.

## Dispatching work

```bash
curl -X POST "$KILN_URL/api/v1/factories/webapp/runs" -H "authorization: Bearer $KILN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"prompt": "Fix the rounding bug in invoices", "ticket_ref": "linear:PAY-123", "mode": "plan"}'
```

The reply has `taskId`, the first `runId` when one started, `runUrl`, `state` and `foremanAgent`. `ticket_ref` is `<source>:<id>` (`linear:`, `jira:`, `github:owner/repo#12`, or anything else, kept as is). `branch` makes the task work on that branch.

**Modes**: `normal`; `plan` (the factory always writes a plan or spec first and waits for a person to approve it before anything is built); `orchestrate` (the foreman and implement agents are told to split the work across subagents).

## Task stages

| Stage | Kiln states |
| --- | --- |
| `TRIAGE` | received, triaging |
| `SPEC` | planning, awaiting_spec |
| `IMPLEMENT` | building, awaiting_preview |
| `REVIEW` | reviewing, handed_off |
| `COMPLETE` | complete |
| `CANCELLED` | cancelled, failed |

`PATCH …/tasks/{id}` may set any stage. `COMPLETE` needs `decide:merge` and closes the task as a person's confirmation; `CANCELLED` cancels it and every run and subagent still going. `DELETE` is a soft delete. Task outputs (`PLAN`, `PULL_REQUEST`, `SCREENSHOT`, `FILE`, `EXTERNAL_REFERENCE`) come newest first.

## Run states and sources

| State | Meaning |
| --- | --- |
| `QUEUED` | Waiting for a [self-hosted worker](../infrastructure/self-hosted-workers.md). |
| `CLAIMED` | A worker took it and is preparing the sandbox. |
| `INPROGRESS` | The agent is working. |
| `BLOCKED` | Waiting on a person: a command approval, an interrupt, or a paused run. |
| `SUCCEEDED`, `FAILED`, `ERROR`, `CANCELLED` | Finished. `FAILED` means the task could not be done as asked; `ERROR` means the platform failed. |

The coarse `task_status` filter groups them: `running`, `blocked`, `failed`, `cancelled`, `complete`. Each run also has a `source` (`LINEAR`, `SLACK`, `GITHUB_WEBHOOK`, `API`, `CLI`, `MCP`, `WEB_APP`, `SCHEDULED_AGENT`, `ORCHESTRATION`, `SELF_IMPROVEMENT`, `BENCHMARK_TRIAL`, `CUSTOM_WEBHOOK`, …), a `title`, `creator` and `executor`, `rootRunId`, and up to 20 immutable `metadata` keys you can filter on with `metadata[key]=value`.

`GET /api/v1/runs` filters by `state`, `task_status`, `source`, `factory_uid`, `ancestor_run_id`, `artifact_type`, `q`, `creator`, `mine=true`, dates and metadata, sorts with `sort_by`, and pages with `cursor`.

## Errors

Errors carry a `code` from the catalog (`GET /api/v1/errors`): for example `budget_exceeded`, `insufficient_credits`, `integration_not_configured`, `environment_setup_failed` (FAILED) and `internal_error`, `resource_unavailable`, `infrastructure_timeout`, `agent_process_failed` (ERROR). Kiln retries `internal_error` and `resource_unavailable` on the same run up to three times before it reports the run.

## Talking to a run

- `POST /runs/{id}/followups {message, attachments}` steers a live run, or continues a finished one in a new run with the same agent, branch and task.
- `POST /runs/{id}/interrupt` stops what the agent is doing; the run is `BLOCKED` until a follow-up.
- `GET /runs/{id}/timeline`, `/conversation` and `/transcript` show what happened; `/scores` its scores.
- `PUT /runs/{id}/sharing {publicAccess: "VIEWER" | "EDITOR" | null}` shares the run with signed-in people who cannot otherwise see the factory.
- Agents stay alive for follow-ups for `idleTimeoutMinutes` (default 10, 60 for subagents).

## Subagents and run tokens

A running agent gets `KILN_RUN_TOKEN` and the Kiln MCP server. With it, it may:

- read its own task and the runs of its task or run tree, message its task, and upload files;
- start subagents: `POST /runs/{id}/spawn` (MCP `spawn_agent`) or several at once with `run-agents` (`run_agents`). The child's `spawnableBy` decides who may start it; nesting stops at five levels;
- ask the requester a question (`POST /runs/{id}/questions`, MCP `ask_user`) with single- or multi-select options and a recommended option, and read the answer from the gate;
- propose a definition change (`propose_definition_change`) that people review in the inbox;
- call `complete_task`, which closes the task only after its pull request merged.

A run token cannot decide gates, write definitions, see other tasks or factories, merge or approve.

## Related pages

- [API reference](api.md)
- [Kiln MCP](mcp.md)
- [Inbox](../management/inbox.md)
