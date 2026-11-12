# Kiln

**The open source software factory.** AI agents plan, write, review and verify your code. A self-hosted alternative to Warp Factories. · [kiln.fishu.workers.dev](https://kiln.fishu.workers.dev)

<p align="center">
  <a href="https://kiln.fishu.workers.dev/assets/kiln-promo.mp4">
    <img src="website/assets/kiln-promo.gif" alt="Kiln in 36 seconds: work comes in from Slack, GitHub, Linear and schedules; agents spec, build and test it in a sandbox; they ask you when they need a decision; you review the evidence and merge" width="900">
  </a>
  <br>
  <sub><a href="https://kiln.fishu.workers.dev/assets/kiln-promo.mp4">Watch in HD</a> · <a href="https://kiln.fishu.workers.dev">Website</a></sub>
</p>

CI/CD is the assembly line that builds, tests and ships code people wrote. A software factory extends that line to the whole development lifecycle: AI agents plan the change, write it, review it and prove it works, and your CI/CD still runs on every pull request. Issues, Slack threads, tracker tickets and schedules go in. Each one runs through a pipeline you define: triage, spec, build in a sandbox, tests, a preview, review. A reviewed pull request comes out. People approve the spec, accept the preview and merge. Scorers grade every run, and repeated failures turn into pull requests that improve the factory itself.

- **Bring your own key.** No Kiln-hosted model and no markup. Plug in what you already pay for:
  - **Claude:** a Claude subscription (`claude setup-token`) or an Anthropic API key
  - **Codex:** an OpenAI API key
  - **AWS Bedrock:** a Bedrock API key, or AWS access keys and a region, for Claude Code on Bedrock
  - **Others:** OpenCode and Pi with OpenRouter or Gemini keys
- **Self-hosted.** One process, a data folder and Docker to start; Docker Compose or Helm (gVisor sandboxes) for teams. Your code and keys stay on your infrastructure.
- **Pipelines as code.** A tree of `factory.yaml`, `agents/`, `automations/`, `pipelines/`, `scorers/`, `skills/` … stored in a GitHub repo you own and reviewed like any other change. Merges apply automatically.
- **People stay in charge.** Agents push only `kiln/*` branches with short-lived tokens and can never approve or merge.

## Build your factory with your favorite AI

```bash
kiln architect
```

Then ask your coding agent to build it: `/kiln-architect` in Claude Code, or "Follow .kiln/architect.md" in Codex, Cursor, Copilot, Gemini CLI or anything else. The agent profiles your repo (`kiln scan`), reads your merged pull requests, and with your OK your tracker and Slack. It writes a factory that fits how your team already works, backtests it on your last merged PRs (`kiln bench from-prs`), and explains every choice with its evidence in `FACTORY.md`. Nothing is applied until you say yes. [Guide](docs/site/guides/factory-architect.md)

## Quickstart

```bash
pnpm install
pnpm dev                 # API on :4000 (with demo data), web app on :3000
```

Open http://localhost:3000. Docker must be running: every agent run starts in a Docker sandbox, and `pnpm dev` starts the sandbox egress proxy for you (`docker compose up -d --build egress-proxy`). Out of the box everything else is local: a git-backed forge, an in-process tracker and chat, and scripted agents, so you can see the whole lifecycle without accounts. To use real models, set `KILN_AGENTS=real` and one of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. See [Self-hosting](docs/site/infrastructure/self-hosting.md) for Docker Compose, Helm and connecting GitHub, Slack, Linear and Jira.

```bash
pnpm kiln init my-factory --template sdlc    # or single-repo, po-feature, incident
pnpm kiln validate my-factory
pnpm kiln apply my-factory                   # with KILN_URL and KILN_TOKEN set
pnpm kiln send "Fix the typo in the README" --factory <alias>
```

## How it works

<p align="center">
  <a href="https://kiln.fishu.workers.dev/assets/kiln-factory.mp4">
    <img src="website/assets/kiln-factory.gif" alt="A Kiln factory floor running pipelines/feature.yaml: work items ride a conveyor through triage, spec, build, verify, preview, review and merge; a person approves the spec and preview gates; the build fans out per user story; a failed verify loops back to build; a small fix skips the spec on a bypass lane; a person merges" width="900">
  </a>
  <br>
  <sub>Your pipeline is a file. Here it is, running. <a href="https://kiln.fishu.workers.dev/assets/kiln-factory.mp4">Watch in HD</a></sub>
</p>

A work item moves through `triaging → planning → awaiting_spec → building → awaiting_preview → reviewing → handed_off → complete`. The foreman picks the shortest path (small, clear changes skip the spec), or a pipeline file fixes the graph. Each run happens in a sandbox; every shell command passes a guardrail; evidence (tests, a video per acceptance criterion, a preview URL) is attached to the PR. Scorers grade runs, and self-improvement turns repeated failures into definition PRs that are replayed against the failing runs before a person reviews them.

Read more in the [docs](docs/site/index.md), also served at `/docs` in the web app. Design decisions are in [docs/adr](docs/adr/README.md).

## Repository

```text
apps/api        REST API, webhooks, MCP endpoint, timers (Hono)
apps/mcp        Kiln MCP server (streamable HTTP, scoped tokens)
apps/web        Web app (Next.js + shadcn/ui)
packages/       schema, definitions, decide, sandbox, harness, evidence,
                integrations, auth, store, events, engine, sdk-ts, cli
factories/      starter factory templates
docs/           docs site, ADRs, threat model, ideas, screenshots
deploy/         Helm chart and the sandbox egress proxy
e2e/            end-to-end tests on a git-backed fake forge
```

## Development

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
pnpm docs:gen      # regenerate CLI/API/MCP/definition reference pages
```

Contributions follow [CLAUDE.md](CLAUDE.md): one task per branch, tests first, a person merges. MIT licensed.
