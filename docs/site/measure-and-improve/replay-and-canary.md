---
title: Replay and canary
description: Re-run a past run from its saved start state under another definition, and roll out a definition change to a share of new work items before everyone gets it.
owner: docs
section: Measure and improve
---

Replay re-runs a past agent run from exactly where it started, optionally under a different definition, and canary apply sends only a share of new work items to a candidate definition so you can compare it with the current one.

## What a run saves

Every run records:

- the definition SHA it ran under,
- the agent, harness and model,
- the prompt and the full instructions the agent received,
- the skills it received,
- for each repository, the branch and the exact commit it started at,
- for local sandboxes, a hash of the starting workspace.

This is the run's start state.

## Replay

`kiln replay <run> --with <sha>` starts a new run of the same agent with the same prompt, checked out at the same commits. Without `--with`, it uses the run's own definition SHA. See the [CLI reference](../developer-tools/cli.md).

- The replay is a run of kind `replay` that links back to the original.
- It does not push anything.
- A replay of a local-sandbox run starts from a workspace with the same hash as the original.

Use replay to:

- check whether a definition change fixes a failure, before you apply it,
- reproduce a bad run while you debug,
- compare two definitions on the same inputs.

[Self-improvement](self-improvement.md) uses replay to prove every proposal: it replays up to 30 failing runs under the applied and the proposed definition and reports both pass rates.

## Canary apply

`kiln apply --canary 10%` applies a valid tree as a candidate for 10% of new work items. The rest keep the applied definition.

- Each work item is assigned once, when it is created, by a stable hash of its ID. It keeps that definition for its whole life.
- A canary needs an applied definition to compare against, and a share below 100%. Otherwise the tree is applied normally.
- Applying another canary replaces the current one.

### Watching a canary

[Dashboard metrics](metrics.md) split work items, pass rate and cost by definition SHA. Compare the candidate's row with the applied one.

### Promote or roll back

You can promote the candidate to 100%, or roll it back, at any time.

Kiln also decides on its own after 7 days:

| Candidate's pass rate | Result |
| --- | --- |
| At least the applied definition's pass rate minus 2 points | Promoted. It becomes the applied definition. |
| Lower | Rolled back. New work items go back to the applied definition. |
| No scores yet | Rolled back. |

If the applied definition has no scores, a candidate with scores is promoted.

Approving a self-improvement proposal in Kiln starts a 10% canary in the same way.

## Related pages

- [Self-improvement](self-improvement.md)
- [Dashboard metrics](metrics.md)
- [Definitions as code](../configuration/definitions-as-code.md#canary-apply)
- [Scorers](scorers.md)
