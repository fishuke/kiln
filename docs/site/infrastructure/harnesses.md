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
| `opencode` | `opencode` | The `oz` harness type becomes `opencode` on import. |
| `gemini` | `gemini` | Gemini CLI in headless mode (`--output-format stream-json`). Reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`. |
| `pi` | `pi` | The Pi coding agent in JSON mode. Reads Anthropic, OpenAI, OpenRouter or Gemini keys. |

`reasoningLevel` takes `low`, `medium`, `high`, `xhigh` or `max` where the harness supports it. `auth` also accepts the v1alpha1 spellings `managedSecret` (same as `secret`) and `workerEnvironment` (same as `worker`). Claude Code thinking is recorded as `reasoning` run events with how long the model thought.

The harness program must be installed in the runner's image. Pin its version in the image, because flags and output formats change between releases.

## How each harness runs

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Command | `claude --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions`, driven by the Claude Agent SDK (see below) | `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <instructions + prompt>` | `opencode run --format json <prompt>` |
| Model flag | `--model` | `-m` | `-m` |
| Instructions | Appended to the system prompt | Sent before the prompt | Written to `AGENTS.md` |
| Skills folder | `.claude/skills/` | `.agents/skills/` | `.opencode/skills/` |
| Kiln MCP | `.kiln/mcp.json`, passed with `--mcp-config` (never committed: it holds the run token) | Not configured | Not configured |
| Command guard | `PreToolUse` hook on Bash in `.kiln/claude-settings.json`, passed with `--settings`, with a 10-minute `timeout`; it blocks the command when Kiln hasn't answered after 9.5 minutes | Not installed | Not installed |
| Cost | Reported by Claude Code | Estimated from token counts | Reported per step |

Kiln drives Claude Code with the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). The SDK runs in Kiln (the API or the worker), and the `claude` binary it talks to runs inside the run's sandbox with the run's environment only, so sandboxes, the egress allowlist and workers behave as for the other harnesses. The SDK sends the instructions and steering messages over the session's input. Its version is pinned to the release paired with the Claude Code version in the runner image (SDK `0.3.290` with Claude Code `2.1.290`), so bump both together. See [ADR-009](https://github.com/fishuke/kiln/blob/main/docs/adr/0009-claude-agent-sdk.md).

## Credentials

Kiln passes model credentials to the harness as environment variables of the run, read from Kiln's secrets. You bring your own keys. Set them with `harness.auth`:

```yaml
harness:
  type: claude-code
  auth: { source: secret, secretName: CLAUDE_TOKEN }
```

| `auth` | What the run gets |
| --- | --- |
| `{ source: secret, secretName: <name> }` | A typed secret (such as `claude_oauth_token` or `anthropic_bedrock_access_key`) gives its provider variables. Otherwise, the secret's value. For Claude Code it is set as `CLAUDE_CODE_OAUTH_TOKEN` when it is a subscription token from `claude setup-token` (it starts with `sk-ant-oat`), and as `ANTHROPIC_API_KEY` otherwise. For Codex it is `OPENAI_API_KEY`. For OpenCode the variable has the secret's name. Add `env: <VARIABLE>` to choose the variable yourself. A missing secret fails the run. |
| `{ source: worker }` | No credential from Kiln. The harness uses credentials already present on the worker or in the image. |
| not set | Kiln looks for default secrets, including typed team and personal secrets and the team-managed model keys. Claude Code gets the first of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and Bedrock credentials that is set. Codex gets a [ChatGPT login](#chatgpt-logins) when there is one, else the first of `OPENAI_API_KEY` and `CODEX_API_KEY`. OpenCode gets every one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` that is set. |

The agent's `secrets` list is passed the same way, one variable per secret. Credentials go only to that run's sandbox, and personal secrets only to runs their owner triggered. Secret values are redacted from run output. See [Secrets, MCP servers and environments](../management/secrets-mcps-environments.md).

## ChatGPT logins

Codex can run OpenAI models on a ChatGPT plan instead of an API key. Under **Team settings → Model keys**, choose **Sign in with ChatGPT**, give the login a name, then open the link Kiln shows and enter the one-time code. Kiln runs `codex login --device-auth` in a throwaway sandbox for this and stores the resulting `auth.json` as a `chatgpt_auth` secret. Admins sign in for the team; anyone can sign in for their own runs only. A sign-in in progress is visible only to whoever started it and to team admins, because whoever enters its code chooses the account. A personal login shadows a team login of the same name. If your ChatGPT workspace is a Business or Enterprise one, an admin may first need to allow device code login in its settings.

| What | How it works |
| --- | --- |
| Which runs use it | Codex runs on a Kiln sandbox (not self-hosted workers) whose agent sets no `auth`. With several logins, each run gets the working one with the most left; your own come before the team's. |
| Where it lives in the run | `auth.json` in a `CODEX_HOME` under `/tmp`, outside the repositories, so it is never committed. Its tokens are redacted from run output. |
| Refreshes | Codex refreshes a login it has not refreshed for about 8 days and rewrites `auth.json`; the old refresh token then stops working. Kiln saves the refreshed file after every run (the audit log shows `chatgpt.refreshed` by the run). A login that is due for a refresh serves one run at a time; other runs wait and retry. Tokens a refresh produces mid-run are redacted from its output too. |
| Usage limits | When the plan's limit is reached, the login shows as limited until the time Codex reports and runs use another one. |
| Signed out | A login OpenAI rejects shows as invalid. Sign in again with the same name to replace it. |

