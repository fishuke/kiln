# Claude Code Build Plan — Self-Improving Software Factory Platform

Oct 20, 2026 · @Someone

## Summary

We are building **Kiln** (working name): a self-hostable software-factory platform modeled on Warp Factories, with three things Warp does not center: an explicit pipeline graph per factory, a planning layer that manages many projects, and a product-owner workspace for ideating, approving specs and accepting previews.

Kiln keeps Warp's proven core. A factory is a team of cloud agents attached to repositories; a **foreman** routes each **work item** through stages; everything is declared in a versioned definition tree rooted at `factory.yaml`; **scorers** grade runs, and **self-improvement** turns repeated failures into pull requests against the app or the factory itself. Kiln's own repository is run by a Kiln factory from milestone 3 onward, so the product improves itself through the same loop it sells.

**What is the same as Warp, and what we add**

| Warp Factories concept | Kiln equivalent | Kiln addition |
| --- | --- | --- |
| Factory, foreman, work items | Same names and semantics | Projects group factories; a portfolio view spans them |
| Stages chosen by foreman instructions | Same, as the default | Optional `pipelines/*.yaml` graph with typed gates when a team wants determinism |
| Agents with `agentType` (foreman, triage, spec, implement, review, verify, custom) | Same roles | `plan` and `po-assistant` roles for roadmaps and spec interviews |
| Definitions as code, JSON Schema, PR checks | Same file layout, our own schema `v1` | `kiln validate`, `kiln diff`, `kiln apply --dry-run`, canary rollout of definition changes |
| Scorers, self-improvement, benchmarks | Same mechanics | Replay from saved run state; meta-factory that improves Kiln itself |
| Factory MCP, API, SDKs, webhooks | Same surfaces | PO-safe MCP scopes (Warp's has no per-factory scopes) |
| Inbox, dashboard | Same | PO workspace: idea board, spec review, preview gallery |

**How to use this plan with Claude Code.** Export this doc to Markdown as `docs/plan/PLAN.md` in a new repo. Copy the CLAUDE.md block from the Claude Code setup section into the repo root. Then run one milestone per branch: open Claude Code, type `/next-task`, and let it take the next unchecked task from the execution plan, write tests first, implement, run the checks, and open a PR. You review and merge. The acceptance criteria under each task are the definition of done.

**Scope warning.** Warp Factories is a full company's product. This plan reaches a usable, self-hosted v1 for one organization in about 20 weeks with 2–3 engineers driving Claude Code. Multi-tenant SaaS, billing and Azure DevOps support are out of scope for v1.

## How Warp Factories works

Warp Factories turns issues, tickets and Slack messages into reviewed pull requests: a team of cloud agents does the work, and people approve specs and merges ([overview](https://docs.warp.dev/factories/)). Everything below comes from Warp's docs as of October 2026, where the product is in early access.

**Core objects**

| Object | What it is in Warp |
| --- | --- |
| Factory | A team of cloud agents attached to the repositories that ship together. Warp advises one factory per product, specialized with custom agents and skills rather than split by team. |
| Work item | One request (issue, support thread, PR, scheduled job, Factory MCP task). Keeps its source context from intake to handoff, however many agents touch it. |
| Foreman | The coordinating agent. It shares the factory's handle, so `@payments` reaches it from Slack or Linear. It picks the shortest path through stages, skips stages, starts midway, or sends work back. |
| Factory agents | Roles set by `agentType`: `FOREMAN`, `TRIAGE`, `SPEC`, `IMPLEMENT`, `REVIEW`, `VERIFY`, `CUSTOM`. `spawnableBy` controls which agents may start which. |
| Automations | Trigger files: provider + event + filter (GitHub, GitLab, Azure DevOps, Jira, Linear, Slack, Teams, schedule, webhook, and factory `work_item_stage_changed`). |
| Runners | Compute definitions: Linux, macOS or Windows, instance shape, Docker image, setup commands. |
| Routers | Model routers by `complexity` (easy, medium, hard) or by `prompt` description. |
| Skills | `SKILL.md` directories, shared under `skills/` or per agent under `agents/<name>/skills/`. |
| Scorers | LLM judges with 1–20 labels, a passing score, a sampling rate (default 25%) and a judge model. |
| Benchmarks | Suites of tasks pinned to exact commits, compared across up to six configurations. |

**Lifecycle** ([how it works](https://docs.warp.dev/factories/how-factories-work/)): intake → foreman → triage → planning (if needed) → human spec approval → building → reviewing (loops back on revisions) → human handoff → complete on merge notification. The review agent's verdict is advisory. The factory never merges; branch protection does that job. Spec approval and "ask instead of guessing" are written into the foreman's editable instructions, not hard-coded.

**Definitions as code** ([syntax](https://docs.warp.dev/factories/factory-as-code/)). A factory is a versioned tree rooted at `factory.yaml` with `agents/<name>/agent.md` (YAML frontmatter plus instructions), `automations/<name>/automation.md`, `runners/*.yaml`, `routers/*.yaml`, `benchmarks/<suite>/`, `scorers/<name>/scorer.md`, `skills/`, `webhooks/*.yaml`. Each agent can choose its harness (`oz`, `claude`, `codex`) and model. Definitions live in a Warp-managed repo or your own GitHub repo, where merges to `main` update the factory after a `warp/factory-config` PR check. Warp publishes JSON Schemas (`v1alpha1`) and applies a definition as one unit, keeping the last valid one if validation fails.

**Self-improvement** ([docs](https://docs.warp.dev/factories/measure-and-improve/self-improvement/)). Scorers with `selfImprovement: true` feed failures into a scheduled check. By default it starts a follow-up run once an agent has 25 distinct unreviewed failures, or its oldest is seven days old. The run proposes a fix to application code or to the factory definition, as a PR that lists the regressions it addresses. Nothing is adopted without review.

**Factory MCP** ([docs](https://docs.warp.dev/factories/factory-mcp/)). A hosted MCP server lets any coding agent create factories, send tasks (`send_task`), pull a task down to a local worktree (`get_task start_working=true`), message the foreman, hand work back, and validate definitions. Warp notes it has no read-only or per-factory scopes.

**Execution.** Every agent run is an ordinary cloud run on Warp's automation platform, on Warp-hosted compute or managed self-hosted workers (Docker, Kubernetes, direct, or monorepo worktrees).

**Lessons we copy:** one work item identity end to end; foreman-chosen shortest path; humans at spec, questions and merge; definitions as reviewed code with a schema; scorers that feed self-improvement PRs; local handoff through MCP. **Gaps we fill:** explicit pipeline graphs for teams that want them, scoped MCP tokens, a planning layer across projects, and a PO-first workspace.

## Product scope

V1 serves one organization, self-hosted, with four personas sharing one inbox and one definition repo per factory.

| Persona | Jobs in Kiln | Main surfaces |
| --- | --- | --- |
| Product owner | Capture ideas, run a spec interview, approve specs, review previews, accept work, plan roadmaps | Slack/Linear/Jira, PO workspace (idea board, spec review, preview gallery), inbox |
| Engineer | Send work, review PRs, take tasks local, write skills and agents, tune pipelines | GitHub, Kiln MCP from Claude Code or Codex, CLI, inbox |
| Factory engineer | Own definitions, scorers, benchmarks, budgets; review self-improvement PRs | Definition repo, dashboard, CLI |
| Org admin | Teams, integrations, secrets, runners, policies, audit | Admin console |

**V1 must**

- Run factories defined as code (`factory.yaml` tree), validated by schema, applied atomically, with PR checks.
- Route work items from GitHub, Linear, Jira, Slack, webhooks, schedules and the Kiln MCP through a foreman, or through an explicit pipeline graph when one is defined.
- Run agents on Claude Code (primary), Codex and OpenCode harnesses in disposable Docker or Kubernetes sandboxes.
- Produce evidence per work item: spec, PR, test report, Playwright videos, preview URL.
- Pause at gates (spec approval, questions, preview acceptance) and never merge on its own.
- Score runs, open self-improvement PRs against app repos and definition repos, and run benchmarks on pinned tasks.
- Manage multiple projects: a portfolio view, roadmaps produced by a planning agent, and cross-factory reporting.
- Run its own development through a Kiln factory (dogfooding) from milestone 3.

**V1 must not**

- Merge or deploy without a human, or adopt any self-improvement change without review.
- Offer multi-tenant SaaS, billing, Azure DevOps, Windows or macOS runners.
- Build its own agent loop; harnesses are adopted, not written.

## Domain model

Fourteen entities make up Kiln; definitions live in Git, runtime state lives in Postgres, and nothing is stored in both.

| Entity | Lives in | Key fields | Notes |
| --- | --- | --- | --- |
| Workspace | Postgres | id, name, members, roles | One per org in v1 |
| Project | Postgres | id, name, owner, factories\[\], roadmap\_id | Groups factories for planning and reporting |
| Factory | Git (definition) + Postgres (binding) | name, alias, definition\_repo, applied\_sha, status | `applied_sha` = last valid definition |
| Agent | Git `agents/<name>/agent.md` | agentType, harness, model or router, runner, skills, mcpServers, spawnableBy | Roles add `PLAN`, `PO_ASSISTANT` to Warp's set |
| Pipeline (optional) | Git `pipelines/<name>.yaml` | stages\[\], gates\[\], loops, budget | Absent → foreman chooses the path |
| Automation | Git `automations/<name>/automation.md` | triggers\[\], filter, agent, overrides | Same shape as Warp |
| Runner | Git `runners/*.yaml` | image, shape, setupCommands, backend | Docker or Kubernetes |
| Skill | Git `skills/**/SKILL.md` | name, description, body, owner | Shared or per agent |
| Scorer | Git `scorers/<name>/scorer.md` | agents, labels, passingScore, samplingRate, model, selfImprovement | Same shape as Warp |
| Benchmark | Git `benchmarks/<suite>/` | agent, configurations\[\], tasks\[\] with pinned SHAs | Same shape as Warp |
| Work item | Postgres | id, factory, source\_ref, requester, stage, status, artifacts\[\], cost | Identity kept end to end |
| Run | Postgres + object store | id, work\_item, agent, harness, model, definition\_sha, start\_state, trace\_id, cost, outcome | `start_state` enables replay |
| Gate | Postgres | id, work\_item, kind (spec, question, preview, merge, custom), assignee, decision, evidence | Drives the inbox |
| Score | Postgres | run\_id, scorer, label, score, reviewed | Feeds self-improvement |

**Work item states:** `received → triaging → planning → awaiting_spec → building → reviewing → awaiting_preview → handed_off → complete`, plus `blocked`, `cancelled` and `failed`. Every transition emits a `work_item.stage_changed` event, so automations can trigger on stages exactly as Warp's `factory` provider does.

**Invariants enforced in code and tests:** a run always records the `definition_sha` it ran under; a work item never reaches `complete` without a merge event or explicit human confirmation; no agent identity holds merge permission; a definition is applied whole or not at all.

## Architecture and repo layout

Kiln is one TypeScript monorepo with seven deployable services around a Temporal-backed orchestrator; agents never run inside the control plane, only in sandboxes launched by the runner service.

&#91;embedded content: Kiln architecture · services and the improvement loop\]

Work enters through the front doors and flows right to the runner's sandboxes; scored runs flow back as pull requests to the definition repo, which the API applies only after a human merges them.

| Service | Responsibility |
| --- | --- |
| `api` | REST + webhooks ingress, auth (OIDC), RBAC, work items, gates, projects, definitions apply |
| `orchestrator` | Temporal workflows: foreman loop, pipeline graphs, gates, retries, budgets, self-improvement schedule, benchmarks |
| `runner` | Launches sandboxes (Docker or Kubernetes), injects short-lived tokens, streams run events, collects artifacts |
| `integrations` | Adapters for GitHub, Linear, Jira, Slack; posts results back to the source thread or issue |
| `mcp` | Kiln MCP server (streamable HTTP) with scoped tokens |
| `web` | Dashboard, inbox, PO workspace, definition viewer, portfolio |
| `scorer` | Runs judges on sampled runs, writes scores, groups failures |

**Repo tree**

```text
kiln/
├─ CLAUDE.md                      # rules for Claude Code (see setup section)
├─ .claude/                       # agents, skills, commands, hooks for building Kiln
├─ docs/
│  ├─ plan/PLAN.md                # this plan, exported
│  ├─ adr/                        # architecture decision records
│  └─ site/                       # public docs (Astro Starlight)
├─ apps/
│  ├─ api/  orchestrator/  runner/  integrations/  mcp/  scorer/
│  └─ web/                        # Next.js
├─ packages/
│  ├─ schema/                     # JSON Schemas + zod types for definition files
│  ├─ definitions/                # parser, validator, resolver, differ
│  ├─ harness/                    # HarnessAdapter + claude-code, codex, opencode adapters
│  ├─ sandbox/                    # SandboxProvider + docker, k8s providers
│  ├─ evidence/                   # Playwright video, test report, preview card builders
│  ├─ events/                     # typed event bus contracts
│  ├─ sdk-ts/                     # public TypeScript SDK
│  └─ cli/                        # `kiln` CLI
├─ factories/
│  ├─ kiln-self/                  # the factory that builds Kiln (dogfood)
│  └─ templates/                  # starter factories: single-repo, sdlc, incident, po-feature
├─ runners/images/                # sandbox base images
├─ deploy/  helm/  docker-compose.yml
└─ e2e/                           # end-to-end tests against a fake forge and tracker
```

**Boundaries that keep it modular:** packages never import apps; apps talk through the API, Temporal and the event bus only; every external system sits behind an interface in `packages/` with a fake for tests (`FakeForge`, `FakeTracker`, `FakeHarness`, `FakeSandbox`).

**Web app layout (mirrors Warp's).** Global sidebar: **New run** (a home composer, "Tell me what you'd like to build in \<factory>", with a factory picker and attachments, which creates a work item for that factory's foreman), Inbox, Runs, MCPs and apps, Secrets, Users, Projects. Under each factory: Dashboard, Agents, Automations, Pipelines, Scorers, Self-improvement, Benchmarks, Factory definition, Settings. Any number of factories and projects appear in the sidebar, and each can be pinned.

**Coverage of Warp's Factory Stack** ([The Factory Stack](https://www.warp.dev/blog/the-factory-stack))

| Stack layer | Covered in this plan | Added now |
| --- | --- | --- |
| Factories-as-code (agents, runners, repos, automations, integrations, scorers) | Definition tree, schema, validate, apply, canary | — |
| Data and context (MCPs with RBAC, memories, traces, audit logs, skills, marketplace) | MCP gateway, traces, skills, audit (M7-T3) | Memories (M6-T4), skills marketplace (M6-T5) |
| Compute (fast, pausable, resumable remote envs; computer and browser use; multi-platform) | Docker and Kubernetes sandboxes, Playwright and browser tools | Pause, resume and move sandbox state (M2-T8). macOS and Windows stay out of v1 |
| Inference (any model and harness, open-weight, neo-clouds, Bedrock/Vertex, fine-tunes, tunable routing) | Three harnesses, LiteLLM gateway, routers, Jev decisions | — |
| Improvement (cost per PR, cycle time, metrics via API and MCP, scorers, replay, benchmarks, self-improvement) | All except metrics over MCP | Metrics API and MCP tools (M5-T7) |
| Orchestration (launch, track, recover, control room, subagents, live steering, cloud-to-local handoff) | All except live steering | Steer a running agent (M3-T8) |
| Access (Factory MCP, Slack/Teams, Jira/Linear, forges, web and mobile UI) | All except Teams and mobile | Home composer (M4-T6); Teams and mobile after v1 |

## Tech stack

One language end to end (TypeScript) keeps Claude Code effective across the whole repo and matches the SDKs of the harnesses we drive.

| Concern | Choice | Why |
| --- | --- | --- |
| Language, build | TypeScript 5, Node 22, pnpm workspaces, Turborepo | One toolchain; Claude Agent SDK and OpenCode SDK are TypeScript |
| API | Hono on Node, zod validation, OpenAPI generated from zod | Small, typed, fast; the OpenAPI doc feeds the SDK and docs |
| Orchestration | Temporal (TypeScript SDK), self-hosted | Durable workflows, signals for human gates, timers for nudges, replay for debugging |
| Database | Postgres 16 + Drizzle ORM; pgvector for run search | One store for runtime state; vector search over past runs for triage |
| Events | Postgres outbox + NATS JetStream | Reliable fan-out to integrations, scorer and web |
| Object storage | S3-compatible (MinIO locally) | Videos, traces, logs, artifacts |
| Harnesses | Claude Agent SDK (primary), Codex `exec`, OpenCode server | Same three-harness pattern as Warp (`oz`, `claude`, `codex`), with OpenCode replacing Warp's own agent |
| Model access | LiteLLM gateway (or Bedrock/Vertex), EU endpoints, zero data retention | Routing, budgets, one audit point |
| Sandboxes | Docker (dev, small installs), Kubernetes + gVisor (production) | Matches Warp's Docker and Kubernetes self-hosted backends |
| Browser evidence | Playwright with video and trace; agent-browser for exploration; Chrome DevTools MCP for diagnostics | Deterministic evidence plus cheap exploration |
| Web | Next.js 15, React, Tailwind, shadcn/ui | Fast to build, well known to Claude Code |
| Auth | OIDC (Entra ID, Google, Okta) + scoped API tokens | Enterprise SSO from day one |
| Observability | OpenTelemetry (GenAI conventions) → Langfuse for traces and scores; Grafana for service metrics | Run traces double as scorer input |
| Docs | Astro Starlight, MDX, `llms.txt`, `.md` per page | The same stack and agent-friendly features Warp's docs use |
| Testing | Vitest, Playwright, Testcontainers, Temporal test env | Fakes for all external systems |
| CI | GitHub Actions | Also runs `kiln validate` on definition PRs |

## Decision layer: Jev from TypeSafe AI

Use Jev for the hundreds of small, repeated yes/no and pick-one decisions a factory makes per work item, and keep LLM harnesses for writing, coding and multi-step reasoning. Kiln code owns the thresholds, so a policy change edits a number, not a prompt.

**What Jev is.** TypeSafe AI released Jev on September 15, 2026 as an early-access "System One" model that returns typed decisions instead of text ([TechJuice/LetsDataScience](https://letsdatascience.com/news/typesafe-ai-launches-jev-decision-model-889a38c0)). You send program state plus typed questions (Choice, Score, or a true/false probability) and it answers all of them in one parallel call, each with a calibrated probability. TypeSafe quotes 70–500 ms responses at $0.042 per million input tokens with free output ([VKTR](https://www.vktr.com/ai-platforms/chatgpt-cocreator-launches-typesafe-ai-with-jev/), [The Register](https://www.theregister.com/a/5296711)). It cannot write, code or reason over many steps. Speed and accuracy figures are vendor claims until we benchmark them.

**Where Kiln uses it**

| Decision point | Typed questions | Policy in Kiln code |
| --- | --- | --- |
| Command guardrail in every sandbox | `risk_level` (safe, risky, destructive), `remote_exec`, `deletes_files`, `touches_prod` | p < 0.3 allow, 0.3–0.8 ask a human, ≥ 0.8 block. Fast enough to check every shell command |
| Foreman routing | `next_stage` (triage, plan, build, review, handoff), `needs_spec`, `needs_human` | Skip a stage only above 0.85 confidence; otherwise ask the foreman LLM |
| Triage | `kind` (feature, bug, chore, incident, question), `size` (xs–xl), `duplicate_of_recent` | Low confidence sends the item to the triage agent |
| Model router | `complexity` (easy, medium, hard) | Replaces Warp-style complexity routers; cheap model on easy above 0.8 |
| Automation filters | `matches_intent` on Slack or webhook payloads | Fewer false triggers than keyword filters |
| Spec check | per acceptance criterion: `is_testable`, `is_ambiguous` | Blocks spec approval if any criterion fails |
| Review risk gate | `risk_tier` (low, medium, high), `touches_sensitive_area` | Routes to one reviewer or to code owners |
| Scorers | each scorer label as a Choice with probability | Score 100% of runs instead of 25%; send uncertain ones to an LLM judge |
| Self-improvement | `failure_category` per failed run | Clusters failures before the improver agent reads them |
| Inbox and incidents | `urgency`, `likely_cause` among known runbook causes | Orders the inbox; picks runbook candidates for the SRE agent |

**How it is built**

- A `DecisionProvider` interface in `packages/decide` with three implementations: `JevProvider`, `LlmProvider` (structured output from the LLM gateway, as fallback) and `FakeProvider` for tests.
- A new definition directory `decisions/<name>.yaml` declares the questions, the state fields to send, the thresholds and the fallback, so factories customize decisions as code:

```yaml
# decisions/command-guard.yaml
provider: jev            # jev | llm
state: [command, cwd, repo, branch]
questions:
  risk_level: { type: choice, options: [safe, risky, destructive] }
  remote_exec: { type: probability }
  deletes_files: { type: probability }
policy:
  block: "risk_level.destructive >= 0.8 or remote_exec >= 0.8"
  ask_human: "risk_level.risky >= 0.3"
on_error: llm             # fall back if Jev is down or slow
timeout_ms: 800
```

- Every decision is logged with inputs, probabilities and the action taken, so scorers can audit it and benchmarks can compare Jev against the LLM fallback on the same cases.
- Sensitive state is redacted before it leaves the cluster; confirm Jev's data retention and region terms before sending production data.

**Risks.** Early-access vendor with no track record; calibration must be checked on our own labeled set; if Jev is unavailable, every decision falls back to the LLM path at higher latency and cost. Keep Jev optional per factory until M5 benchmarks prove it.

## Factory-as-code spec, CLI, API and MCP

Kiln reads Warp-shaped definition trees with schema version `kiln/v1`, adding four optional directories (\`decisions/\` for typed Jev decisions, see the decision layer section, plus): `pipelines/`, `gates/` and `policies/`. Keeping the layout close to Warp's makes migration both ways cheap.

**Definition tree**

```text
factory.yaml
agents/<name>/agent.md            # frontmatter + instructions
agents/<name>/skills/<skill>/SKILL.md
automations/<name>/automation.md  # triggers + starting prompt
pipelines/<name>.yaml             # optional explicit stage graph
gates/<name>.yaml                 # reusable gate rules
policies/<name>.yaml              # paths, actions, budgets, who may trigger
runners/<name>.yaml
routers/<name>.yaml
scorers/<name>/scorer.md
benchmarks/<suite>/suite.yaml + tasks/*.yaml
skills/<skill>/SKILL.md
webhooks/<name>.yaml
```

**factory.yaml example**

```yaml
schemaVersion: kiln/v1
name: web-app
alias: webapp                     # @webapp in Slack, Linear, Jira
project: customer-portal
repositories:
  - { forge: github, owner: acme, name: web-app }
  - { forge: github, owner: acme, name: design-system, deferred: true }
integrations: [slack, linear]
agentDefaults:
  harness: { type: claude-code, model: router:by-task }
  runner: linux-node
selfImprovement: { failedRunThreshold: 15, reviewers: { type: team } }
defaultPipeline: feature          # omit to let the foreman choose freely
budgets: { perWorkItemUsd: 40, monthlyUsd: 6000 }
```

**pipelines/feature.yaml example**

```yaml
stages:
  - { id: triage,  agent: triage }
  - { id: spec,    agent: spec, skip_if: "triage.size in ['xs','s']", gate: spec-approval }
  - { id: build,   agent: implement, fan_out: per_user_story }
  - { id: verify,  agent: verify, requires: [ci_green, criteria_videos], on_fail: build, max_loops: 3 }
  - { id: preview, action: preview.deploy, gate: preview-acceptance }
  - { id: review,  agent: review, advisory: true }
  - { id: handoff, action: handoff }   # humans merge via branch protection
```

**gates/spec-approval.yaml example**

```yaml
kind: approval
approvers: [requester, role:po]
evidence: [PRODUCT.md, open_questions]
nudge: 24h
expire: 72h -> park
```

**CLI (`kiln`)**

| Command | Does |
| --- | --- |
| `kiln init [--template sdlc]` | Scaffold a definition tree from a template |
| `kiln validate [path]` | Schema + reference checks, exit code for CI |
| `kiln diff --against applied` | Show what an apply would change |
| `kiln apply [--dry-run] [--canary 10%]` | Apply atomically; canary routes a share of new work items to the new definition |
| `kiln send "<task>" --factory webapp` | Create a work item |
| `kiln pull <task>` / `kiln handback <task>` | Take a task to a local worktree, return it |
| `kiln runs`, `kiln inbox`, `kiln replay <run> --with <sha>` | Inspect, decide, replay |
| `kiln bench run <suite>` | Run a benchmark suite |

**API.** REST under `/api/v1`: `factories`, `definitions` (validate, diff, apply), `work-items`, `runs` (events stream over SSE), `gates` (decide), `projects`, `roadmaps`, `scorers`, `benchmarks`, `webhooks/{id}`. OpenAPI generated from zod; SDK generated from OpenAPI.

**Kiln MCP.** Same tool set as Warp's Factory MCP (`list_factories`, `send_task`, `get_task`, `message_foreman`, `get_conversation`, `complete_task`, `get_factory_file_schema`, `validate_factory_files`) plus `decide_gate`, `list_inbox`, `plan_project`. Unlike Warp's, tokens carry scopes: `read`, `send`, `decide:spec`, `decide:preview`, `definitions:write`, per factory. A PO's token cannot touch definitions.

## Self-improvement and self-hosting

Kiln improves at two levels with one mechanism: scorers flag failures, a follow-up run proposes a fix as a PR, a replay proves it, and a human merges it. The same loop runs on customer factories and on Kiln's own code.

**Level 1: a factory improves itself.**

1. Scorers sample runs (default 25%) and label them against rubrics in `scorers/`.
2. Failures with `selfImprovement: true` accumulate per agent. A scheduled check fires at `failedRunThreshold` distinct unreviewed failures or when the oldest is 7 days old, matching Warp's defaults; a **Run now** button skips the wait.
3. The `improver` agent clusters the failures, reads their traces and human corrections, and decides whether the fix belongs in application code or the definition (instructions, skills, router, runner, pipeline).
4. Before opening the PR it replays 10–30 of the failing runs from their saved `start_state` with the proposed definition, and attaches pass rates before and after.
5. The PR lists "Regressions addressed" with links to the runs and scores. A reviewer from the configured pool merges or rejects it. Rejections are stored as negative examples for the improver.
6. After merge, `kiln apply --canary` sends 10% of new work items to the new definition for a week, then 100% if scores hold.

**Level 2: Kiln builds Kiln.** From milestone 3, the `factories/kiln-self/` definition runs against the Kiln repo itself:

- Issues labeled `kiln-ready` in the Kiln repo go to the `kiln-self` foreman, which triages, specs, builds, verifies and opens PRs. Humans merge.
- Scorers grade Kiln's own runs; self-improvement PRs land against `factories/kiln-self/` and against `packages/` code.
- A `meta` scorer checks that every self-improvement PR includes a replay report, so the loop cannot quietly skip evidence.
- Safety rail: the `kiln-self` factory is forbidden from editing `packages/definitions/validator*`, `apps/api/auth/**`, `policies/` and any gate logic. Those paths need two human approvals. The factory can never weaken the checks that review it.
- Bootstrap: Claude Code builds milestones 0–2 by hand from this plan; from milestone 3 the team files new tasks as issues and lets `kiln-self` take a growing share, tracked as "% of Kiln PRs made by Kiln".

**Managing and planning other projects.** The `plan` agent turns a PO's goal, a PRD or Granola notes into a roadmap: epics, milestones, dependencies, and issues created in Linear or Jira with acceptance criteria. Each issue is tagged with the factory that should take it. The portfolio view rolls up work items, cost, cycle time and scores across all projects, and a weekly digest tells each PO which decisions are waiting on them.

## Claude Code execution plan

Eight milestones over about 20 weeks; each task is sized for one Claude Code session and one PR, carries an ID for `/next-task`, and is done only when its acceptance criteria pass in CI.

### M0 — Repo foundation (week 1)

- [ ] **M0-T1 Monorepo scaffold.** pnpm + Turborepo, apps and packages from the tree, strict TS, ESLint, Prettier, Vitest. *Done when:* `pnpm build && pnpm test && pnpm lint` pass on an empty skeleton in CI.
- [ ] **M0-T2 Local stack.** `docker-compose.yml` with Postgres, Temporal, MinIO, NATS, LiteLLM. *Done when:* `pnpm dev:up` starts all and a health script returns green.
- [ ] **M0-T3 Claude Code setup.** CLAUDE.md, `.claude/agents`, `.claude/commands`, hooks from the setup section. *Done when:* `/next-task` picks M1-T1 and the pre-commit hook runs typecheck and tests.
- [ ] **M0-T4 ADRs.** ADR-001 TypeScript monorepo, 002 Temporal, 003 definition format compatible with Warp, 004 harness adapters. *Done when:* four ADRs merged in `docs/adr/`.

### M1 — Definitions as code (weeks 2–3)

- [ ] **M1-T1 JSON Schemas + zod types** for every file kind in `packages/schema`. *Done when:* schemas reject unknown keys; 40+ fixture files (valid and invalid) pass.
- [ ] **M1-T2 Parser and resolver.** Read a tree, parse frontmatter, resolve inheritance (`agentDefaults` → agent → automation overrides), produce one `ResolvedFactory`. *Done when:* snapshot tests cover inheritance and `null` clearing rules.
- [ ] **M1-T3 Validator.** Cross-references (runner, router, agent, skill, scorer names), exactly-one-of rules (model vs harness), file-line error reporting. *Done when:* each rule has a failing fixture with an exact error message.
- [ ] **M1-T4 `kiln validate` and `kiln diff`.** *Done when:* CLI exits non-zero with file:line errors; diff prints added, changed, removed resources.
- [ ] **M1-T5 Atomic apply.** API stores definitions by SHA, applies whole or keeps last valid. *Done when:* an integration test applies a broken tree and the previous SHA stays active.
- [ ] **M1-T6 Warp import.** `kiln import --from-warp` maps `v1alpha1` trees to `kiln/v1`. *Done when:* Warp's public example trees convert and validate.

### M2 — Runs, harnesses, sandboxes (weeks 4–6)

- [ ] **M2-T1 SandboxProvider + Docker provider.** Build from runner file, clone repos, run setup commands, egress allowlist, teardown. *Done when:* a sandbox starts from a cached image in under 15 s locally and is destroyed after the run.
- [ ] **M2-T2 HarnessAdapter + Claude Code adapter.** Start a headless session in the sandbox with instructions, skills and MCP config; stream events; collect artifacts. *Done when:* `FakeForge` repo gets a branch with a commit from a real run, and events reach the API.
- [ ] **M2-T3 Codex and OpenCode adapters** behind the same interface. *Done when:* the same contract test suite passes for all three adapters.
- [ ] **M2-T4 Run records and replay state.** Save `definition_sha`, inputs, repo SHAs, harness, model; `kiln replay`. *Done when:* replaying a run reproduces its starting workspace byte for byte.
- [ ] **M2-T5 Secrets broker + scoped tokens.** Short-lived forge tokens limited to `kiln/*` branches. *Done when:* a test proves the token cannot push to `main` or approve a PR.
- [ ] **M2-T6 Evidence package.** Playwright runner with video, test report parser, artifact upload. *Done when:* a sample web app run produces a video per acceptance criterion in object storage.

* [ ] **M2-T7 Decision layer.** `DecisionProvider` with Jev, LLM and fake implementations; `decisions/*.yaml` in the schema; command guardrail wired as a sandbox pre-exec hook. *Done when:* a destructive command fixture is blocked, a risky one creates an inbox question, and the LLM fallback takes over when the Jev client times out.

- [ ] **M2-T8 Pausable sandboxes.** Snapshot a sandbox's filesystem and process state to object storage, resume it on another node. *Done when:* a run paused at a gate resumes on a different node with the same workspace.

### M3 — Foreman, work items, integrations (weeks 7–9)

- [ ] **M3-T1 Work item state machine** in Temporal with all states, signals and the `stage_changed` event. *Done when:* property tests show no path to `complete` without merge or human confirmation.
- [ ] **M3-T2 Foreman workflow.** Foreman agent decides next stage via a structured tool (`dispatch(stage, agent, context)`); child runs per stage; revisions continue the same conversation. *Done when:* e2e test takes a FakeTracker issue to a draft PR.
- [ ] **M3-T3 Automations engine.** Triggers, filters (`in`, `not_in`), schedules, webhooks with token or signature auth and delivery dedupe. *Done when:* each provider's event fixtures route to the right agent.
- [ ] **M3-T4 GitHub integration** (issues, PRs, checks, comments, merge events). *Done when:* a labeled issue in a test repo produces a PR and a comment back.
- [ ] **M3-T5 Slack and Linear integrations.** `@alias` mentions, thread replies continue work, results posted back. *Done when:* e2e against Slack and Linear sandboxes passes.
- [ ] **M3-T6 Jira integration.** *Done when:* same e2e passes for Jira.
- [ ] **M3-T7 Dogfood switch-on.** Apply `factories/kiln-self`. *Done when:* one real Kiln issue becomes a merged PR built by Kiln.

* [ ] **M3-T8 Live steering.** Send a message to a running agent from the run page, Slack thread or MCP; the harness adapter injects it mid-run. *Done when:* a steering message changes the next action of a running Claude Code session in an e2e test.

### M4 — Gates, inbox, PO workspace (weeks 10–12)

- [ ] **M4-T1 Gates engine.** Approval, question, preview acceptance, custom rule gates; nudges and expiry via Temporal timers. *Done when:* each gate kind has a workflow test including timeout.
- [ ] **M4-T2 Optional pipeline graphs.** Compile `pipelines/*.yaml` into the workflow; `skip_if`, `fan_out`, `on_fail` loops with `max_loops`. *Done when:* the feature pipeline e2e runs with and without the spec stage.
- [ ] **M4-T3 Inbox** (web + Slack + MCP `list_inbox`, `decide_gate`). *Done when:* a PO approves a spec from Slack and from the web with the same result.
- [ ] **M4-T4 PO workspace.** Idea board, spec interview chat, spec diff review, preview gallery with videos. *Done when:* a pilot PO goes idea → accepted preview without engineer help in a usability test.
- [ ] **M4-T5 Preview environments** adapter (Vercel and Kubernetes namespace). *Done when:* every factory PR on the sample app gets a preview URL posted to its thread.

* [ ] **M4-T6 Home composer and navigation.** "New run" page with factory picker, attachments and a link to chatting with the foreman from connected apps; sidebar per the web app layout. *Done when:* a PO types a request on the home page, picks a factory, and a work item appears in Runs with the foreman's first reply.

### M5 — Measure and improve (weeks 13–15)

- [ ] **M5-T1 Scorer service.** Sampling, judge execution, label validation, scores table. *Done when:* scores appear for 25% of runs and match fixtures on a labeled set.
- [ ] **M5-T2 Self-improvement scheduler and improver agent** with replay-before-PR. *Done when:* seeded failures produce a PR with a "Regressions addressed" section and a replay table.
- [ ] **M5-T3 Benchmarks.** Suites, pinned tasks, up to six configurations, Pareto view of cost vs score. *Done when:* a suite runs three configurations and the dashboard shows the frontier.
- [ ] **M5-T4 Canary apply.** Route a share of new work items to a candidate definition. *Done when:* metrics split by definition SHA in the dashboard.
- [ ] **M5-T5 Dashboard.** PR activity, autonomy (human touches per PR), cycle time, cost, scores per agent. *Done when:* all metrics computed from runs and verified against fixtures.

* [ ] **M5-T6 Benchmarks from real work.** "Save as benchmark task" on any finished run (prompt, pinned commit, success criteria); benchmark results generate suggested routing rules (e.g. easy front-end tasks to a cheaper model) as a definition PR. Run suites only when models or skills change, because they are costly. *Done when:* a suite built from 10 past runs produces a Pareto chart and a router PR.
* [ ] **M5-T7 Metrics over API and MCP.** Raw run, cost, cycle-time and score data queryable by API and by Kiln MCP tools. *Done when:* an agent answers "cost per merged PR by agent last week" through MCP alone.

### M6 — Planning and portfolio (weeks 16–17)

- [ ] **M6-T1 Projects and portfolio.** *Done when:* the portfolio rolls up three factories' metrics.
- [ ] **M6-T2 Plan agent.** Goal or PRD → roadmap → tracker issues with acceptance criteria and target factory. *Done when:* a sample PRD produces a linked epic with at least 5 well-formed issues in Linear.
- [ ] **M6-T3 Weekly PO digest.** *Done when:* digest lists pending decisions with deep links.

* [ ] **M6-T4 Memories.** Per-factory learnings (conventions, past decisions) stored as files in the definition repo plus a pgvector index, written by agents or users, reviewed like skills. *Done when:* a convention taught in one run is applied in a later run.
* [ ] **M6-T5 Skills marketplace.** Org-wide catalog of skills with owners, versions and usage stats; install a skill into a factory by PR. *Done when:* a skill published from one factory is installed in another through the UI.

### M7 — Hardening, Kiln MCP, docs, release (weeks 18–20)

- [ ] **M7-T1 Kiln MCP with scoped tokens.** *Done when:* a `decide:preview` token cannot call `validate_factory_files` with write.
- [ ] **M7-T2 Kubernetes provider + Helm chart** with gVisor. *Done when:* the e2e suite passes on a kind cluster.
- [ ] **M7-T3 Security review.** Threat model, prompt-injection tests, audit log. *Done when:* no high findings open.
- [ ] **M7-T4 Docs site v1** per the documentation plan. *Done when:* every page in the v1 list is published and `llms.txt` is generated.
- [ ] **M7-T5 Release 1.0.** *Done when:* fresh install from docs reaches first PR in under 60 minutes for a new user.

## Claude Code setup for building Kiln

Claude Code builds Kiln under the same rules Kiln will enforce on others: a spec before code, tests before implementation, evidence before review, and a human merge.

**CLAUDE.md (repo root)**

```markdown
# Kiln — rules for Claude Code

## What this is
Kiln is a self-hostable software-factory platform. Plan: docs/plan/PLAN.md.
Decisions: docs/adr/. Never contradict an accepted ADR; propose a new ADR instead.

## How to work
1. Take exactly one task (ID like M2-T3) from PLAN.md. Read its acceptance criteria.
2. Write or update a short spec in docs/specs/<task-id>.md if the task touches
   more than one package. Stop and ask if requirements are unclear.
3. Write failing tests first. Then implement. Keep PRs under ~400 changed lines.
4. Run: pnpm typecheck && pnpm test && pnpm lint (and pnpm e2e if apps/ changed).
5. Update docs/site pages listed for the task. Tick the task box in PLAN.md.
6. Open a PR titled "<task-id>: <summary>" with test output and evidence.

## Architecture rules
- packages/* never import apps/*. Apps talk via API, Temporal, events.
- Every external system goes through an interface in packages/ with a Fake.
- Definitions live in Git; runtime state in Postgres. Never store both.
- No agent identity may hold merge or approve permission. Never add one.
- Temporal workflows are deterministic: no Date.now, random, or IO in workflows.

## Protected paths (ask before editing)
packages/definitions/validator*, apps/api/auth/**, policies/**, gate logic,
.github/workflows/**, factories/kiln-self/policies/**

## Style
TypeScript strict, zod at every boundary, named exports, no default exports
except Next.js pages. Errors are typed results, not thrown strings.
```

**Subagents (`.claude/agents/`)**

| Agent | Job | Tools |
| --- | --- | --- |
| `architect` | Writes task specs and ADRs; checks a plan against existing ADRs | Read, Write (docs only) |
| `test-writer` | Writes failing tests from acceptance criteria before implementation | Read, Write, Bash (tests) |
| `implementer` | Makes tests pass within one package boundary | All |
| `reviewer` | Reviews the diff against the task, ADRs and CLAUDE.md; blocks on missing tests | Read, Bash (read-only git) |
| `security-reviewer` | Checks auth, tokens, sandbox escape, prompt injection on touched code | Read |
| `docs-writer` | Updates `docs/site` pages for the task in Kiln's docs style | Read, Write (docs only) |

**Skills (`.claude/skills/`):** `kiln-definitions` (schema rules and fixtures), `temporal-workflows` (determinism, signals, testing), `adapter-contracts` (how to add a harness, sandbox or forge adapter with a fake and contract tests), `docs-style` (page templates and voice).

**Slash commands (`.claude/commands/`)**

| Command | Does |
| --- | --- |
| `/next-task` | Finds the first unchecked task in PLAN.md, prints its criteria, creates branch `task/<id>`, runs architect → test-writer → implementer → reviewer |
| `/verify` | Runs typecheck, tests, lint, e2e if needed; summarizes failures |
| `/adr <title>` | Drafts an ADR with context, decision, consequences |
| `/docs-page <path>` | Drafts or updates a docs page from the template |
| `/pr` | Writes the PR body with criteria checklist, test output and evidence links |

**Hooks (`.claude/settings.json`)**

- `PreToolUse` on Edit/Write: block edits to protected paths unless the prompt contains an explicit approval phrase.
- `PostToolUse` on Edit/Write: run Prettier and the package's typecheck on the changed file.
- `Stop`: run `pnpm test --filter <changed packages>` and print a short pass or fail summary.

**Session protocol.** One task per session and per branch. Start with `/next-task`, end with `/verify` and `/pr`. If a session runs long, write progress to `docs/specs/<task-id>.md` so the next session can resume. Use git worktrees to run two sessions on independent tasks in parallel; never two sessions on the same package.

**After M3-T7:** file new work as GitHub issues labeled `kiln-ready` instead of tasks in PLAN.md; the `kiln-self` factory picks them up, and engineers use Claude Code with the Kiln MCP to pull tasks local when they want to drive.

## Documentation plan

Kiln's docs follow Warp's structure and agent-friendly features, because Warp's docs are already shaped for the two readers that matter: people setting up a factory and coding agents operating one.

**What we copy from Warp's docs site.** It runs on Astro Starlight, publishes `llms.txt`, serves a Markdown version of every page, offers "copy page as Markdown" and "copy agent prompt" buttons, lets an agent onboard a user from one pasted prompt, links "Edit page" to GitHub, and shows a last-updated date ([example](https://docs.warp.dev/factories/factory-mcp/)). Kiln's site does all of these from day one.

**Site structure (v1)**

| Section | Pages | Milestone |
| --- | --- | --- |
| Overview | What is Kiln · How Kiln works (work-item lifecycle) · Quickstart (self-host to first PR) · Concepts glossary · Migrating from Warp Factories | M3, M7 |
| Factory configuration | Factory agents (roles, configuring, custom agents) · Skills · Automations · Pipelines and gates · Policies and budgets · Definitions as code (full reference generated from the schema) | M1, M4 |
| Infrastructure | Architecture and security · Runners · Sandboxes (Docker, Kubernetes) · Harnesses (Claude Code, Codex, OpenCode) · Model gateway · Self-hosting (compose, Helm, monitoring, troubleshooting) | M2, M7 |
| Code forges and integrations | GitHub · GitLab · Slack · Linear · Jira · Webhooks · Previews (Vercel, Kubernetes) | M3, M4 |
| Product owners | PO workspace tour · Writing testable acceptance criteria · Approving specs · Reviewing previews · Planning with the plan agent | M4, M6 |
| Measure and improve | Dashboard metrics · Scorers · Self-improvement · Benchmarks · Replay · Canary apply | M5 |
| Developer tools | API overview · API reference (generated from OpenAPI) · TypeScript SDK · CLI reference (generated) · Kiln MCP (setup prompt, tool reference, scopes) | M7 |
| Management | Inbox · Portfolio and projects · Admin, RBAC and audit | M4, M6 |
| Guides | Build an incident-response factory · Run a migration factory · Make a factory improve itself · Kiln builds Kiln (case study) | M7+ |
| Changelog, Troubleshooting | Generated from release notes; error catalog keyed by error code | M7 |

**Page template.** Every page opens with a one-sentence answer, then sections, then "Related pages". Reference pages are generated: definitions reference from `packages/schema`, CLI reference from the command definitions, API reference from OpenAPI, so they cannot drift from the code.

**Docs as code workflow**

- Docs live in `docs/site/` in the main repo; every task in the execution plan lists the pages it must update, and the `reviewer` subagent blocks PRs that skip them.
- CI builds the site, checks links, validates every YAML example against the schema, and fails on any example that does not validate.
- A `docs-drift` scorer in the `kiln-self` factory flags runs where agents misread a docs page, and self-improvement proposes docs fixes as PRs.
- Each page states its owner in frontmatter; the owner reviews changes to it.

## Risks, open decisions and sources

The biggest risk is building a platform when buying one would do; decide that before M2.

| Risk | Mitigation |
| --- | --- |
| Warp Factories (or a peer) already meets the need, making Kiln a costly duplicate | Run Warp Factories on one repo during M0–M1; continue only if the PO workspace, pipeline graphs, scoped MCP or self-hosting gaps matter to you. `kiln import --from-warp` keeps the exit open both ways |
| Self-improvement loop weakens its own guardrails | Protected paths, two-human approval on validator and policy code, `meta` scorer requiring replay evidence |
| Harness CLIs change flags or auth | Adapters behind contract tests; pin harness versions in runner images |
| Claude Code drifts from the plan over many sessions | One task per session, ADRs as hard constraints, reviewer subagent, acceptance criteria in CI |
| Cost of runs during development | LiteLLM budgets per environment, small models for scorers, benchmarks only on change |
| Prompt injection from tickets and Slack | Permissions only from policy, never from content; gated high-risk tools; tests in M7-T3 |
| PO-originated changes reach production | Flags off in prod, no merge rights, preview acceptance plus engineer review |

**Open decisions**

- [ ] Build Kiln, or adopt Warp Factories and build only the PO workspace and planning layer on its API and Factory MCP
- [ ] Product name (Kiln is a placeholder)
- [ ] Open source or internal only
- [ ] Tracker for the first factories: Linear or Jira
- [ ] Hosting: your Kubernetes cluster (EU region) or a single VM with Docker for v1
- [ ] Team: 2 or 3 engineers driving Claude Code

**Sources (Warp docs, read October 20, 2026)**

- [Warp Factories overview](https://docs.warp.dev/factories/)
- [How Warp Factories work](https://docs.warp.dev/factories/how-factories-work/)
- [Factory definition syntax (definitions as code)](https://docs.warp.dev/factories/factory-as-code/)
- [Configuring and reviewing Self-improvement](https://docs.warp.dev/factories/measure-and-improve/self-improvement/)
- [Factory MCP for coding agents](https://docs.warp.dev/factories/factory-mcp/)
- Earlier research in this conversation: Warp blog series, Builder.io factory skills, Stripe, Ramp, Uber, Spotify and Shopify case studies

* [The Register: TypeSafe AI debuts Jev](https://www.theregister.com/a/5296711) and [VKTR launch coverage](https://www.vktr.com/ai-platforms/chatgpt-cocreator-launches-typesafe-ai-with-jev/) (Jev pricing, latency, use cases)

- [The Factory Stack](https://www.warp.dev/blog/the-factory-stack) and [Introducing Factory Benchmarks](https://www.warp.dev/blog/warp-factory-benchmarks) (Warp blog)
