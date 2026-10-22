# Kiln — rules for Claude Code

## What this is

Kiln is a self-hostable, open source software-factory platform. Docs: docs/site/ (start at index.md).
Decisions: docs/adr/. Never contradict an accepted ADR; propose a new ADR instead.
Ideas not yet scheduled: docs/ideas/.

## How to work

1. Take exactly one GitHub issue (labeled `kiln-ready` or assigned to you). Read its acceptance criteria.
2. Write or update a short spec in docs/specs/<issue-number>.md if the change touches
   more than one package. Stop and ask if requirements are unclear.
3. Write failing tests first. Then implement. Keep PRs under ~400 changed lines.
4. Run: pnpm typecheck && pnpm test && pnpm lint (and pnpm build if apps/web changed).
5. Update the docs/site pages the change affects; run `pnpm docs:gen` if the CLI, API, MCP or schemas changed.
6. Open a PR titled "#<issue>: <summary>" with test output and evidence.

## Architecture rules

- packages/* never import apps/*. Apps talk via the API and the event bus.
- Every external system goes through an interface in packages/ with a Fake.
- Definitions live in Git (or the store by content hash); runtime state lives in the Store. Never treat both as truth.
- No agent identity may hold merge or approve permission. Never add one. The only exception is
  a Studio App in cowboy ship mode: a template App on the repository Kiln created for it, or an
  imported App a person opted in; never a repository linked to a factory (ADR-012).
  Separately, Kiln's merge gate (not an agent) may merge when a person turned it on (ADR-014).
- Workflow steps persist the work item before and after they run; time comes from the injected Clock.

## Protected paths (ask before editing)

packages/definitions/src/validate*, apps/api/src/app.ts, packages/auth/**, policies/**,
packages/engine/src/gates.ts, packages/engine/src/state.ts, .github/workflows/**,
factories/kiln-self/policies/**

## Style

TypeScript strict, zod at every boundary, named exports, no default exports
except Next.js pages. Errors are typed results or Error subclasses with clear messages.
