---
title: What is Kiln
description: Kiln is a self-hostable platform that runs software factories, teams of coding agents that turn requests into reviewed pull requests.
owner: docs
section: Overview
---

Kiln is a self-hostable platform that runs software factories: teams of coding agents that take a request from GitHub, Slack, Linear, Jira, a webhook or a schedule and turn it into a pull request that a person reviews and merges.

## What a factory does

A factory is a team of agents attached to the repositories that ship together. One agent, the foreman, receives each request as a work item and routes it through stages: triage, an optional spec, building, verification, an optional preview, review and hand-off. People stay in charge at three points:

- They approve the spec before code is written, when a spec is needed.
- They accept the preview, when a preview environment is configured.
- They merge the pull request. Kiln never merges.

The factory posts its progress and questions back where the request started: the Slack thread, the GitHub issue, or the Linear or Jira issue.

## What makes Kiln different

A Kiln factory is built on a few core ideas: a foreman that routes work, work items that keep one identity from intake to hand-off, definitions as code in a tree rooted at `factory.yaml`, and scorers that feed self-improvement. On top of these, Kiln offers:

- **Self-hosting.** Agents run in disposable sandboxes on your own Docker host or Kubernetes cluster.
- **Optional pipeline graphs.** A `pipelines/<name>.yaml` file fixes the stages when a team wants a deterministic path. Without one, the foreman chooses the path.
- **Typed decisions.** Small yes/no and pick-one decisions, such as "does this command look destructive?", go to a fast decision model with thresholds you set in `decisions/<name>.yaml`.
- **Scoped tokens.** API and MCP tokens carry scopes per factory, so a product owner's token can approve previews but cannot change definitions.
- **Planning across projects.** A planning agent turns a goal or a PRD into epics and tracker issues, and a portfolio view rolls up metrics across factories.

## What Kiln does not do

- It does not merge or deploy without a person.
- It does not adopt a self-improvement change without review.
- It does not write its own agent loop. It runs existing harnesses: Claude Code, Codex and OpenCode.

## Who uses it

| Person | Typical work |
| --- | --- |
| Product owner | Sends requests, approves specs, accepts previews, plans roadmaps |
| Engineer | Sends work, reviews pull requests, takes tasks to a local worktree, writes skills |
| Factory engineer | Owns the definition tree, scorers, benchmarks and budgets |
| Admin | Manages integrations, secrets, tokens and the audit log |

## Related pages

- [How Kiln works](how-kiln-works.md)
- [Concepts](concepts.md)
- [Importing v1alpha1 definitions](importing-definitions.md)
- [Definitions as code](../configuration/definitions-as-code.md)
- [Self-hosting](../infrastructure/self-hosting.md)
