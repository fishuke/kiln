# Kiln

**CI/CD for AI coding agents.** An open source, self-hosted alternative to Warp Factories. · [kiln.fishu.workers.dev](https://kiln.fishu.workers.dev)

<p align="center">
  <a href="https://kiln.fishu.workers.dev/assets/kiln-promo.mp4">
    <img src="website/assets/kiln-promo.gif" alt="Kiln in 36 seconds: work comes in from Slack, GitHub, Linear and schedules; agents spec, build and test it in a sandbox; they ask you when they need a decision; you review the evidence and merge" width="900">
  </a>
  <br>
  <sub><a href="https://kiln.fishu.workers.dev/assets/kiln-promo.mp4">Watch in HD</a> · <a href="https://kiln.fishu.workers.dev">Website</a></sub>
</p>

CI/CD made shipping code a pipeline: every change is built, tested and gated the same way. Kiln does the same for the work AI agents do. Issues, Slack threads and tracker tickets go in. Each one runs through a pipeline you define: triage, spec, build in a sandbox, tests, a preview, review. A reviewed pull request comes out. People approve the spec, accept the preview and merge. Scorers grade every run, and repeated failures turn into pull requests that improve the pipeline itself.

- **Bring your own key.** No Kiln-hosted model and no markup. Plug in what you already pay for:
  - **Claude:** a Claude subscription (`claude setup-token`) or an Anthropic API key
  - **Codex:** an OpenAI API key
  - **AWS Bedrock:** a Bedrock API key, or AWS access keys and a region, for Claude Code on Bedrock
  - **Others:** OpenCode and Pi with OpenRouter or Gemini keys
- **Self-hosted.** One process, a data folder and Docker to start; Docker Compose or Helm (gVisor sandboxes) for teams. Your code and keys stay on your infrastructure.
- **Pipelines as code.** A tree of `factory.yaml`, `agents/`, `automations/`, `pipelines/`, `scorers/`, `skills/` … stored in a GitHub repo you own and reviewed like any other change. Merges apply automatically.
- **People stay in charge.** Agents push only `kiln/*` branches with short-lived tokens and can never approve or merge.

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
