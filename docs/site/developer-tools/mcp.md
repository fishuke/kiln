---
title: Kiln MCP
description: Connect coding agents to Kiln over MCP; every tool and its arguments, generated from the server.
owner: docs
section: Developer tools
generated: true
---

The Kiln MCP server is served at `<public URL>/mcp` over streamable HTTP. Agents use it to send tasks, take them to a local worktree, hand them back, decide gates and query metrics. Every call goes through the API with the caller's token, so per-factory scopes apply: a token with only `decide:preview` cannot write definitions.

## Connect

```bash
claude mcp add --transport http kiln https://kiln.example.com/mcp --header "Authorization: Bearer $KILN_TOKEN"
```

```toml
# ~/.codex/config.toml
[mcp_servers.kiln]
url = "https://kiln.example.com/mcp"
bearer_token_env_var = "KILN_TOKEN"
```

## Setup prompt for an agent

```text
Connect to the Kiln MCP server at https://kiln.example.com/mcp with the bearer token in $KILN_TOKEN.
List my factories, then help me send a task to the right one and follow it through the inbox.
```

## Tools

| Tool | What it does |
| --- | --- |
| `complete_task` | Hand a locally worked task back, or confirm a handed-off task landed (needs decide:merge). |
| `decide_gate` | Approve, reject or answer a gate. Needs the decide scope for the gate's kind. |
| `get_conversation` | The task's conversation: requests, foreman messages, agent summaries and decisions. |
| `get_factory_file_schema` | JSON Schema for a definition file kind. |
| `get_metrics` | Factory metrics: PRs opened/merged, autonomy, cycle time, cost, cost per merged PR by agent, scores. `since` is an ISO date. |
| `get_task` | Get a task by id or by its PR/issue URL. With start_working=true, returns the branch and clone URL to continue locally. |
| `list_factories` | List the factories this token can see. |
| `list_inbox` | Open decisions waiting on people: spec approvals, questions, previews, merges. |
| `message_foreman` | Message the foreman of a task. Answers its open question if there is one. |
| `plan_project` | Turn a goal or PRD into a roadmap and tracker issues for a project. |
| `query_runs` | Raw rows (runs, scores or work_items) for your own analysis. |
| `send_task` | Send work to a factory's foreman. Returns the new task (work item). |
| `steer_run` | Send a steering message to a running agent. |
| `validate_factory_files` | Validate a definition tree (path → content). With apply=true, applies it (needs definitions:write). |

## Related pages

- [API reference](api.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
