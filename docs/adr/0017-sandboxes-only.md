# ADR-017: Agents run in sandboxes only

Status: Proposed · Date: 2026-11-10 · Supersedes the host/sandbox split of [ADR-016](0016-guard-never-asks.md)

## Context

Kiln could run an agent on the host in four ways: a runner with `backend: local`, a server started without `KILN_SANDBOX` (the default was `local`), a silent fall back to the host when the runner's backend was not available on the server, and a `kiln worker --backend direct`. On the host nothing limits the agent: it has the server's files, environment, network and logins.

That second path cost twice. Every sandbox feature had a host variant to keep working (setup commands skipped on fall back, no egress rules, no limits). And the command guard needed a rule per place: ADR-016 lets an `ask_human` command run in a sandbox and blocks it on the host.

## Decision

Every agent run is in an isolated sandbox: a Docker container (the default) or a Kubernetes pod. There is no host backend.

- `local` is not a backend: not in a runner file, not as `KILN_SANDBOX`, not as a team's default sandbox host. `direct` is not a `kiln worker` backend.
- The default backend is `docker`.
- Kiln never falls back to the host and never moves a run to another backend. When Docker (or the cluster) is not available, starting a run fails with an error that says what is missing: "Kiln needs Docker running to start a sandbox: ...".
- The in-process sandbox stays as the Fake for tests (`FakeSandboxProvider` from `@kiln/sandbox/testing`). No runner definition, server setting or worker option can select it.

The command guard follows from this. Inside a sandbox the agent may run anything the sandbox allows, so there is one rule everywhere:

| Verdict | Result |
| --- | --- |
| `allow` | runs |
| `ask_human` | runs, recorded as a `guard` event on the run |
| `block` | blocked, recorded |

`ask_human` stays in the `command-guard` policy as the "risky, logged" tier, because factories can override decision policies. A factory that wants a command stopped puts it under `block`. A Studio App in cowboy ship mode stays unguarded (ADR-012).

## Consequences

- Running agents needs Docker or Kubernetes, also for local development and for the scripted demo agents. Tests do not: they use the Fake.
- A definition stored earlier with `backend: local` still loads, and its runs and work items still list. Applying one is rejected. A run on such a runner fails with a message that says to change the backend.
- A sandbox gets only what Kiln passes to it. Credentials, tools and files that an agent used to find on the host (a cloud login, a build tool's settings, an installed CLI) must come from team secrets, the runner image or its setup commands.
- A runner that names a backend the server does not have now fails instead of running on the host. This includes a runner with `backend: docker` (the schema default) on a Kubernetes-only server.
- `--one-shot` workers were direct only; they now use Docker or Kubernetes like every other worker.
- ADR-008 is unchanged: this is about where shell commands run, not about merging or approving. Agents still never merge or approve.
- ADR-016 otherwise stands: the guard never asks a person.
