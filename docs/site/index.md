---
title: Kiln documentation
description: Self-hostable, open source software factories: agents turn issues and requests into reviewed pull requests, and people approve specs, previews and merges.
owner: docs
section: Overview
generated: true
---

Kiln turns issues, Slack threads and tracker tickets into reviewed pull requests with a team of agents, and people stay in charge of specs, previews and merges. It is open source (MIT), runs on your own machines, and uses your own model keys or a Claude subscription.

## Overview

- [Concepts](overview/concepts.md): A glossary of the terms used across Kiln's docs, from factory and foreman to scorer, canary and run token.
- [How Kiln works](overview/how-kiln-works.md): The life of a work item, from intake through triage, spec, build, verify, preview and review to a human merge.
- [Importing v1alpha1 definitions](overview/importing-definitions.md): Convert a definition tree in the v1alpha1 factory definition format to kiln/v1 with kiln import, or connect a config repo in that format and let Kiln convert it on every sync.
- [What is Kiln](overview/what-is-kiln.md): Kiln is a self-hostable platform that runs software factories, teams of coding agents that turn requests into reviewed pull requests.

## Factory configuration

- [Factory agents](configuration/agents.md): Define the roles in a factory with agents/<name>/agent.md, choose a harness and model, and understand how settings are inherited.
- [Automation triggers](configuration/automation-triggers.md): Every trigger provider, event and filter key, generated from the trigger catalogue.
- [Automations](configuration/automations.md): Start work from forges, chat, trackers, schedules and webhooks with automation files, filters, execution overrides and delivery dedupe.
- [Typed decisions](configuration/decisions.md): Configure the small, repeated decisions a factory makes, such as the command guard, triage and routing, with typed questions, thresholds and an LLM fallback.
- [Definitions as code](configuration/definitions-as-code.md): Lay out a factory as a versioned tree rooted at factory.yaml, validate it, apply it atomically or as a canary, and keep it in a GitHub config repo.
- [Definition file reference](configuration/definitions-reference.md): Every key of every definition file, generated from the schemas (kiln/v1).
- [Pipelines and gates](configuration/pipelines-and-gates.md): Fix a factory's stages with pipelines/<name>.yaml, and define where people approve, answer and accept with gates/<name>.yaml.
- [Policies and budgets](configuration/policies-and-budgets.md): Protect paths from self-improvement, require two approvals on sensitive files, and cap what a work item may spend.
- [Skills](configuration/skills.md): Give agents reusable know-how with SKILL.md files, shared across a factory or scoped to one agent, and share them between factories.
- [Studio App definitions](configuration/studio-app-definitions.md): Set a Studio App's agents, skills, MCP servers, ship mode caps, merge gate and budget with the factory building blocks, inherited from the team and the Kiln Project.

## Infrastructure

- [Architecture and security](infrastructure/architecture-and-security.md): The services that make up Kiln, where definitions and runtime state live, and the controls that keep agents from merging, leaking or escaping.
- [Harnesses](infrastructure/harnesses.md): How Kiln runs Claude Code, Codex and OpenCode inside sandboxes, what each run receives, how agents report results, and how to steer a running agent.
- [Sandboxes](infrastructure/sandboxes.md): Where agent runs execute, on a local directory, a Docker container or a Kubernetes pod under gVisor, with an egress allowlist and pause and resume.
- [Self-hosted workers](infrastructure/self-hosted-workers.md): Run agents on your own machines with kiln worker, route agents to them with workerHost, and monitor them with Prometheus.
- [Self-hosting](infrastructure/self-hosting.md): Run Kiln on your own infrastructure, what it needs, how to connect integrations and sandboxes, and where to look when something goes wrong.

## Code forges and integrations

- [Azure DevOps](integrations/azure-devops.md): Use Azure DevOps repositories and boards with a factory, and start work from pull request and work item mentions and assignments.
- [Bitbucket](integrations/bitbucket.md): Use Bitbucket Cloud repositories as a factory's forge and start work from pull request comments.
- [Connections](integrations/connections.md): Connect each external system once for the workspace, opt factories in from factory.yaml, link people's accounts, and see where a factory can reach someone.
- [Custom webhooks](integrations/custom-webhooks.md): Accept events from any system with managed or file webhooks, with signatures, a strict delivery contract, deduplication and a deliveries log.
- [Discord](integrations/discord.md): Send work to a factory with the /kiln slash command or a mention in Discord, and follow it in a thread.
- [GitHub](integrations/github.md): Start work from GitHub issues and comments, get pull requests with evidence back, and complete work items on merge.
- [GitLab](integrations/gitlab.md): Use GitLab.com or self-managed GitLab as a factory's forge, and start work by mentioning the factory's bot in merge request comments.
- [Jira](integrations/jira.md): Connect Jira Cloud with OAuth, start agent sessions by assigning or mentioning the factory, react to issue events, and create roadmap issues.
- [Linear](integrations/linear.md): Start work from Linear agent sessions and issue events, report progress in the session, and let the planning agent create issues with acceptance criteria.
- [Microsoft Teams](integrations/microsoft-teams.md): Mention the Kiln bot in a Teams channel to start work, follow it in the thread, and link your account with sign in.
- [Previews](integrations/previews.md): Deploy each factory pull request to a preview environment on Vercel or Kubernetes, post a card with videos, ask a person to accept it, and serve Studio's live previews.
- [Slack](integrations/slack.md): Send work to a factory by mentioning its alias in Slack, follow progress in the thread, and approve specs and previews with a reply.

