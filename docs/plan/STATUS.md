# Build status

Where each task from [PLAN.md](PLAN.md) stands. `/next-task` takes the first row that is not `done`.

| Task | Title | Status | Evidence |
| --- | --- | --- | --- |
| M0-T1 | Monorepo scaffold | done | pnpm workspace, strict TS, ESLint, Vitest; no Turborepo needed yet (ADR-001). `pnpm typecheck && pnpm test && pnpm lint` |
| M0-T2 | Local stack | partial | `pnpm dev` runs API + web locally; `docker-compose.yml` (api, web, egress proxy, optional LiteLLM) and `pnpm dev:up` / `pnpm health`. Postgres, Temporal, MinIO and NATS are replaced for v1 (ADR-002, ADR-005). Compose not run here: no Docker daemon on the build machine |
| M0-T3 | Claude Code setup | done | CLAUDE.md, `.claude/agents`, `.claude/commands` (/next-task reads this file), `.claude/skills`, hooks in `.claude/settings.json` (protected paths, format + typecheck, tests on stop) |
| M0-T4 | ADRs | done | docs/adr/0001–0008 |
| M1-T1 | JSON Schemas + zod types | done | packages/schema, 51 fixtures, unknown keys rejected |
| M1-T2 | Parser and resolver | done | packages/definitions resolve.ts; snapshot + inheritance + null clearing tests |
| M1-T3 | Validator | done | validate.ts; each rule has a failing case with an exact `file:line` message |
| M1-T4 | kiln validate and kiln diff | done | packages/cli; tests in main.test.ts |
| M1-T5 | Atomic apply | done | e2e/runtime.test.ts "M1-T5"; API apply keeps the last valid SHA |
| M1-T6 | Warp import | done | Warp's 8 public examples and the fishuke/kiln-config export convert and validate (warp.test.ts) |
| M2-T1 | SandboxProvider + Docker provider | done | Local, Docker and Kubernetes providers; local start < 15 s asserted; Docker tested against a fake docker CLI (no daemon here) |
| M2-T2 | HarnessAdapter + Claude Code adapter | done | Contract tests with a CLI emulator; branch with a commit from a run reaches the fake forge (e2e). Real `claude` runs need KILN_AGENTS=real and a key/subscription token |
| M2-T3 | Codex and OpenCode adapters | done | Same contract suite passes for all three |
| M2-T4 | Run records and replay | done | Replay reproduces the starting workspace hash (e2e/runtime.test.ts) |
| M2-T5 | Secrets broker + scoped tokens | done | Run tokens cannot push main, approve or merge (e2e/runtime.test.ts); BYOK credentials (ADR-007) |
| M2-T6 | Evidence package | done | Video per acceptance criterion in object storage, from a Playwright report fixture (packages/evidence). Real Playwright runs in the runner image |
| M2-T7 | Decision layer | done | Jev/LLM/fake providers, decisions/*.yaml, command guard as pre-exec hook; block, ask-human and fallback tests |
| M2-T8 | Pausable sandboxes | done | Pause on node A, resume on node B with the same workspace (e2e/runtime.test.ts). Process state via CRIU checkpoint is optional on Docker |
| M3-T1 | Work item state machine | done | Property test: no path to complete without merge or human confirmation; stage_changed on every transition |
| M3-T2 | Foreman workflow | done | FakeTracker issue to a draft PR; revisions loop on the same work item |
| M3-T3 | Automations engine | done | Provider fixtures route to the right agent; filters in/not_in; schedules; signed webhooks; dedupe |
| M3-T4 | GitHub integration | partial | GitHubForge (REST) tested with a fake fetch; full flow on the git-backed fake forge. Not yet run against a real test repo |
| M3-T5 | Slack and Linear integrations | partial | Adapters, signatures and normalizers tested; mention → thread replies → results posted back on fakes. Not yet run against Slack/Linear sandboxes |
| M3-T6 | Jira integration | partial | Adapter and normalizer tested with fakes; not run against a Jira sandbox |
| M3-T7 | Dogfood switch-on | pending | factories/kiln-self validates; applying it needs GITHUB_TOKEN and a reachable server, then label a Kiln issue `kiln-ready` |
| M3-T8 | Live steering | done | Steering changes the next action (API, MCP, Slack thread) |
| M4-T1 | Gates engine | done | Approval, question, preview, merge, custom gates with nudges and expiry (FakeClock tests) |
| M4-T2 | Optional pipeline graphs | done | Feature pipeline with and without spec; skip_if, fan_out, on_fail with max_loops |
| M4-T3 | Inbox | done | Same result from Slack and web; MCP list_inbox/decide_gate; web inbox |
| M4-T4 | PO workspace | partial | Idea board, spec review, preview gallery and conversation in the web app. The pilot-PO usability test has not happened |
| M4-T5 | Preview environments | done | Fake, Vercel and Kubernetes namespace providers; preview URL posted on the PR |
| M4-T6 | Home composer and navigation | done | "New run" composer with factory picker; Warp-style sidebar |
| M5-T1 | Scorer service | done | ~25% sampling and labels match a labeled set |
| M5-T2 | Self-improvement + improver | done | PR with Regressions addressed and a replay table; protected paths dropped; two approvals; canary on merge |
| M5-T3 | Benchmarks | done | Three configurations, Pareto frontier (API + chart) |
| M5-T4 | Canary apply | done | Metrics split by definition SHA |
| M5-T5 | Dashboard | done | Metrics verified against fixtures; web dashboard |
| M5-T6 | Benchmarks from real work | done | Ten past runs saved as tasks; Pareto + router PR |
| M5-T7 | Metrics over API and MCP | done | "Cost per merged PR by agent last week" answered through MCP alone |
| M6-T1 | Projects and portfolio | done | Portfolio rolls up three factories |
| M6-T2 | Plan agent | done | Sample PRD → epic with 5+ issues in the tracker |
| M6-T3 | Weekly PO digest | done | Pending decisions with deep links |
| M6-T4 | Memories | done | A convention taught in one run is applied in a later run |
| M6-T5 | Skills marketplace | done | Publish from one factory, install in another (API and web) |
| M7-T1 | Kiln MCP with scoped tokens | done | A decide:preview token cannot write definitions through MCP |
| M7-T2 | Kubernetes provider + Helm chart | partial | Provider (gVisor, NetworkPolicy) and deploy/helm/kiln written; the e2e suite on a kind cluster has not run (no kind/Docker here) |
| M7-T3 | Security review | done | docs/security/threat-model.md; prompt-injection tests (e2e/security.test.ts); audit log |
| M7-T4 | Docs site v1 | done | docs/site (Markdown, generated CLI/API/MCP/definition references, llms.txt) served at /docs in the web app; Astro Starlight not used |
| M7-T5 | Release 1.0 | pending | Needs a fresh install from the docs with real accounts, timed to first PR |

49 tasks: 41 done, 6 partial, 2 pending.
