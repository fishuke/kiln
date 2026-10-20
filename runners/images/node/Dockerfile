# Sandbox base image: Node 22, pnpm, git, Playwright browsers, the three harness CLIs and the
# browser MCP server for computer use (with the Chromium build it expects).
# Pin CLI versions here so adapter contract tests and real runs agree.
FROM mcr.microsoft.com/playwright:v1.56.0-noble
ARG CLAUDE_CODE_VERSION=2.1.0
ARG CODEX_VERSION=0.45.0
ARG OPENCODE_VERSION=0.15.0
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
RUN corepack enable \
  && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} opencode-ai@${OPENCODE_VERSION} @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
  && cd "$(npm root -g)/@playwright/mcp" && npx --no-install playwright install chromium \
  && useradd -m -u 1000 agent || true
USER 1000
WORKDIR /workspace
