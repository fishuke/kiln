# Studio runner image: the sandbox image (Node, pnpm, git, the harness CLIs) plus Studio's Next.js
# template at /opt/kiln/templates/nextjs with node_modules installed and a warm pnpm store, so a new
# Studio App is a copy and a chat worktree's `pnpm install --prefer-offline` needs no network.
# Build it from the repository root, with the template as the context:
#   docker build -t kiln-runner-studio:local -f runners/images/studio/Dockerfile templates/nextjs
# Dockerfile.dockerignore next to this file keeps a local node_modules and .next out of the context.
ARG BASE=kiln-runner-node:local
FROM ${BASE}
# The store and corepack's pnpm live outside $HOME, so a sandbox that runs with another HOME
# (Kubernetes, a different user) still finds them.
ENV npm_config_store_dir=/opt/kiln/pnpm-store \
  COREPACK_HOME=/opt/kiln/corepack \
  NEXT_TELEMETRY_DISABLED=1
USER root
RUN mkdir -p /opt/kiln/templates/nextjs /opt/kiln/pnpm-store /opt/kiln/corepack && chown -R 1000:1000 /opt/kiln
USER 1000
WORKDIR /opt/kiln/templates/nextjs
COPY --chown=1000:1000 . .
# Install from the lockfile, then type-check so a broken template fails the build, not an App.
RUN pnpm install --frozen-lockfile && pnpm typecheck && rm -f tsconfig.tsbuildinfo
WORKDIR /workspace
