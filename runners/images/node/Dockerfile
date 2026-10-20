# Sandbox base image: Node 22, pnpm, git, Playwright browsers, the three harness CLIs and the
# browser MCP server for computer use (with the Chromium build it expects).
# Pin CLI versions here so adapter contract tests and real runs agree.
FROM mcr.microsoft.com/playwright:v1.56.0-noble
ARG CLAUDE_CODE_VERSION=2.1.290
ARG CODEX_VERSION=0.163.0
ARG OPENCODE_VERSION=0.15.0
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
ARG SIGNOZ_MCP_VERSION=0.15.0
ARG SIGNOZ_MCP_SHA256_AMD64=9b0ac2e11a84f71b35590bf128ebad607286649a7e23e0bd6bcb9c6f9a3457ce
ARG SIGNOZ_MCP_SHA256_ARM64=fd31faf102993f471e02c43e52bc69a956490c5beadfc5bb0b87710edbb1e5e4
# SigNoz MCP server (traces, logs, metrics, alerts), checksum-verified.
RUN arch="$(dpkg --print-architecture)" \
  && sum="$([ "$arch" = arm64 ] && echo "$SIGNOZ_MCP_SHA256_ARM64" || echo "$SIGNOZ_MCP_SHA256_AMD64")" \
  && curl -fsSL -o /tmp/signoz-mcp.tgz "https://github.com/SigNoz/signoz-mcp-server/releases/download/v${SIGNOZ_MCP_VERSION}/signoz-mcp-server_linux_${arch}.tar.gz" \
  && echo "$sum  /tmp/signoz-mcp.tgz" | sha256sum -c - \
  && tar -xzf /tmp/signoz-mcp.tgz -C /tmp && install -m 0755 "/tmp/signoz-mcp-server_linux_${arch}/bin/signoz-mcp-server" /usr/local/bin/ \
  && rm -rf /tmp/signoz-mcp*
RUN corepack enable \
  && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} opencode-ai@${OPENCODE_VERSION} @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
  && cd "$(npm root -g)/@playwright/mcp" && npx --no-install playwright install chromium \
  && useradd -m -u 1000 agent || true
USER 1000
WORKDIR /workspace
