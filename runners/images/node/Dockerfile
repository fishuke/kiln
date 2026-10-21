# Sandbox base image: Node 22, pnpm, git, Playwright browsers, the three harness CLIs and the
# browser MCP server for computer use (with the Chromium build it expects), and the SigNoz MCP server.
# Pin CLI versions here so adapter contract tests and real runs agree.
FROM mcr.microsoft.com/playwright:v1.56.0-noble
ARG CLAUDE_CODE_VERSION=2.1.290
ARG CODEX_VERSION=0.163.0
ARG OPENCODE_VERSION=0.15.0
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
# SigNoz MCP server for the SigNoz template's self-hosted option (stdio, configured by SIGNOZ_URL and SIGNOZ_API_KEY).
ARG SIGNOZ_MCP_VERSION=0.15.0
ARG SIGNOZ_MCP_SHA256_AMD64=9b0ac2e11a84f71b35590bf128ebad607286649a7e23e0bd6bcb9c6f9a3457ce
ARG SIGNOZ_MCP_SHA256_ARM64=fd31faf102993f471e02c43e52bc69a956490c5beadfc5bb0b87710edbb1e5e4
# The base image's Node 22.20 is older than corepack 0.36 supports (^22.22.2) and its fetch cannot use
# HTTPS_PROXY (NODE_USE_ENV_PROXY), so corepack could not download pnpm through the egress proxy.
ARG NODE_VERSION=22.23.3
ARG NODE_SHA256_AMD64=1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af
ARG NODE_SHA256_ARM64=5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2
# Node 22 bundles corepack 0.34, which cannot run pnpm 11+ (native binaries, no bin/pnpm.cjs).
ARG COREPACK_VERSION=0.36.0
# Node, checksum-verified, in /usr/local (ahead of the base image's /usr/bin/node on PATH).
RUN arch="$(dpkg --print-architecture)" && narch="$([ "$arch" = arm64 ] && echo arm64 || echo x64)" \
  && sum="$([ "$arch" = arm64 ] && echo "$NODE_SHA256_ARM64" || echo "$NODE_SHA256_AMD64")" \
  && curl -fsSL -o /tmp/node.tar.gz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${narch}.tar.gz" \
  && echo "$sum  /tmp/node.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md \
  && rm /tmp/node.tar.gz && hash -r && node -v
RUN arch="$(dpkg --print-architecture)" \
  && sum="$([ "$arch" = arm64 ] && echo "$SIGNOZ_MCP_SHA256_ARM64" || echo "$SIGNOZ_MCP_SHA256_AMD64")" \
  && curl -fsSL -o /tmp/signoz-mcp.tgz "https://github.com/SigNoz/signoz-mcp-server/releases/download/v${SIGNOZ_MCP_VERSION}/signoz-mcp-server_linux_${arch}.tar.gz" \
  && echo "$sum  /tmp/signoz-mcp.tgz" | sha256sum -c - \
  && tar -xzf /tmp/signoz-mcp.tgz -C /tmp && install -m 0755 "/tmp/signoz-mcp-server_linux_${arch}/bin/signoz-mcp-server" /usr/local/bin/ \
  && rm -rf /tmp/signoz-mcp*
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable \
  && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} opencode-ai@${OPENCODE_VERSION} @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
  && cd "$(npm root -g)/@playwright/mcp" && npx --no-install playwright install chromium \
  && useradd -m -u 1000 agent || true
# Repositories pin their package manager (packageManager); fetch it without asking.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
USER 1000
WORKDIR /workspace
