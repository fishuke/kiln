---
title: Typed decisions
description: Configure the small, repeated decisions a factory makes, such as the command guard, triage and routing, with typed questions, thresholds and an LLM fallback.
owner: docs
section: Factory configuration
---

A typed decision sends a few fields of program state and a set of typed questions to a fast decision model, gets back a probability for each answer, and turns them into an action with thresholds you write in `decisions/<name>.yaml`.

## Why typed decisions

A factory makes many small yes/no and pick-one choices per work item: is this command destructive, does this request need a spec, is this pull request risky. Kiln sends these to a decision model instead of a coding agent. The thresholds live in Kiln, so changing a policy means editing a number, not a prompt.

The primary provider is Jev from TypeSafe AI. When Jev fails or is slow, Kiln falls back to structured output from your LLM gateway. Offline and in tests, a built-in rule set answers instead.

## A decision file

```yaml
# decisions/command-guard.yaml
state: [command, cwd, repo, branch]
questions:
  risk_level: { type: choice, options: [safe, risky, destructive] }
  remote_exec: { type: probability }
  deletes_files: { type: probability }
  touches_prod: { type: probability }
policy:
  block: "risk_level.destructive >= 0.8 or remote_exec >= 0.8 or touches_prod >= 0.8"
  ask_human: "risk_level.risky >= 0.3 or risk_level.destructive >= 0.3"
on_error: llm
timeout_ms: 800
```

| Key | Default | Notes |
| --- | --- | --- |
| `description` | none | |
| `provider` | `jev` | `jev`, `llm` or `fake`. Accepted by the schema; today every decision uses the providers the server is configured with. |
| `state` | required | The fields sent to the model. Only these leave Kiln. |
| `questions` | required | Named questions. See below. |
| `policy` | required | Action name to expression. See below. |
| `on_error` | `llm` | What to do when the provider fails or times out: `llm`, `allow` or `deny`. |
| `timeout_ms` | 800 | Time to wait for the primary provider. |

A file named like a built-in decision replaces it for that factory.

### Question types

| Type | Answer | Use in a policy |
| --- | --- | --- |
| `choice` with `options` (at least two) | A probability per option | `risk_level.destructive >= 0.8` |
| `probability` | One number from 0 to 1 | `remote_exec >= 0.8` |
| `score` with `min` (default 0) and `max` (default 1) | One number | `urgency >= 0.8` |

### How the policy picks an action

1. Kiln asks the primary provider, with `timeout_ms`.
2. If that fails and `on_error` is `llm`, Kiln asks the LLM fallback, with a timeout of at least 15 seconds.
3. Kiln evaluates the policy entries in the order they are written. The first one that is true is the action.
4. If none is true, the action is `allow`.
5. If no provider answered, the decision fails closed: the action is the first policy entry, unless `on_error` is `allow`.

Validation checks every policy expression, that it only reads questions and state fields, and that each `question.option` names a real option.

## Built-in decisions

| Name | Questions | Policy | How Kiln uses the action |
| --- | --- | --- | --- |
| `command-guard` | `risk_level` (safe, risky, destructive), `remote_exec`, `deletes_files`, `touches_prod` | `block` and `ask_human` as in the example above | See [Command guard](#command-guard). |
| `triage` | `kind` (feature, bug, chore, incident, question), `size` (xs, s, m, l, xl), `duplicate_of_recent` | `duplicate: duplicate_of_recent >= 0.85` | Kiln uses kind and size when both top answers are at least 0.6; otherwise the triage agent decides. `duplicate` adds a note to the thread. |
| `foreman-routing` | `next_stage`, `needs_spec`, `needs_human` | `ask_human: needs_human >= 0.85`, `skip_spec: needs_spec <= 0.15` | Kiln reads `needs_spec` directly: 0.85 or more means a spec, 0.15 or less means none, anything else goes to the foreman agent. |
| `spec-check` | `is_testable`, `is_ambiguous` per acceptance criterion | `reject: is_testable < 0.5 or is_ambiguous >= 0.5` | Rejected criteria are sent back to the spec agent once, and any that still fail are listed on the spec gate. |
| `review-risk` | `risk_tier` (low, medium, high), `touches_sensitive_area`; sees the PR's changed files and line counts | `code_owners: risk_tier.high >= 0.5 or touches_sensitive_area >= 0.7`, `skip_review: risk_tier.low >= 0.8 and touches_sensitive_area < 0.3` | `code_owners` assigns the review to the `code-owners` role instead of the requester. `skip_review` (when the reviewer agent also accepts) opens no review item; the PR waits under Ready to merge. If the check fails, `code_owners` applies. |
| `model-router` | `complexity` (easy, medium, hard) | `easy: complexity.easy >= 0.8`, `hard: complexity.hard >= 0.6` | Picks the model of a `complexity` router. |
| `failure-category` | `failure_category` (instructions, skills, tooling, model, app_code, flaky) | none | Groups failed runs before self-improvement. |
| `inbox-urgency` | `urgency` (score 0–1) | `urgent: urgency >= 0.8` | Orders the inbox. |

All built-ins use `on_error: llm` and `timeout_ms: 800`.

## Command guard

Every shell command an agent runs is checked before it runs:

- Claude Code runs a `PreToolUse` hook on its Bash tool that sends the command to Kiln. Kiln installs the hook when its public URL is configured.
- Commands that go through the sandbox's command API are checked by the sandbox itself.
- Kiln's own setup, clone and push commands are trusted and are not checked.

The verdict:

| Action | Result |
| --- | --- |
| `allow` (no entry matched) | The command runs. |
| `ask_human` | Kiln opens a `command-approval` question for the requester and the `admins` role, and the run waits. Approve runs the command; reject, or no answer within 30 minutes, blocks it. |
| `block` | The command does not run. The agent sees "Blocked by the Kiln guardrail". |

If the Claude Code hook cannot reach Kiln, it blocks the command.

Codex and OpenCode run their own shell tools with their approval prompts turned off, and the current adapters do not install a guard hook for them. Rely on the sandbox's isolation for those harnesses.

## Logs

Every decision is logged with its name, the state that was sent, the answers, the action, the provider, whether it fell back, and the latency. The log links to the work item or run, so you can audit a decision and use past cases to compare providers.

## Data that leaves the cluster

Only the fields listed in `state` are sent. The Jev provider can apply a redaction function before sending. Confirm the provider's data retention and region terms before you send production data.

## Expression language

Pipelines (`skip_if`), gates (`rule`) and decision policies share one small expression language. It has no side effects.

| Element | Example |
| --- | --- |
| Field reference, with dots for nesting | `triage.size`, `risk_level.destructive` |
| Numbers, quoted strings, `true`, `false` | `0.8`, `'xs'`, `"bug"` |
| Comparisons | `==`, `!=`, `>`, `>=`, `<`, `<=` |
| List membership | `triage.size in ['xs', 's']`, `work_item.source not in ['slack']` |
| Logic | `and`, `or`, `not`, parentheses |

Rules:

- `and` binds tighter than `or`.
- `>`, `>=`, `<` and `<=` are false unless both sides are numbers.
- `in` and `not in` are false unless the right side is a list.
- A missing field has no value. Number comparisons with it are false, and `==` only matches another missing field.
- Field names may contain letters, digits, `_`, `.` and `-`.

Validation reports syntax errors with the file and line.

## Related pages

- [Pipelines and gates](pipelines-and-gates.md)
- [Sandboxes](../infrastructure/sandboxes.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
- [Scorers](../measure-and-improve/scorers.md)
