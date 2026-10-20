---
title: Concepts
description: A glossary of the terms used across Kiln's docs, from factory and foreman to scorer, canary and run token.
owner: docs
section: Overview
---

This glossary defines each Kiln term in one or two sentences and links to the page that covers it.

## Factories and work

| Term | Definition |
| --- | --- |
| **Factory** | A team of agents attached to the repositories that ship together, defined by a tree rooted at `factory.yaml`. See [Definitions as code](../configuration/definitions-as-code.md). |
| **Alias** | The factory's handle, such as `webapp`. People reach the foreman with `@webapp` in Slack, GitHub, Linear or Jira. Lowercase letters, digits and dashes, up to 60 characters. |
| **Work item** | One request, from intake to completion. It keeps its source, conversation, branch, pull request, cost and the definition SHA it runs under. See [How Kiln works](how-kiln-works.md). |
| **Foreman** | The agent with `agentType: FOREMAN`. It coordinates work items and chooses the path when no pipeline is set. A factory has exactly one. |
| **Agent** | A role in the factory, defined in `agents/<name>/agent.md` with an `agentType`, a harness or model, and instructions. See [Factory agents](../configuration/agents.md). |
| **Stage** | One step of a work item's path: triage, spec, build, verify, preview, review or hand-off. |
| **Pipeline** | An optional, fixed list of stages in `pipelines/<name>.yaml`. See [Pipelines and gates](../configuration/pipelines-and-gates.md). |
| **Gate** | A pause where a person decides: spec approval, preview acceptance, a question, command approval or merge. Open gates make up the [inbox](../management/inbox.md). |
| **Hand-off** | The last stage. The pull request is marked ready and a person is asked to merge it. |
| **Project** | A group of factories for planning and reporting. See [Portfolio and projects](../management/portfolio.md). |
| **Roadmap** | Epics and issues the planning agent produces from a goal or PRD. See [Planning](../product-owners/planning.md). |

## Configuration

| Term | Definition |
| --- | --- |
| **Definition tree** | All files that define a factory: `factory.yaml`, `agents/`, `automations/`, `pipelines/`, `gates/`, `policies/`, `decisions/`, `runners/`, `routers/`, `scorers/`, `benchmarks/`, `skills/`, `webhooks/` and `memories/`. |
| **Definition SHA** | A 40-character content hash of the whole tree. Kiln stores every applied tree by this SHA, and every run records it. |
| **Applied definition** | The tree new work items use. Kiln applies a tree whole or not at all; an invalid tree leaves the previous one active. |
| **Config repo** | A GitHub repository that holds the definition tree. Merges to its branch apply the new tree. |
| **Automation** | A trigger file that starts work from an event. See [Automations](../configuration/automations.md). |
| **Skill** | A `SKILL.md` file with know-how that Kiln hands to agents. See [Skills](../configuration/skills.md). |
| **Memory** | A learned convention stored as `memories/<slug>.md` and added to later runs. See [Skills](../configuration/skills.md#memories). |
| **Runner** | Compute settings for an agent's sandbox: image, backend, shape, setup commands and egress. See [Sandboxes](../infrastructure/sandboxes.md). |
| **Router** | A file in `routers/` that picks a model per task, by complexity or by prompt. Agents use it with `model: router:<name>`. |
| **Policy** | Rules in `policies/<name>.yaml`, such as paths self-improvement may not change. See [Policies and budgets](../configuration/policies-and-budgets.md). |
| **Decision** | A typed question set with thresholds, in `decisions/<name>.yaml`. See [Typed decisions](../configuration/decisions.md). |
| **Expression** | The small language used by `skip_if`, gate rules and decision policies. See [Typed decisions](../configuration/decisions.md#expression-language). |

## Runs and safety

| Term | Definition |
| --- | --- |
| **Run** | One agent session in one sandbox. It records the agent, harness, model, definition SHA, start state, events, cost and outcome. |
| **Harness** | The coding agent program a run uses: `claude-code`, `codex` or `opencode`. See [Harnesses](../infrastructure/harnesses.md). |
| **Sandbox** | The disposable environment a run works in: local directory, Docker container or Kubernetes pod. |
| **Start state** | What a run started from: prompt, instructions, skills and the exact commit of each repository. Replays start from it. |
| **Result file** | `.kiln/result.json`, which the agent writes at the end of a run to report structured results. See [Harnesses](../infrastructure/harnesses.md#the-result-file). |
| **Run token** | A short-lived token for one run. It can push only `kiln/*` branches of the factory's repositories, open pull requests, comment and label. It can never approve or merge. |
| **Command guard** | The check that rates shell commands before they run and allows, asks a person or blocks. |
| **Steering** | A message sent to a running agent that it reads before its next step. |
| **Scope** | A permission on an API or MCP token, granted per factory. See [Admin, RBAC and audit](../management/admin-rbac-audit.md). |

## Measure and improve

| Term | Definition |
| --- | --- |
| **Scorer** | A rubric with labels that grades a share of an agent's runs. See [Scorers](../measure-and-improve/scorers.md). |
| **Score** | One scorer's label for one run, with a pass or fail against the scorer's `passingScore`. |
| **Self-improvement** | The loop that turns unreviewed failures into a proposed definition change, proven by replay. See [Self-improvement](../measure-and-improve/self-improvement.md). |
| **Proposal** | A self-improvement change with its replay report, opened as a pull request or kept for review in Kiln. |
| **Replay** | A new run from a saved start state, optionally under another definition. |
| **Canary** | A candidate definition that only a share of new work items use, so you can compare it to the applied one. |
| **Benchmark** | A suite of tasks pinned to exact commits, run under up to six configurations. See [Benchmarks](../measure-and-improve/benchmarks.md). |
| **Autonomy** | The share of merged pull requests whose only human touch was the original request. See [Metrics](../measure-and-improve/metrics.md). |

## Related pages

- [What is Kiln](what-is-kiln.md)
- [How Kiln works](how-kiln-works.md)
- [Definitions as code](../configuration/definitions-as-code.md)
