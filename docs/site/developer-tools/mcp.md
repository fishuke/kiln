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
| `ask_user` | Ask the requester a question and get a gate id; read the answer with get_gate. Questions can be single or multi select with a recommended option. |
| `complete_task` | Close a task. Safe to call more than once. A factory agent may close it only after its pull request merged; a person (decide:merge) confirms completion. Pass task_id, or run_id to find the task. |
| `create_factory` | Create a factory: repos, agents to enable (the foreman is always there), Slack, tracker, cost preset, self-improvement and starter automations. Use dry_run first to show the files. |
| `create_team` | Create a team. You become its owner. Needs a user token (session or personal API key). |
| `decide_gate` | Approve, reject or answer a gate. Needs the decide scope for the gate's kind. |
| `follow_up_run` | Send a follow-up to a run: steers it while it runs, continues it when it finished. |
| `get_app_settings` | A Studio App's definition: its agents (model, MCP servers, skills), shared skills (mandatory ones marked), ship mode cap, merge gate and budget, resolved from team and project defaults, plus what the App sets itself. |
| `get_conversation` | A task's conversation (requests, foreman messages, agent summaries, decisions), or a run's normalized conversation. |
| `get_factory_file_schema` | The definition schema catalog, or one document (e.g. agent.schema.json, factory.schema.json). |
| `get_gate` | A gate (decision) and its answer. |
| `get_metrics` | Factory metrics: PRs opened and merged, autonomy, cycle time, cost and cost per merged PR by agent (`since`), plus the autonomy funnel, PR latency medians, human interactions and period-over-period deltas (`start_date`, `end_date`, `group_by_period`). Dates are ISO. |
| `get_run` | A run's state, summary, result, artifacts and children. With conversation=true, its messages too. |
| `get_task` | Get a task by id or reference (task or run URL, PR URL, issue URL or key, branch). With start_working=true, also returns git commands to continue it in a local worktree. |
| `join_team` | Join a team by accepting an invite. Takes the invite token or the whole invite link. |
| `list_factories` | List the factories this token can see. |
| `list_forge_repositories` | Repositories the code forge can reach, for picking a new factory's repos. |
| `list_inbox` | Your inbox: questions, spec and PR reviews, blocked and failed tasks, definition changes. all=true lists the team's. |
| `list_notification_routes` | Where updates about a task go: the originating thread, issue or PR. |
| `list_tasks` | List tasks, newest first. Filter by factory, stage, creator (email) and dates (ISO). |
| `list_teams` | List the teams you belong to, with your role in each. Pass a team's slug as X-Kiln-Team to act in it. |
| `list_tracker_scopes` | Teams (Linear) or projects (Jira) of the connected tracker. |
| `message_foreman` | Message the foreman of a task. Answers its open question if there is one. |
| `plan_project` | Turn a goal or PRD into a roadmap and tracker issues for a project. |
| `propose_definition_change` | Propose a change to a factory definition (prompts, skills, settings). People review it in the inbox and approve & merge it. Set a file to null to delete it. |
| `query_runs` | Runs with filters: factory, state (QUEUED…CANCELLED), source, agent, q, created_after. Or raw rows (runs, scores, work_items) with kind. |
| `run_agents` | Start several subagents at once (fan out). Returns their runs. |
| `search_task` | Search task titles and descriptions across factories. |
| `send_task` | Send new work to a factory's foreman (factory, title, note), or hand a task you worked on locally back (task_id, branch or pr_url, note). |
| `spawn_agent` | Start a subagent of your factory for part of the work. Returns at once with the child run; follow it with get_run. Only agents whose spawnableBy allows you can be started. |
| `steer_run` | Send a steering message to a running agent. |
| `studio_apply` | Studio: Apply a chat's changes to the app's main line as a new version. |
| `studio_bookmark` | Studio: Pin or unpin a version. |
| `studio_focus` | Studio: Move the person's screen to an app and, optionally, a chat. (Moves the caller's screen; changes nothing on the server.) |
| `studio_look` | Studio: The live preview of a chat (its URL). |
| `studio_new_chat` | Studio: Start a new chat (a parallel line of work) in an app with one of its agents (default general), optionally with a first message. |
| `studio_open_app` | Studio: Open an app by id, or create one from a name and a source (a template or a repository). |
| `studio_restore` | Studio: Restore an earlier version as a new version; nothing is lost. |
| `studio_send` | Studio: Send a message to a chat: starts a turn, or steers the one that is running. Pass the person's words as they said them. |
| `studio_set_ship_mode` | Studio: Change an App's ship mode (safe, review or cowboy), up to the highest mode the App's policy allows the caller's role. Only a person may. |
| `studio_ship` | Studio: Open or update the App's pull request from its main line; or, as its author, mark it ready for review (the merge gate merges it or sends it to a reviewer); or cancel it. |
| `studio_show` | Studio: Show the preview, the code, the history or the hands-free view in the person's screen. (Moves the caller's screen; changes nothing on the server.) |
| `studio_status` | Studio: What is running and what needs the person, for one app or all of them. |
| `studio_stop` | Studio: Stop the chat's agent; it waits for the next message. |
| `update_app_settings` | Change a Studio App's own definition layer (not its policy, which people change in the App's settings). null removes the App's value so it inherits from its project or team again. Every change is a new version. |
| `validate_factory_files` | Validate a whole definition tree without saving it: diagnostics with file and line, plus what is resolved only when applied. With apply=true and a factory, applies it (definitions:write). |

## Related pages

- [API reference](api.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