## Product owners

- [Writing acceptance criteria](product-owners/acceptance-criteria.md): Write acceptance criteria the factory can test and prove with a video, and understand how Kiln checks them before and after the build.
- [Approving specs and previews](product-owners/approving-specs-and-previews.md): Review a factory's spec and preview, approve or reject them from Slack, the issue, the inbox or MCP, and know what happens next.
- [Planning with the plan agent](product-owners/planning.md): Turn a goal, a PRD or meeting notes into a roadmap of epics and tracker issues with acceptance criteria, each tagged with the factory that should build it.
- [Talking to Studio](product-owners/talking-to-studio.md): Press Talk in a Studio chat to have a spoken conversation with its agent through OpenAI's GPT-Live, reach other chats and Apps by asking, and work hands-free.
- [Working as a product owner](product-owners/workspace.md): How a product owner works with a Kiln factory, from sending an idea to approving the spec, accepting the preview and planning a roadmap.

## Measure and improve

- [Benchmarks](measure-and-improve/benchmarks.md): Compare up to six agent configurations on tasks pinned to exact commits, find the cost and success frontier, and turn the results into routing rules.
- [Dashboard metrics](measure-and-improve/metrics.md): The metrics Kiln computes per factory, such as PR activity, autonomy, cycle time, cost per merged PR and pass rate, and how each one is defined.
- [Replay and canary](measure-and-improve/replay-and-canary.md): Re-run a past run from its saved start state under another definition, and roll out a definition change to a share of new work items before everyone gets it.
- [Scorers](measure-and-improve/scorers.md): Grade a sample of each agent's runs against a rubric with labeled outcomes, a passing score and a sampling rate, and feed failures into self-improvement.
- [Self-improvement](measure-and-improve/self-improvement.md): How Kiln turns repeated scorer failures into a proposed definition change, proves it by replay, and ships it only after human review.

## Developer tools

- [API reference](developer-tools/api.md): Every REST endpoint with its scope, generated from the route table.
- [CLI reference](developer-tools/cli.md): Every kiln command, generated from the CLI's help text.
- [Kiln MCP](developer-tools/mcp.md): Connect coding agents to Kiln over MCP; every tool and its arguments, generated from the server.
- [Tasks, runs and subagents](developer-tools/tasks-and-runs.md): How tasks and runs look through the API, MCP and SDK — stages, states, sources, errors, follow-ups, subagents and what an agent's run token may do.

## Management

- [Admin, RBAC and audit](management/admin-rbac-audit.md): Issue API and MCP tokens with scopes per factory, manage secrets, and read the audit log.
- [Inbox](management/inbox.md): Every decision waiting on people, across all factories, ordered by urgency, with the evidence to decide and the same result from every surface.
- [Portfolio and projects](management/portfolio.md): Group factories into projects, roll up their metrics in the portfolio, and plan roadmaps across them.
- [Secrets, MCP servers and environments](management/secrets-mcps-environments.md): Team and personal secrets, team-managed model keys, the MCPs and apps registry, environment templates that runs start from, and project environments.
- [Teams and users](management/teams-and-users.md): Accounts, login, teams, invites, team and factory roles, API keys, user settings and linked accounts.
- [Usage and spend limits](management/usage-and-spend-limits.md): Usage per team, factory, agent, model and user from run costs, and the team's monthly spend limit with optional auto-stop.

## Guides

- [Build an incident-response factory](guides/incident-response-factory.md): Set up a factory that takes alerts from a webhook and Slack, skips the spec, proposes a fix with tests, and hands a pull request to the on-call engineer.
- [Kiln builds Kiln](guides/kiln-builds-kiln.md): A case study of the kiln-self factory that works on Kiln's own repository, how it is set up, and the rules that keep it from weakening its own checks.
- [Make a factory improve itself](guides/make-a-factory-improve-itself.md): Set up scorers, thresholds and guard rails so a factory turns its own repeated failures into reviewed, replay-tested definition changes.
