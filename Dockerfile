# Kiln control plane: API, MCP, orchestrator loop and scorer in one process.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tar && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/mcp ./apps/mcp
COPY apps/web/package.json ./apps/web/package.json
COPY factories ./factories
RUN pnpm install --frozen-lockfile --filter '!@kiln/web'
ENV NODE_ENV=production KILN_DATA_DIR=/data PORT=4000
VOLUME ["/data"]
EXPOSE 4000
USER node
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
