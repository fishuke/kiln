# Warp Factories: reference

Source: https://docs.warp.dev/factories/ (read 2026-10-20). Pages linked from it were checked for the details below.

## Core ideas

- **Factory**: a team of cloud agents attached to repositories that ship together. One factory per product.
- **Work item**: one request (issue, thread, PR, scheduled job). Keeps its context from intake to handoff.
- **Foreman**: the agent you reach with `@alias` from Slack, Linear or Jira. It delegates to other agents.
- **Agents**: Triage, Spec, Code (IMPLEMENT), Review. Each has an `agentType`.
- **Human checkpoints**: spec approval, questions, and merge. The factory never merges.

## Lifecycle

Request → triage → spec (if needed, approved by a person) → implement → review (may loop back) → PR returned to the thread → a person merges.

## Quickstart (as Warp documents it)

1. In the web app, click **+** next to **Factories**.
2. Connect a code host (GitHub, GitLab or Azure DevOps) and pick the organization.
3. Pick repositories and enter a factory name. The name is also the foreman handle.
4. Configure agents. Leave **Code** on so the quickstart ends in a PR.
5. Optionally connect Slack and an issue tracker.
6. Send a first work item from **New Chat**, choosing the factory in the dropdown below the prompt.

Warp recommends one small, verifiable change for the first run.

## Definitions as code (v1alpha1)

Tree rooted at `factory.yaml`: `agents/<name>/agent.md`, `automations/<name>/automation.md`, `runners/<name>.yaml`, `routers/<name>.yaml`, `benchmarks/<suite>/`, `scorers/<name>/scorer.md`, `skills/`, `webhooks/<name>.yaml`.

Validation: Warp validates on save for Warp-managed factories, and through the `warp/factory-config` check for GitHub-backed ones. A broken definition is not applied; the last valid one stays.

## Measure and improve

- **Scorers** grade runs. Default sampling is 25%.
- **Self-improvement** starts a follow-up run after 25 unreviewed failures for an agent, or when the oldest is seven days old. It proposes a PR, and a person reviews it.
- **Benchmarks** compare configurations on pinned tasks.

## Factory MCP

A hosted MCP server lets coding agents create factories, send tasks, pull a task to a local worktree, and hand it back. Warp has no per-factory scopes; Kiln adds them (see PLAN.md).

## Gaps we noticed

- The CLI has no documented commands on the overview page.
- The quickstart needs a code host connection, so a repo-less factory needs the "custom setup" path.
