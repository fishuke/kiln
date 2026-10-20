# ADR-002: Orchestration: a durable in-process workflow before Temporal

Status: Accepted (supersedes the Temporal choice in PLAN.md for v1) · Date: 2026-10-20

## Context
PLAN.md picks Temporal for durable workflows, signals and timers. Kiln v1 targets one organization on one node, and requiring a Temporal cluster makes the first install much heavier.

## Decision
Work items are driven by `packages/engine/src/workflow.ts`: each step persists the item before and after it runs, a per-item lock serializes advances, gates are signals (`GateService.decide`), and nudges, expiry, schedules and CI waits run from `Kiln.tick()` on a clock that tests replace. Every external effect is behind an interface, so a Temporal implementation can replace the loop without changing stages or gates.

## Consequences
- A restart resumes from the last saved stage; a run in flight at the moment of the crash is re-run (runs are idempotent on their branch).
- No history-based replay of workflows; run-level replay (`kiln replay`) covers debugging.
- Multi-node scale-out needs the Temporal adapter (tracked as follow-up).
