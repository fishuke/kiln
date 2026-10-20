# ADR-009: Claude Code through the Claude Agent SDK

Status: Accepted · Date: 2026-10-20 · Amends [ADR-004](./0004-harness-adapters.md)

## Context

The `claude-code` adapter spawned `claude -p --output-format stream-json` and parsed its output itself. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) speaks the same CLI's control protocol and gives typed messages, streaming input, in-process hooks and tool-permission callbacks (including answering Claude's `AskUserQuestion`). Atlas, the Cyrus-based agent Kiln replaces for Linear work, runs Claude this way. Runs must still execute inside Kiln's sandboxes, with the egress allowlist and on remote workers.

## Decision

The `claude-code` adapter calls the SDK's `query()` with the prompt and steering messages as streaming input. The SDK runs in the harness process; its `spawnClaudeCodeProcess` option starts the `claude` binary inside the run's sandbox through `Sandbox.spawn`, so ADR-004's "adapters spawn the CLI inside the sandbox" still holds. The process gets only the run's environment (the SDK otherwise starts from the host's). Only JSON lines reach the SDK; other output is kept to say why a process could not start.

The SDK version is pinned to the release paired with the runner image's Claude Code version (SDK 0.3.N with CLI 2.1.N). Its bundled per-platform binaries are excluded with `ignoredOptionalDependencies`, since the CLI comes from the runner image.

## Consequences

- Bumping Claude Code means bumping the SDK to the paired release in the same change.
- The MCP config (with the run token) and the command guard settings stay in `.kiln/` files passed as flags, never as command-line JSON.
- In-process hooks and permission callbacks are now available for later work, such as asking Linear users Claude's questions (#3).
- Codex, OpenCode, Gemini and Pi keep their CLI adapters.
