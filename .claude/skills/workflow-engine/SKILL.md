---
name: workflow-engine
description: How the work-item workflow, gates and timers work and how to test them. Use when editing packages/engine/src/workflow.ts, gates.ts, state.ts or automations.ts.
---
- States and transitions: packages/engine/src/state.ts. `complete` needs a merge or human completion record.
- `Workflow.advance` serializes per item; each step saves the item. Steps return continue, wait or done.
- Gates are opened by stages and decided through `GateService.decide` from any surface.
- Time-based behavior (nudges, expiry, schedules) runs in `Kiln.tick()`; use `FakeClock` in tests.
- Use `createTestKiln` and `waitFor` from @kiln/engine; fake agents live in fake-agents.ts.
