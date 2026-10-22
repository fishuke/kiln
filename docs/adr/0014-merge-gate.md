# ADR-014: A merge gate decides which pull requests need a person

Status: Proposed · Date: 2026-10-22

## Context

ADR-008 says agents never merge, and today every factory pull request waits for a person. With Studio (ADR-012), customers and other non-developers open many small pull requests, and most of them don't need a developer's review. Making every one wait turns the developer into a bottleneck. Kiln already has typed decisions (ADR-006) that answer questions like this quickly and log every answer.

## Decision

**When it runs.** Only when a pull request is ready for review: for a Studio App, after the author has tested it and marked it **Ready for review**. An open pull request alone never triggers it.

**What it answers.** A built-in `merge-safety` decision judges whether the pull request is safe to merge without a person, from what it can see: the diff, the parts of the app it touches, CI and test results, the preview, review findings and who wrote it.

- **Safe:** Kiln merges it.
- **Not safe:** it goes to a person; it appears in the Inbox of the App's or factory's reviewers, with the decision's reasons.

The author sees the outcome in Studio: merged, or waiting for review.

**Who merges.** Kiln's merge gate merges, acting on a setting a person turned on. Agent run tokens still can't merge or approve; ADR-008 is unchanged for agents. The setting lives in the App's or factory's policies, which only people edit; self-improvement can't change it.

**Per App or factory.** The gate is off by default, so everything goes to a person until someone turns it on. A team can tune the decision like any other (ADR-006), and an App may link post-deploy monitoring, but the gate doesn't require it.

## Consequences

- `packages/decide` gains the `merge-safety` built-in decision; the forge interface needs a merge call used only by the merge gate.
- The Inbox shows only the pull requests the gate didn't merge.
- Every automatic merge is in the audit log with the decision's inputs and answer, so a bad merge can be traced and the decision tuned.
- ADR-008 and CLAUDE.md gain one line: the merge gate, not an agent, may merge when a person turned it on.
