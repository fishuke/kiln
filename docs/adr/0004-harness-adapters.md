# ADR-004: Harness adapters, not our own agent loop

Status: Accepted · Date: 2026-10-20

## Context
PLAN.md rules out writing an agent loop. Claude Code, Codex and OpenCode each run headless with JSON event streams.

## Decision
`packages/harness` defines one `HarnessAdapter` interface with a contract test suite run against all three adapters and a `FakeHarness`. Adapters spawn the CLI inside the sandbox, stream normalized events, support steering (stdin for Claude Code; resume for Codex and OpenCode) and read `.kiln/result.json`. Credentials are bring-your-own: a Claude subscription token from `claude setup-token`, or provider API keys, read from Kiln secrets.

## Consequences
- CLI flags can change; adapters pin behavior in contract tests and runner images pin CLI versions.
- The command guard hooks into Claude Code (PreToolUse). Codex and OpenCode commands are only covered by the sandbox's egress and resource limits until they offer equivalent hooks.
