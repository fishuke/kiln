# Idea: factories after merge

Status: idea, not scheduled · Raised 2026-10-22 · Related: [Studio](studio.md)

## The idea

A factory's job doesn't end at the merge. It should also be able to act when a pull request opens, whoever opened it (a person, a factory agent or Studio), and watch what happens after a merge until the change is safely live. That is how Studio Apps and factories work together: Studio produces pull requests, and the factory coupled to the repository checks them before review and keeps watch after deploy, so a change doesn't turn into an incident.

## What already exists

- Automation triggers for `pull_request_opened`, `pull_request_synchronized`, `pull_request_ready`, `pull_request_merged` and `pull_request_closed`, with filters on repositories, branches, authors, labels and paths ([Automation triggers](../site/configuration/automation-triggers.md)).
- Preview deployments per pull request on Vercel or Kubernetes ([Previews](../site/integrations/previews.md)).
- An incident-response template that takes alerts and proposes a fix ([Build an incident-response factory](../site/guides/incident-response-factory.md)).

## What is new

- **Deployment events** as triggers: GitHub `deployment_status`, Vercel deployments, and a webhook for other deploy tools. They carry the environment (preview, staging, production), the commit and the pull request.
- **A monitor stage.** After a production deploy, an agent watches errors, logs and key metrics for a set window through the team's observability MCP or webhook, and compares them with the period before the deploy.
- **What a monitor can do:** report "healthy" on the pull request and the task; or, when something regresses, open an incident with the evidence, propose a revert pull request, and notify the people who merged. A person still merges the revert (ADR-008).
- **Checks on Studio pull requests**, for example a review agent's comments or tests run before the pull request reaches a reviewer's Inbox.

A sketch:

```yaml
# automations/after-merge.yaml (sketch)
trigger: { provider: github, event: deployment_status, filters: { environment: production, state: success } }
pipeline: monitor
---
# pipelines/monitor.yaml (sketch)
stages:
  - { id: watch, agent: monitor, window: 30m } # compare errors and metrics before and after
  - { id: report, action: comment } # "healthy" on the pull request
  - { id: revert, agent: implement, when: regression, gate: revert-approval }
```

## Open questions

- Which observability sources to support first, and how a factory declares the signals that matter.
- How long the window is, and what counts as a regression.
- Whether a monitor can hold or roll back a deploy through the deploy tool, or only propose a revert.

## Related

- [Studio](studio.md)
- [Automations](../site/configuration/automations.md)
- [Pipelines and gates](../site/configuration/pipelines-and-gates.md)
