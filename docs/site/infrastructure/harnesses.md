---
title: Harnesses
description: How Kiln runs Claude Code, Codex and OpenCode inside sandboxes, what each run receives, how agents report results, and how to steer a running agent.
owner: docs
section: Infrastructure
---

A harness is the coding agent program that does the work in a run; Kiln supports Claude Code, Codex and OpenCode behind one adapter interface and does not write its own agent loop.

## Choosing a harness

Set `harness.type` in `agentDefaults`, on an agent or on an automation:

```yaml
harness: { type: claude-code, model: claude-sonnet-5-5 }
```

| `type` | Program | Notes |
| --- | --- | --- |
| `claude-code` | `claude` | The default when nothing sets a harness. |
| `codex` | `codex` | |
| `opencode` | `opencode` | Takes the place of Warp's `oz` harness on import. |

The harness program must be installed in the runner's image. Pin its version in the image, because flags and output formats change between releases.

## How each harness runs

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Command | `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --append-system-prompt <instructions>` | `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <instructions + prompt>` | `opencode run --format json <prompt>` |
| Model flag | `--model` | `-m` | `-m` |
| Instructions | Appended to the system prompt | Sent before the prompt | Written to `AGENTS.md` |
| Skills folder | `.claude/skills/` | `.agents/skills/` | `.opencode/skills/` |
| Kiln MCP | Written to `.mcp.json` | Not configured | Not configured |
| Command guard | `PreToolUse` hook on Bash in `.claude/settings.json` | Not installed | Not installed |
| Cost | Reported by Claude Code | Estimated from token counts | Reported per step |

## Credentials

Kiln passes model credentials to the harness as environment variables of the run, read from Kiln's secrets. You bring your own keys. Set them with `harness.auth`:

```yaml
harness:
  type: claude-code
  auth: { source: secret, secretName: CLAUDE_TOKEN }
```

| `auth` | What the run gets |
| --- | --- |
| `{ source: secret, secretName: <name> }` | The secret's value. For Claude Code it is set as `CLAUDE_CODE_OAUTH_TOKEN` when it is a subscription token from `claude setup-token` (it starts with `sk-ant-oat`), and as `ANTHROPIC_API_KEY` otherwise. For Codex it is `OPENAI_API_KEY`. For OpenCode the variable has the secret's name. Add `env: <VARIABLE>` to choose the variable yourself. A missing secret fails the run. |
| `{ source: worker }` | No credential from Kiln. The harness uses credentials already present on the worker or in the image. |
| not set | Kiln looks for default secrets. Claude Code gets the first of `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` that is set. Codex gets the first of `OPENAI_API_KEY` and `CODEX_API_KEY`. OpenCode gets every one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` that is set. |

The agent's `secrets` list is passed the same way, one variable per secret. Credentials go only to that run's sandbox.

## Isolation

The sandbox is the security boundary for all three. Permission prompts are off because nobody is there to answer them; the [command guard](../configuration/decisions.md#command-guard) and the sandbox take their place.

## What a run receives

- **Instructions:** the agent's Markdown body, matching factory memories, any extra instructions, and a "Reporting back to Kiln" section.
- **Prompt:** the work item's title, body, triage result, acceptance criteria, review findings and messages from people, plus a line telling the agent what this stage needs.
- **Skills:** every shared skill plus the agent's own.
- **Environment:** `KILN_RUN_ID`, `KILN_RUN_TOKEN`, `KILN_FACTORY`, `KILN_AGENT_TYPE`, `KILN_WORK_ITEM`, `KILN_STAGE`, and `WARP_FACTORY_ID` (the factory ID, for skills written for Warp).
- **Working directory:** the first repository, checked out on the work item's `kiln/*` branch. All non-deferred repositories are cloned side by side.

## The result file

Agents report structured results by writing `.kiln/result.json` in the repository root. Kiln excludes `.kiln/` from git, so the file is never committed. Kiln reads it after the run; if the JSON does not parse, the run records an error event.

| `agentType` | Shape |
| --- | --- |
| `TRIAGE` | `{"kind": "feature\|bug\|chore\|incident\|question", "size": "xs\|s\|m\|l\|xl", "summary": "...", "duplicateOf": "optional issue key"}` |
| `FOREMAN` | `{"dispatch": {"stage": "triage\|spec\|build\|review\|handoff", "agent": "name", "context": "..."}}` or `{"ask": "question for the requester"}` |
| `SPEC` | `{"specPath": "docs/specs/<id>.md", "criteria": ["AC1: ..."], "stories": ["..."], "openQuestions": ["..."]}` |
| `IMPLEMENT` | `{"summary": "...", "testsPassed": true, "memories": [{"title": "...", "body": "..."}]}` |
| `VERIFY` | `{"testsPassed": true, "playwrightReport": "playwright-report/results.json"}` |
| `REVIEW` | `{"verdict": "accepted\|changes_requested\|needs_human", "findings": ["file:line — issue — fix"]}` |
| `PLAN` | `{"epics": [{"title": "...", "milestone": "...", "dependsOn": [], "issues": [{"title": "...", "body": "...", "criteria": ["..."], "factory": "alias"}]}]}` |
| Others | `{"summary": "..."}` |

What Kiln does with it:

- A review verdict of `changes_requested` with findings loops back to build. `needs_human` posts the findings on the pull request for a person.
- A spec without `specPath` is recorded as `docs/specs/<work item id>.md`.
- `memories` from any agent become memory proposals.
- `testsPassed` is checked when a pipeline stage requires `tests_pass`.

The agent commits on the current branch. It must not push, open pull requests or merge; Kiln does that with a scoped token.

## Run events

Kiln streams each harness's output as normalized events: `message`, `tool_call`, `tool_result`, `steer`, `error`, plus Kiln's own `started`, `guard`, `pushed`, `resumed` and `finished`. Events are stored in order, can be read after the fact, and can be followed live over server-sent events.

## Steering

Steering sends a message to a running agent.

| Harness | How the message arrives |
| --- | --- |
| Claude Code | Written to the session's input as a new user message, so the agent reads it before its next step. |
| Codex | Queued. When the current turn ends, Kiln resumes the session (`codex exec resume --last`) with the message. |
| OpenCode | Queued. When the current turn ends, Kiln continues the session (`opencode run --continue`) with the message. |

You can steer from the run page, the API or the Kiln MCP. Each steering message is saved on the run, counted as a human touch on the work item, and written to the audit log. Steering a run that has finished fails.

Messages posted in a work item's Slack thread or issue while an agent runs do not steer that run. They are added to the conversation, and the next agent run sees them under "Messages from people".

## Related pages

- [Factory agents](../configuration/agents.md)
- [Sandboxes](sandboxes.md)
- [Skills](../configuration/skills.md)
- [Replay and canary](../measure-and-improve/replay-and-canary.md)
- [API overview](../developer-tools/api.md)
