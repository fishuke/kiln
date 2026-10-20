---
title: Architecture and security
description: The services that make up Kiln, where definitions and runtime state live, and the controls that keep agents from merging, leaking or escaping.
owner: docs
section: Infrastructure
---

Kiln is a control plane that receives events, decides what to do, and launches agents in disposable sandboxes; agents never run inside the control plane, and no agent identity can merge.

## Services

| Service | Responsibility |
| --- | --- |
| `api` | REST API under `/api/v1`, webhook endpoints, token auth and scopes, work items, gates, projects, definition apply |
| `orchestrator` | Drives work items through stages, gates, retries, budgets, the self-improvement schedule and benchmarks |
| `runner` | Launches sandboxes, issues run tokens, streams run events, collects artifacts |
| `integrations` | Adapters for GitHub, Linear, Jira and Slack; posts results back to the source |
| `mcp` | The Kiln MCP server, over streamable HTTP, with scoped tokens |
| `web` | Dashboard, inbox, product-owner workspace, definition viewer, portfolio |
| `scorer` | Runs judges on sampled runs, writes scores, groups failures |

Every external system sits behind an interface with a fake for tests: forge, tracker, chat, preview provider, sandbox provider, harness and decision provider.

## Where data lives

- **Definitions live in Git** or in Kiln's definition store, keyed by definition SHA. Runtime state never goes into the definition tree.
- **Runtime state** (work items, runs, run events, gates, scores, proposals, decision logs, audit entries, secrets, tokens) lives in Kiln's database.
- **Artifacts** (Playwright videos and reports, sandbox snapshots) go to object storage.
- **Events** go through an event bus with an outbox, so integrations, the scorer and the web app see them in order.

## How a run is isolated

1. Kiln issues a run token for the run's repositories.
2. The runner creates a sandbox from the agent's runner file: image, CPU and memory, setup commands and egress allowlist. See [Sandboxes](sandboxes.md).
3. Kiln clones the repositories with the run token and checks out the work item's `kiln/*` branch.
4. The harness starts inside the sandbox with the instructions, skills and a Kiln MCP connection that uses the same run token.
5. When the run ends, Kiln reads `.kiln/result.json`. If the run succeeded and the stage changes code, Kiln commits leftovers and pushes the branch with the run token. Then it destroys the sandbox. A paused run keeps a snapshot instead.

## Security controls

### No agent can merge

- A run token can push only `kiln/*` branches, open pull requests, comment and add labels, on the repositories of its run. It cannot approve or merge, and it expires after 60 minutes.
- Kiln checks the token before it pushes. A refused push fails the run.
- Agents are told not to push, open pull requests or merge. Kiln does those steps.
- Branch protection on your forge is the final control: require reviews on `main`, and do not give Kiln's GitHub identity a bypass.
- A work item cannot reach `complete` without a merge event or a person's confirmation. This rule is enforced in the state machine and covered by a property test.

### Commands are checked

The [command guard](../configuration/decisions.md#command-guard) rates shell commands before they run and blocks destructive ones or asks a person about risky ones. Claude Code checks every Bash call through a hook. Codex and OpenCode rely on the sandbox for isolation.

### Network is closed by default

Traffic from a sandbox goes through Kiln's egress proxy, which allows only the hosts of the run's repositories and the runner's `egress` list. Everything else is unreachable. On Kubernetes, a NetworkPolicy allows only DNS and the proxy.

### Sandboxes are locked down

Docker sandboxes drop all capabilities and set `no-new-privileges`. Kubernetes sandboxes run under gVisor (`runtimeClassName: gvisor`) as user 1000 (non-root), with no service account token mounted, privilege escalation off, all capabilities dropped and the default seccomp profile.

### Tokens are scoped per factory

API and MCP tokens carry scopes such as `read`, `send`, `decide:spec`, `decide:preview` and `definitions:write`, each for one factory or `*`. A product owner's token can approve previews without touching definitions. Tokens are stored as hashes. See [Admin, RBAC and audit](../management/admin-rbac-audit.md).

### Webhooks are verified

GitHub, Slack and Linear webhooks are checked against their signing secrets, Slack requests older than five minutes are refused, and Jira calls must carry the configured token. Custom webhooks use a bearer token, a URL token or a signature. Repeated deliveries are ignored.

### The factory cannot weaken its own checks

Self-improvement cannot change `policies/` or `gates/`, drops changes to any `protectedPaths`, needs two people for `twoApprovalPaths`, and never opens a proposal without a replay report. Agents cannot approve proposals. See [Policies and budgets](../configuration/policies-and-budgets.md).

### Content is not a source of permissions

Text in issues, tickets and Slack messages becomes the work item's request, never its permissions. What an agent may do comes from the definition, the run token and the gates. A reply in a thread or comment decides a gate only when its author is one of the gate's assignees, matched through the server's `identities` map.

### Everything is audited

Definition applies and rejections, gate decisions, steering, cancellations, pauses, proposals, canary changes, token issues and secret changes are written to the audit log with the actor.

## Design records

The decisions behind this architecture are written down as ADRs in `docs/adr/`:

- [0001 TypeScript monorepo](../../adr/0001-typescript-monorepo.md)
- [0002 Orchestration](../../adr/0002-orchestration.md)
- [0003 Definition format](../../adr/0003-definition-format.md)
- [0004 Harness adapters](../../adr/0004-harness-adapters.md)
- [0005 Storage](../../adr/0005-storage.md)
- [0006 Decision layer](../../adr/0006-decision-layer.md)
- [0007 Open source and bring your own keys](../../adr/0007-open-source-byok.md)
- [0008 Humans merge](../../adr/0008-humans-merge.md)

The [threat model](../../security/threat-model.md) lists the threats these controls answer.

## Data sent to model providers

Harnesses send the prompt, instructions, skills and the code they read to the model they use. Typed decisions send only the fields listed in each decision's `state`. Route model traffic through your own gateway if you need EU endpoints or zero data retention.

## Related pages

- [Sandboxes](sandboxes.md)
- [Harnesses](harnesses.md)
- [Self-hosting](self-hosting.md)
- [Typed decisions](../configuration/decisions.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
- [Threat model](../../security/threat-model.md)
- [Architecture decision records](../../adr/README.md)
