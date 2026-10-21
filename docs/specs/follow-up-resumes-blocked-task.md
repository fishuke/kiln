# Follow-up messages resume a blocked task whose question expired

## Problem
A task parked on a question (for example `spec-failed`, "could not write the spec") stays `blocked` for good once
that question expires. A message from the Follow up box is saved to the conversation
(`POST /api/v1/work-items/{id}/messages` falls through to `workflow.addMessage`), but nothing resumes the task.
Retry spec refuses because the gate is no longer open. The only way out is to cancel and start again.

## User stories
- As a person who sees a blocked task with no question to answer, I type guidance in Follow up and the task carries on,
  so I do not have to cancel and recreate it.
- As a person following up on a running task, my message is just added to the conversation, so I do not disturb it.
- As a person answering a question, my message still answers that question, so nothing changes in the flow I know.

## Behavior
`POST /api/v1/work-items/{id}/messages` (the web Follow up box, CLI and MCP `message`) decides by task state:

| Task state | Open question | Result |
| --- | --- | --- |
| any | yes (not a command approval) | The message answers the question (unchanged). |
| `blocked` | no | The message is added, then the task resumes. |
| anything else | no | The message is added only (unchanged). |

Resuming mirrors the question-answered path in `Workflow.onGateDecided`: clear `blockedReason`, reset `loops`, move
to `building` (reason "resumed after a human message") and `advance` so the pipeline continues at the stage that
stopped. Design: a `Workflow.resumeBlocked(id, by)` method in `packages/engine/src/workflow.ts` (not a protected
path) that the route calls after `addMessage`; `addMessage` itself stays side-effect free because review comments,
hand-backs and definition-change feedback also use it.

## Constraints
- No new agent permission; the route keeps requiring scope `send`. A run token (`c.get("run")`) never resumes a
  task: agents must not un-block their own task, same as they cannot answer its questions today.
- A task `blocked` with an open command-approval gate (`gate.command`) or any other open gate is not resumed by a
  message; that gate still needs its decision.
- Persist the work item before and after, time from the injected Clock (CLAUDE.md).
- `apps/api/src/app.ts` is a protected path: the route change is a few lines there and needs approval before editing.

## Acceptance criteria
- AC1: A message on a `blocked` task with no open gate adds the message to the conversation, clears `blockedReason`,
  resets loop counters, moves the task out of `blocked` and runs the pipeline from the stage that stopped.
- AC2: The `blocked` to `building` transition records the reason "resumed after a human message" in the activity log.
- AC3: A message on a task in any other state (for example `building`, `planning`, `handed_off`) only adds to the
  conversation; its state and plan cursor do not change.
- AC4: A message while a question is open still answers that question, with the same result as before.
- AC5: A message on a `blocked` task whose only open gate is a command approval, or any other open gate, does not
  resume it.
- AC6: A message sent with a run token never resumes a blocked task.
- AC7: A `blocked` task with `spec-failed` expired resumes at the spec stage and writes the spec again.
- AC8: Attachments sent with the message are kept on the task when it resumes.
- AC9: The docs say a message resumes a blocked task with no open question: `docs/site/configuration/pipelines-and-gates.md`
  (answer row and expiry text) and `docs/site/developer-tools/tasks-and-runs.md` (messages); `pnpm docs:gen` if the API
  description changes.

## Open questions
- Chat replies (Slack, Teams, Discord, GitHub comments) go through `automations.ts` and today only add a message when
  no question is open. Should they resume a blocked task too? Proposed: yes, in a follow-up change; this spec covers the API route only.
- Should resume be limited to people allowed to decide the expired gate (its assignees), or is scope `send` enough? Proposed: `send`.
- Tasks blocked by an interrupt or "waiting for CI" are also `blocked`. Should a message resume those? Proposed: yes, same as any blocked task.
- Approval to edit protected `apps/api/src/app.ts`.
