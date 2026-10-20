---
title: Build an incident-response factory
description: Set up a factory that takes alerts from a webhook and Slack, skips the spec, proposes a fix with tests, and hands a pull request to the on-call engineer.
owner: docs
section: Guides
---

This guide builds a factory, `@oncall`, that turns an alert or a Slack message into a tested fix on a pull request within minutes, while a person still decides what merges.

## What you will build

```text
alert webhook ─┐
               ├─> foreman ─> triage ─> fix ─> verify (CI + tests) ─> review ─> hand-off
@oncall Slack ─┘
```

No spec stage, because incidents need speed. People still approve risky commands and merge the fix.

## 1. The factory

```yaml
# factory.yaml
schemaVersion: kiln/v1
name: incident-response
alias: oncall
repositories:
  - { owner: acme, name: web }
integrations: [slack]
agentDefaults:
  harness: { type: claude-code, model: claude-sonnet-5-5 }
  runner: linux-node
defaultPipeline: incident
budgets: { perWorkItemUsd: 25 }
```

## 2. The agents

`agents/foreman/agent.md`:

```markdown
---
agentType: FOREMAN
description: Coordinates incident work
---
Keep the thread short and factual. Ask instead of guessing.
```

`agents/triage/agent.md`:

```markdown
---
agentType: TRIAGE
---
Classify the alert. Name the most likely cause from the runbooks skill and quote the evidence.
```

`agents/fixer/agent.md`:

```markdown
---
agentType: IMPLEMENT
description: Smallest safe fix with a regression test
---
Make the smallest change that stops the incident. Add a test that fails without the fix.
Do not refactor. Do not touch infrastructure or data.
```

`agents/verify/agent.md`:

```markdown
---
agentType: VERIFY
---
Run the test suite. Report testsPassed in the result file.
```

`agents/review/agent.md`:

```markdown
---
agentType: REVIEW
---
Check that the fix is minimal and the new test covers the failure.
Use needs_human for anything that touches auth, payments or data.
```

## 3. Runbooks as a skill

`skills/runbooks/SKILL.md`:

```markdown
---
name: runbooks
description: Known incident causes and how to confirm each one
owner: sre
---
## 502s from the API
Check the last deploy and the connection pool size in config/db.ts.

## Login loop
Check the session cookie domain in config/session.ts.
```

Every agent receives it. See [Skills](../configuration/skills.md).

## 4. The pipeline

```yaml
# pipelines/incident.yaml
description: Fast path for incidents, no spec
stages:
  - { id: triage, agent: triage }
  - { id: build,  agent: fixer }
  - { id: verify, agent: verify, requires: [ci_green, tests_pass], on_fail: build, max_loops: 2 }
  - { id: review, agent: review, on_fail: build, max_loops: 1 }
  - { id: handoff, action: handoff }
```

After two failed verify loops, Kiln opens a `verify-stuck` question in the thread and parks the item, so a person takes over. See [Pipelines and gates](../configuration/pipelines-and-gates.md).

## 5. A runner with a closed network

```yaml
# runners/linux-node.yaml
image: node:22-bookworm
backend: docker
shape: { vcpus: 2, memoryGb: 4 }
setupCommands:
  - corepack enable
  - pnpm install --frozen-lockfile
egress:
  - registry.npmjs.org
  - llm-gateway.internal.acme.com
```

Only these hosts and the hosts of the cloned repositories, here `github.com`, are reachable. See [Sandboxes](../infrastructure/sandboxes.md).

## 6. A stricter command guard

Incidents tempt people to touch production. Block anything that looks like it:

```yaml
# decisions/command-guard.yaml
state: [command, cwd, repo, branch]
questions:
  risk_level: { type: choice, options: [safe, risky, destructive] }
  remote_exec: { type: probability }
  deletes_files: { type: probability }
  touches_prod: { type: probability }
policy:
  block: "risk_level.destructive >= 0.6 or remote_exec >= 0.6 or touches_prod >= 0.5"
  ask_human: "risk_level.risky >= 0.3 or deletes_files >= 0.5"
on_error: deny
timeout_ms: 800
```

With `on_error: deny`, an unanswered decision takes the first policy entry, `block`. See [Typed decisions](../configuration/decisions.md).

```yaml
# policies/guard.yaml
protectedPaths: [decisions/**, pipelines/**]
```

## 7. Alerts and Slack

```yaml
# webhooks/alerts.yaml
authMode: signature
signatureScheme: standard_webhooks
secretName: ALERTS_WEBHOOK_SECRET
deliveryIdHeader: webhook-id
```

`automations/alerts/automation.md`:

```markdown
---
triggers:
  - provider: webhook
    event: received
    filter: { webhook: alerts }
---
An alert fired. Find the cause, then fix it with a regression test.
```

`automations/slack/automation.md`:

```markdown
---
triggers:
  - provider: slack
    event: app_mention
    filter: { channel: [C0INCIDENTS] }
---
Treat this as an incident report.
```

Store `ALERTS_WEBHOOK_SECRET` in Kiln and point your alerting tool at `POST /webhooks/oncall/alerts`. The alert's `title` or `summary` field becomes the work item's title. See [Automations](../configuration/automations.md#webhooks).

## 8. Validate and apply

```bash
kiln validate .
kiln apply --dry-run
kiln apply
```

## 9. Try it

Mention the factory in the incidents channel:

```text
@oncall users get a login loop after the 14:02 deploy
```

Follow the thread. You should see a "Ready to merge" message with the pull request, which has the fix, the regression test and the `factory:oncall` label. If the fixer wants to run a risky command, an approval request appears in the inbox.

## 10. Measure it

Add a scorer for the fixer, and watch cycle time and cost per merged PR on the dashboard. See [Scorers](../measure-and-improve/scorers.md) and [Dashboard metrics](../measure-and-improve/metrics.md).

## Related pages

- [Pipelines and gates](../configuration/pipelines-and-gates.md)
- [Automations](../configuration/automations.md)
- [Typed decisions](../configuration/decisions.md)
- [Slack](../integrations/slack.md)
- [Make a factory improve itself](make-a-factory-improve-itself.md)
