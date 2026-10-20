---
title: Planning with the plan agent
description: Turn a goal, a PRD or meeting notes into a roadmap of epics and tracker issues with acceptance criteria, each tagged with the factory that should build it.
owner: docs
section: Product owners
---

The plan agent turns a goal, a PRD or meeting notes into a roadmap of epics, milestones and issues, and creates those issues in Linear or Jira with acceptance criteria and a target factory.

## Before you plan

1. Create a project that groups the factories involved, for example "Customer portal" with `webapp`, `api` and `mobile`. See [Portfolio and projects](../management/portfolio.md).
2. Make sure the first factory in the project has an agent with `agentType: PLAN`:

```markdown
---
agentType: PLAN
description: Turns goals and PRDs into roadmaps
---
Split the goal into epics that can ship on their own.
Give every issue testable acceptance criteria and the factory that should build it.
```

## Make a plan

Give Kiln:

- **a goal**, one sentence, such as "Self-serve billing",
- optionally **a PRD** in Markdown,
- optionally **notes**, such as a meeting transcript.

Kiln runs the plan agent with the goal, the PRD, the notes and the list of the project's factories. The agent returns epics in its result file (see [Harnesses](../infrastructure/harnesses.md#the-result-file)). Each epic has a title, a milestone, the epics it depends on, and issues with a title, body, acceptance criteria and target factory.

If the factory has no `PLAN` agent, or the agent returns no epics, Kiln reads the PRD as structured Markdown instead:

| In the PRD | Becomes |
| --- | --- |
| `## Heading` | An epic, with milestones `M1`, `M2`, … in order |
| `Depends on: Epic A, Epic B` | The epic's dependencies |
| `### Heading` or a top-level bullet | An issue |
| A nested bullet or a line starting with `AC:` | An acceptance criterion of that issue |
| `[api]` or `@api` in an issue title | Sends the issue to that factory instead of the first one |
| Other text under an issue | The issue's body |

Criteria are numbered `AC1`, `AC2`, …. An issue without criteria gets a default one in "Given … when … then …" form, which you should replace.

## What gets created

When a tracker is connected, Kiln creates:

- one issue per epic, labeled `epic`, with the goal, the milestone and its dependencies,
- one child issue per item, with its body, an "Acceptance criteria" checklist, a `factory:<alias>` label and a "Factory: @<alias>" line.

In Linear the child issues are sub-issues of the epic. In Jira the epic is a Task and the items are Sub-tasks.

Jira gets the labels. The Linear adapter does not set labels yet, so in Linear the "Factory: @<alias>" line is what names the factory.

The roadmap is saved on the project with links to every issue.

## From roadmap to work

Each issue names its factory, so it can flow into that factory's automations. For example, in Jira an automation that triggers on `issue_created` with a `labels: [factory:webapp]` filter turns each new issue into a work item for `webapp`. In Linear, start work with an agent session on the issue, or mention the factory's alias in a comment. You can also hold issues back and send them when you are ready.

## Weekly digest

Kiln can produce a digest per person of the decisions waiting on them, oldest first, with each item's age in hours and a link to it in the inbox.

## Related pages

- [Portfolio and projects](../management/portfolio.md)
- [Linear](../integrations/linear.md)
- [Jira](../integrations/jira.md)
- [Writing acceptance criteria](acceptance-criteria.md)
- [Factory agents](../configuration/agents.md)
