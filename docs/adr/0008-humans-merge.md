# ADR-008: Agents never merge

Status: Accepted · Date: 2026-10-20

## Context
Kiln's core rule: no agent identity holds merge or approve permission, and a work item completes only on a merge event or human confirmation.

## Decision
Runs get short-lived signed tokens that allow pushing `kiln/*` branches, opening PRs and commenting, never approving or merging. Kiln checks the token before pushing; branch protection (or the fake forge's pre-receive hook) rejects the rest. The state machine refuses `complete` without a merge record or a person's confirmation; chat replies decide a gate only when their author is an assignee.

## Consequences
- Property tests cover the completion invariant.
- Self-improvement and kiln-self changes to protected paths are dropped or need two people.
