# ADR-001: TypeScript monorepo

Status: Accepted · Date: 2026-10-20

## Context
Kiln has a control plane, a web app, a CLI, an MCP server and adapters for three harness CLIs. Claude Code works best when one language and one toolchain cover the whole repo, and the Claude Agent SDK and OpenCode SDK are TypeScript.

## Decision
One pnpm workspace in TypeScript (strict, Node 22). Packages under `packages/` are consumed as TypeScript source (tsx for Node, `transpilePackages` for Next.js), so there is no build step between packages. Root scripts run `tsc`, Vitest and ESLint; Turborepo is not needed at this size.

## Consequences
- `pnpm typecheck && pnpm test && pnpm lint` checks everything.
- `packages/*` never import `apps/*`; apps talk through the API and the event bus.
- Revisit Turborepo when builds get slow.
