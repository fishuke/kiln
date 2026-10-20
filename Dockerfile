# Kiln control plane: API, MCP, orchestrator loop and scorer in one process.
FROM node:22-bookworm-slim AS base
ARG DOCKER_CLI_VERSION=27.5.1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tar curl && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://download.docker.com/linux/static/stable/$(uname -m)/docker-${DOCKER_CLI_VERSION}.tgz" | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
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
COPY deploy/docker-entrypoint.sh /usr/local/bin/kiln-entrypoint
# Starts as root only to join the Docker socket's group, then runs as node.
ENTRYPOINT ["kiln-entrypoint"]
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
