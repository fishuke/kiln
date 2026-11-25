---
title: Stacks and change sets
description: Describe how a product of several repositories runs with stack.yaml, so one work item changes several repositories and every frontend previews against this branch's API.
owner: docs
section: Factory configuration
---

A product often spans several repositories: an API, a few frontends, translations. A **stack** describes how they run together. With a stack, a work item changes a *set* of repositories: one branch, one linked pull request per repository, reviewed and merged together (ADR-020).

## stack.yaml

Put `stack.yaml` next to `factory.yaml`. Every repository a service names must be in `factory.yaml` too.

```yaml
name: shop
runner: { image: kiln-runner-stack:local }
services:
  postgres: { kind: datastore, start: postgres-start, port: 5432, seed: ./seed.sh }
  api:
    repo: acme/api
    install: pnpm install --frozen-lockfile
    migrate: pnpm migrate
    start: pnpm dev
    port: 3000
    health: /health
    depends_on: [postgres]
    env: { DATABASE_URL: "postgres://kiln@localhost:5432/shop" }
  web:
    repo: acme/web
    surface: Customer site
    start: pnpm dev -p 4000
    port: 4000
    depends_on: [api]
    env: { NEXT_PUBLIC_API_URL: "${services.api.url}" }
    env_public: [NEXT_PUBLIC_API_URL]
    egress: [fonts.googleapis.com]
merge_order: [api, web]
```

- **Services** start in `depends_on` order. Each waits for its `health` check (an HTTP path, or a command that exits 0) before what depends on it starts.
- **`${services.<name>.url}`** is `http://localhost:<port>` for the server side. For names listed in `env_public` (read in the browser) it is that service's preview URL.
- **Datastores** (`kind: datastore`) have no repository. The stack runner image ships Postgres (`postgres-start`) and Redis. A `seed` runs once the datastore answers; previews never read shared staging data.
- **Libraries** (`kind: library`) are linked into other services instead of started.
- **`egress`** lists the hosts a service may reach. Everything else is blocked.

## What changes in the workflow

- **Triage picks the repositories** a change needs: the triage agent's `repos`, else one yes/no decision per repository. When that is unclear, a person picks them.
- **Runs clone every repository** of the stack, changed ones first, and work from the workspace root.
- **Every changed repository gets one pull request.** Each lists the others under `## Change set`. CI must pass on all of them. The work item is done once every pull request is merged; a pull request closed without merging flags it for a person.

A factory without `stack.yaml` behaves as before. `change_sets: true` in `factory.yaml` turns on change sets without a stack.

## Stack previews

```bash
kiln stack up shop --branch kiln/featured --changed acme/api
```

This boots the whole stack in one sandbox and prints one URL per service. Changed repositories run the branch, the others their base. Every frontend talks to this stack's API. The URLs are `https://st-<id>-<service>.<preview domain>` (`KILN_STUDIO_PREVIEW_DOMAIN`).

- `kiln stack ls <factory>` lists the factory's stack previews.
- `kiln stack logs <stack> <service>` shows a service's last output lines.
- `kiln stack down <stack>` stops one.

A stack preview of a work item is removed when the work item completes or is cancelled. A full stack (an API, three Next.js dev servers, Postgres, Redis and a browser) needs 8–12 GB of memory.
