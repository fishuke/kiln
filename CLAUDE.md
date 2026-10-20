# Kiln — rules for Claude Code

## What this is
Kiln is a self-hostable software-factory platform. Plan: docs/plan/PLAN.md.
Decisions: docs/adr/. Never contradict an accepted ADR; propose a new ADR instead.

## How to work
1. Take exactly one task (ID like M2-T3) from PLAN.md. Read its acceptance criteria.
2. Write or update a short spec in docs/specs/<task-id>.md if the task touches
   more than one package. Stop and ask if requirements are unclear.
3. Write failing tests first. Then implement. Keep PRs under ~400 changed lines.
4. Run: pnpm typecheck && pnpm test && pnpm lint (and pnpm e2e if apps/ changed).
5. Update docs/site pages listed for the task. Tick the task box in PLAN.md.
6. Open a PR titled "<task-id>: <summary>" with test output and evidence.

## Architecture rules
- packages/* never import apps/*. Apps talk via API, Temporal, events.
- Every external system goes through an interface in packages/ with a Fake.
- Definitions live in Git; runtime state in Postgres. Never store both.
- No agent identity may hold merge or approve permission. Never add one.
- Temporal workflows are deterministic: no Date.now, random, or IO in workflows.

## Protected paths (ask before editing)
packages/definitions/validator*, apps/api/auth/**, policies/**, gate logic,
.github/workflows/**, factories/kiln-self/policies/**

## Style
TypeScript strict, zod at every boundary, named exports, no default exports
except Next.js pages. Errors are typed results, not thrown strings.
