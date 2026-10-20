# ADR-007: Open source, bring your own keys, self-hosted

Status: Accepted · Date: 2026-10-20

## Context
Kiln is for the open-source community. People should run it on their own machines and pay for models with their own keys or subscriptions.

## Decision
MIT license. Everything runs locally without accounts (git-backed forge, in-process tracker and chat, scripted agents); each integration turns on with its credentials. Harness credentials come from Kiln secrets: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. Agents receive only the secrets their definition lists; the server's own environment is not readable by name.

## Consequences
- No hosted multi-tenant service in v1.
- Users must follow their model providers' terms for automated use.
