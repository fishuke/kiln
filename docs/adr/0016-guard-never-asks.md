# ADR-016: The command guard never asks a person

Status: Proposed · Date: 2026-11-10 · The host/sandbox split below (the **Host** case, and "what `ask_human` does depends on where") is superseded by [ADR-017](0017-sandboxes-only.md): there is no host path, so `ask_human` always runs. The rest stands.

## Context

The `command-guard` decision (ADR-006) rates every shell command an agent runs and answers `allow`, `ask_human` or `block`. On `ask_human` Kiln opened a `command-approval` question in the inbox and the run waited up to 9 minutes. People cannot judge a raw shell command out of context, so they approved blindly or let it expire. The question was noise, and every one of them stalled a run.

## Decision

The guard never asks a person. The decision keeps its three verdicts; what `ask_human` does depends on where the run's commands execute:

- **Isolated sandbox** (`docker`, `kubernetes`): the command runs. The sandbox, its egress rules and the run token's limits are what protect the host and the repositories.
- **Host** (the `local` backend, also when Kiln falls back to it because the runner's backend is unavailable, a `direct` worker, or an unknown backend): the command is blocked. The agent is told it was blocked because it runs on the host outside a sandbox, and to find another way inside its workspace.

`block` stays blocked everywhere. A Studio App in cowboy ship mode stays unguarded (ADR-012).

The run records a `guard` event for every blocked command and for every `ask_human` command that was let through, and the decision log keeps the verdict, so a reviewer can see afterwards what ran.

## Consequences

- No `command-approval` gate is opened any more. Stored ones still load and list; a restart still expires open ones.
- `askHumanTimeoutMs` and the approval wait are gone; `POST /api/v1/guard` answers at once with `allow` or `block` (and a `reason` for a host block).
- A factory that wants a command stopped in a sandbox must put it under `block` in its `command-guard` policy; `ask_human` no longer stops it there.
- ADR-008 is unchanged: this is about shell commands inside a run, not about merging or approving. Agents still never merge or approve.
- Studio's chat approval card (Allow / Block) no longer appears for new turns; removing its code is a follow-up.
