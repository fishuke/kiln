---
title: Benchmarks
description: Compare up to six agent configurations on tasks pinned to exact commits, find the cost and success frontier, and turn the results into routing rules.
owner: docs
section: Measure and improve
---

A benchmark runs the same tasks, each pinned to exact commits, under up to six configurations of one agent, so you can compare success rate and cost before changing models or skills.

## A suite

```text
benchmarks/core/suite.yaml
benchmarks/core/tasks/t0.yaml
benchmarks/core/tasks/t1.yaml
```

```yaml
# benchmarks/core/suite.yaml
name: core
agent: implement
configurations:
  - { name: sonnet }
  - { name: haiku, agents: [{ agent: implement, model: claude-haiku-5-5 }] }
  - { name: codex, agents: [{ agent: implement, harness: { type: codex } }] }
tasks: [t0, t1]
```

| Key | Notes |
| --- | --- |
| `name`, `description` | |
| `agent` | The agent under test. Must exist. |
| `configurations` | 1 to 6, with unique names. A configuration without `agents` uses the agent as defined. An entry for the suite's agent overrides its `model` or `harness`. |
| `tasks` | Task names. Each needs `tasks/<name>.yaml` in the suite folder. |

## A task

```yaml
# benchmarks/core/tasks/t0.yaml
title: Add a footer link to the pricing page
prompt: "# Add a footer link to the pricing page"
successCriteria:
  - The footer links to /pricing
  - The link test passes
startingRepoRefs:
  - github.com:acme/web@3f2c1a9e5b7d4c6a8e0f1b2c3d4e5f6a7b8c9d0e
sourceRunId: run_abc123
tags: [easy]
```

| Key | Notes |
| --- | --- |
| `title`, `prompt` | Required. |
| `successCriteria` | At least one. |
| `startingRepoRefs` | At least one, in the form `github.com:<owner>/<repo>@<40-character commit SHA>` (or `gitlab.com:`). |
| `sourceRunId` | Optional. The run the task was saved from. |
| `tags` | Optional. Used to group tasks when suggesting routing rules. |

## Saving tasks from real work

Any finished run can be saved as a benchmark task. Kiln takes the run's prompt, the exact commit each repository started at, and the work item's acceptance criteria as success criteria (or a default criterion when there are none). It returns the task file for you to add to your suite.

## Running a suite

`kiln bench run <suite>` runs every task under every configuration, at the pinned commits, without pushing anything. Each run is judged against the task's success criteria with the labels `success` and `failure`. A task succeeds when the run succeeded and the judge says `success`.

For each configuration, Kiln reports the number of tasks, the success rate, the average cost and the average duration, and marks whether it is on the **Pareto frontier**: no other configuration is at least as good on both success rate and cost and better on one.

Benchmarks cost real money. Run them when models, skills or instructions change, not on every commit.

## From results to routing rules

Kiln can suggest routing rules from a suite's results. For each task tag, it takes the cheapest configuration that matches the best success rate for that tag. When that configuration uses a different model than the agent's default, it becomes a rule in a `prompt` router:

```yaml
# routers/by-task.yaml
name: by-task
type: prompt
default: claude-sonnet-5-5
routing:
  - { description: easy tasks, model: claude-haiku-5-5 }
```

For a config-repo factory, Kiln opens this as a pull request labeled `kiln:benchmarks`. To use it, point the agent at it with `model: router:by-task`.

## Related pages

- [Scorers](scorers.md)
- [Replay and canary](replay-and-canary.md)
- [Factory agents](../configuration/agents.md#routers)
- [CLI reference](../developer-tools/cli.md)