To use ChatGPT logins, add `auth.openai.com` and `chatgpt.com` to `KILN_EGRESS_ALLOW` (they are not in the default list, because the list applies to every sandbox). Without them, sign-in fails with Codex's connection error.

A ChatGPT login is a whole ChatGPT session, not an inference-only key, and the agent in a run can read it. Use a dedicated ChatGPT account for team logins, use them for your own private work within OpenAI's terms, and prefer API keys for shared automation, as the Codex docs do. Kiln keeps the `auth.json` a run leaves behind only when it is a refresh of the same account (same account id, a new refresh token, a later refresh time), so an agent cannot swap the stored login for another account. See the [threat model](../../security/threat-model.md).

## Isolation

The sandbox is the security boundary for all three. Permission prompts are off because nobody is there to answer them; the [command guard](../configuration/decisions.md#command-guard) and the sandbox take their place.

## What a run receives

- **Instructions:** the agent's Markdown body, matching factory memories, any extra instructions, and a "Reporting back to Kiln" section.
- **Prompt:** the work item's title, body, triage result, acceptance criteria, review findings and messages from people, plus a line telling the agent what this stage needs.
- **Skills:** every shared skill plus the agent's own.
- **Environment:** `KILN_RUN_ID`, `KILN_RUN_TOKEN`, `KILN_FACTORY`, `KILN_AGENT_TYPE`, `KILN_WORK_ITEM` and `KILN_STAGE`.
- **Working directory:** the work item's repository (the one triage picked in a factory with several, else the first), checked out on the work item's `kiln/*` branch. When triage picked a repository, only it and any `required_repos` are cloned; otherwise all non-deferred repositories are cloned side by side.

## The result file

Agents report structured results by writing `.kiln/result.json` in the repository root. Kiln excludes `.kiln/` from git, so the file is never committed. Kiln reads it after the run; if the JSON does not parse, the run records an error event.

| `agentType` | Shape |
| --- | --- |
| `TRIAGE` | `{"kind": "feature\|bug\|chore\|incident\|question", "size": "xs\|s\|m\|l\|xl", "summary": "...", "duplicateOf": "optional issue key"}` |
| `FOREMAN` | `{"dispatch": {"stage": "triage\|spec\|build\|review\|handoff", "agent": "name", "context": "..."}}` or `{"ask": "question for the requester"}` |
| `SPEC` | `{"specPath": "docs/specs/<id>.md", "why": "...", "goal": "...", "approach": "...", "criteria": ["AC1: ..."], "stories": ["..."], "outOfScope": ["..."], "risks": ["..."], "openQuestions": ["..."]}` |
| `IMPLEMENT` | `{"summary": "...", "testsPassed": true, "pr": {"title": "feat(scope): outcome in lowercase", "body": "## Why\n...\n\n## What\n- ...\n\n## Verification\n- ..."}, "memories": [{"title": "...", "body": "..."}]}` |
| `VERIFY` | `{"testsPassed": true, "playwrightReport": "playwright-report/results.json"}` |
| `REVIEW` | `{"verdict": "accepted\|changes_requested\|needs_human", "findings": ["file:line — issue — fix"]}` |
| `PLAN` | `{"epics": [{"title": "...", "milestone": "...", "dependsOn": [], "issues": [{"title": "...", "body": "...", "criteria": ["..."], "factory": "alias"}]}]}` |
| Others | `{"summary": "..."}` |

What Kiln does with it:

- A review verdict of `changes_requested` with findings loops back to build. `needs_human` posts the findings on the pull request for a person.
- A spec without `specPath` is recorded as `docs/specs/<work item id>.md`.
- `memories` from any agent become memory proposals.
- `testsPassed` is checked when a pipeline stage requires `tests_pass`.
- `pr` from an implement agent becomes the pull request's title and description; the latest one wins when the pull request is updated. Without it, Kiln writes the description from the request.

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

You can steer from the run page, the task page, the API, the Kiln MCP, or by replying where the work started: a Slack thread, a Linear or Jira issue, or a GitHub issue or pull request. A reply steers the running agent when it does not decide a gate or answer an open question. When no agent is running, the reply is added to the conversation instead, and the next agent run sees it under "Messages from people".

On the task page, the running agent's activity (messages, commands, tool calls and thinking) appears live under its row, and the message box steers that agent while it works; when nothing is running, the message goes to the foreman.

Each steering message is kept on the run record, counted as a human touch on the work item, and written to the audit log. A resumed run gets the steering messages so far. Steering a run that has finished fails.

## Related pages

- [Factory agents](../configuration/agents.md)
- [Sandboxes](sandboxes.md)
- [Skills](../configuration/skills.md)
- [Replay and canary](../measure-and-improve/replay-and-canary.md)
- [API overview](../developer-tools/api.md)
