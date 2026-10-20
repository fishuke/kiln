---
title: Pipelines and gates
description: Fix a factory's stages with pipelines/<name>.yaml, and define where people approve, answer and accept with gates/<name>.yaml.
owner: docs
section: Factory configuration
---

A pipeline is an optional file that lists a work item's stages in order; a gate is a pause in that path where a person decides before the work goes on.

## When to use a pipeline

Without a pipeline, the foreman builds a path for each work item (see [How Kiln works](../overview/how-kiln-works.md#the-foremans-default-path)). Add a pipeline when your team wants the same stages every time, a gate in a specific place, or loop limits you choose.

A work item uses a pipeline when `factory.yaml` sets `defaultPipeline: <name>`, or when the work item is created with a pipeline name.

## A pipeline file

```yaml
# pipelines/feature.yaml
stages:
  - { id: triage,  agent: triage }
  - { id: spec,    agent: spec, skip_if: "triage.size in ['xs','s']", gate: spec-approval }
  - { id: build,   agent: implement, fan_out: per_user_story }
  - { id: verify,  agent: verify, requires: [ci_green, criteria_videos], on_fail: build, max_loops: 3 }
  - { id: preview, action: preview.deploy, gate: preview-acceptance }
  - { id: review,  agent: review }
  - { id: handoff, action: handoff }   # people merge through branch protection
```

| Key | Notes |
| --- | --- |
| `description` | Optional. |
| `stages` | At least one. Run in order. |
| `budget.maxUsd` | Accepted by the schema. Not enforced yet; use `budgets.perWorkItemUsd` in `factory.yaml`. |

### Stage keys

| Key | Notes |
| --- | --- |
| `id` | Lowercase letters, digits and dashes. Unique in the pipeline. |
| `agent` | An agent name. Set exactly one of `agent` or `action`. |
| `action` | `preview.deploy` or `handoff`. |
| `skip_if` | An [expression](decisions.md#expression-language). When true, the stage is skipped. |
| `gate` | A gate name: a file in `gates/` or a built-in gate. |
| `fan_out` | `per_user_story`: one agent run per user story in the spec. |
| `requires` | Any of `ci_green`, `criteria_videos`, `tests_pass`. |
| `on_fail` | An earlier stage's `id` to go back to when this stage fails. |
| `max_loops` | 1–10. Default 3. |
| `advisory` | For review stages. When `true`, review findings never park the work item. See below. |

### What each stage does

A stage's behavior comes from its agent's `agentType` or its action:

| Agent type or action | Stage behavior |
| --- | --- |
| `TRIAGE` | Classifies kind and size. |
| `SPEC` | Writes the spec as a draft pull request, checks each criterion with the `spec-check` decision, rewrites failing criteria once, then opens the stage's gate. If the agent fails twice, it opens a `spec-failed` question with the reason and parks the item instead. A spec review or a `spec-failed` question can be retried: the spec is written again from scratch, optionally on another model for that run. See [Retrying a spec](../product-owners/approving-specs-and-previews.md#retrying-a-spec). |
| `IMPLEMENT` or `CUSTOM` | Builds the change. Two failed attempts open a `build-failed` question and park the item. |
| `VERIFY` | Runs the verify agent and checks `requires`. |
| `REVIEW` | Reviews the pull request. `changes_requested` with findings loops back with `on_fail`. For an advisory stage without `on_fail`, or with its loops used up, Kiln posts the findings on the pull request as "Advisory review findings:" and moves on. `needs_human` posts the findings for a person and moves on. |
| `preview.deploy` | Deploys a preview, posts a card to the pull request and opens the stage's gate. Skipped when no preview provider is set or there is no pull request. |
| `handoff` | Marks the pull request ready, labels it and opens the merge gate. |

### `requires`

| Value | Passes when |
| --- | --- |
| `ci_green` | Every check run on the branch succeeded (or was neutral or skipped). While checks are pending, the item waits and Kiln checks again on each timer tick. |
| `criteria_videos` | Every acceptance criterion in the spec has a passing Playwright test with a video. |
| `tests_pass` | The verify agent's result file says `"testsPassed": true`. |

When a stage fails, Kiln goes back to `on_fail`. After `max_loops` failures, or when the stage has no `on_fail`, Kiln opens a `<stage>-stuck` question and parks the item as `blocked`. The exception is a review stage with `advisory: true`: it posts its findings on the pull request and continues to hand-off instead of parking. Answering the question resets the loop counters and retries the stage that stopped; rejecting it cancels the item.

### Expressions in `skip_if`

`skip_if` reads these fields:

| Field | Example |
| --- | --- |
| `triage.kind`, `triage.size`, `triage.summary` | `triage.kind == 'chore'` |
| `spec.criteria`, `spec.stories`, `spec.openQuestions` | |
| `work_item.title`, `work_item.kind`, `work_item.size`, `work_item.source` | `work_item.source == 'slack'` |
| `loops.<stage>` | `loops.verify >= 2` |

## Gates

A gate pauses a work item until someone decides. Gate files live in `gates/<name>.yaml`.

```yaml
# gates/spec-approval.yaml
kind: approval
approvers: [requester, role:po]
evidence: [spec, open_questions]
nudge: 24h
expire: 72h -> park
```

| Key | Notes |
| --- | --- |
| `kind` | `approval`, `question`, `preview`, `merge` or `custom`. |
| `approvers` | At least one. `requester` is the person who sent the work. `role:<name>` expands to the people in that role, set in Kiln's server configuration. Anything else is taken as a user ID or email. |
| `evidence` | Labels for the evidence a decider needs. |
| `nudge` | A duration (`30m`, `24h`, `3d`). Kiln reminds the approvers in the source thread at this interval. |
| `expire` | A duration, optionally followed by `-> park`, `-> reject` or `-> approve`. Without an action, the gate parks the item. |
| `rule` | An [expression](decisions.md#expression-language). Kiln checks its syntax; it is not evaluated at run time yet. |

### Built-in gates

You can use these names without a file. A file with the same name replaces the built-in one.

| Name | Kind | Approvers | Nudge | Expire |
| --- | --- | --- | --- | --- |
| `spec-approval` | approval | `requester`, `role:po` | 24h | `72h -> park` |
| `preview-acceptance` | preview | `requester`, `role:po` | 24h | `72h -> park` |
| `merge` | merge | `role:code-owners`, `requester` | 48h | none |

The foreman's default path uses `spec-approval` and `preview-acceptance`. Hand-off always opens a `merge` gate.

### Deciding a gate

A gate can be approved or rejected from the [inbox](../management/inbox.md), a reply in the source thread, the API or the Kiln MCP. All of them use the same code path and record who decided and through which surface. A reply in a Slack thread or on an issue or pull request decides a gate only when its author is one of the gate's assignees, or the gate has none. See [Who may decide from a reply](automations.md#who-may-decide-from-a-reply). Only question gates take free-text answers.

| Decision | Spec gate | Preview gate | Question gate | Merge gate |
| --- | --- | --- | --- | --- |
| Approve | Build starts | Work moves on to the next stage | Resumes a blocked item at the stage that stopped. For a command approval, the command runs. | Marks the item complete by human confirmation |
| Reject | Spec is rewritten with your feedback | Back to build with your feedback | Cancels a blocked item. For a command approval, the command is blocked. | Gate closes |
| Answer | Not allowed | Not allowed | Your answer is added to the conversation and the blocked item resumes at the stage that stopped | Not allowed |

When a gate expires with `park`, it closes as `expired` and the item moves to `blocked`.

## Related pages

- [How Kiln works](../overview/how-kiln-works.md)
- [Typed decisions](decisions.md)
- [Policies and budgets](policies-and-budgets.md)
- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Inbox](../management/inbox.md)
