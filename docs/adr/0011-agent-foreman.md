# ADR-011: The agent foreman: turns that answer with actions, woken by events

Status: Accepted · Date: 2026-10-21

## Context
The foreman path walks fixed stages (ADR-002). It is predictable, but it can't reason about the work: it can't adjust the plan, explain itself, send review findings back to the agent that has the context, or decide to skip a step. A foreman that is a long-lived agent session does those things, but it holds a session (and a sandbox) open while it waits, polls for events, and loses its place when the process restarts.

## Decision
A factory can set `foreman: { mode: agent }`. The foreman of each task is then an agent that works in **turns**:
- A turn is one FOREMAN agent run. Its prompt is a digest built from the Store (request, conversation, checklist, every agent run with its result, the pull request, people's decisions, open gates) plus the events since the last turn.
- The turn answers with **actions** in `.kiln/result.json` (`say`, `tasks`, `dispatch`, `followUp`, `ask`, `approveSpec`, `waitForCi`, `handOff`, `finish`), validated with zod. Kiln carries them out through the same code the pipeline uses: runs, gates, pull requests, budgets, notifications.
- Between turns nothing runs. Events (`run_finished`, `message`, `gate_decided`, `ci`, `restarted`, `error`, `nudge`) go to the `foreman_events` collection and wake the task through `Workflow.advance`, under the per-item lock. A turn deletes the events it read only after it succeeded.
- Guards: `maxTurns` (default 60) and two turns in a row without a next step park the task with a question; two failed turns park it with the error.

## Consequences
- Waiting costs nothing, and a restart doesn't stop the task: the foreman hears which runs were cut off and decides.
- Durability, the per-item lock, gates and "people merge" (ADR-002, ADR-008) are unchanged. The agent foreman is another way to choose the next step, not a new workflow engine.
- No harness needs session resume: continuity comes from the digest, so every harness works, and every decision is a recorded run with its prompt and result.
- `pipeline` stays the default until the agent mode has proven itself on real work.
