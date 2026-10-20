---
title: Self-improvement
description: How Kiln turns repeated scorer failures into a proposed definition change, proves it by replay, and ships it only after human review.
owner: docs
section: Measure and improve
---

Self-improvement turns an agent's repeated failures into a proposed change to the factory's definition, replays the failing runs to show whether the change helps, and opens it for a person to review.

## Turn it on

1. Add a scorer with `selfImprovement: true` for the agents you want to improve. See [Scorers](scorers.md).
2. Optionally tune `selfImprovement` in `factory.yaml`:

```yaml
selfImprovement:
  failedRunThreshold: 25   # 1–50, default 25
  maxAgeDays: 7            # 1–90, default 7
  reviewers: { type: team }
```

`reviewers` is validated (`custom` needs at least one email) but does not assign reviewers to proposals yet. Use your config repo's code owners for that.

3. Protect what the loop must not touch with a [policy](../configuration/policies-and-budgets.md).

## When it runs

A scheduled check looks at each agent's unreviewed failed scores from scorers with `selfImprovement: true`. It starts a proposal for an agent when either:

- the failures cover at least `failedRunThreshold` distinct runs, or
- the oldest failure is at least `maxAgeDays` days old.

**Run now** skips the wait and starts a proposal for every agent with at least one failure.

## How a proposal is made

1. **Cluster.** The `failure-category` decision tags each failed run as `instructions`, `skills`, `tooling`, `model`, `app_code` or `flaky`. Kiln takes the largest group.
2. **Propose.** The improver reads that group and the reviewers' earlier rejections for this agent, and proposes file changes. By default it adds a "Lessons from reviewed failures" section to the agent's instructions and never repeats a lesson a reviewer rejected. It can also be the factory's `improver` agent, which edits a copy of the definition tree in its sandbox.
3. **Guard.** Kiln drops changes to `policies/`, `gates/` and any `protectedPaths`, and lists what it dropped. If nothing is left, or the changed tree does not validate, there is no proposal.
4. **Replay.** Kiln replays up to 30 of the failing runs twice from their saved start state: once under the applied definition and once under the proposed one. Each replay is scored, and a replay passes when all its scores pass.
5. **Open.** The proposal body has the rationale, a "Regressions addressed" list linking each failed run and its score, a "Replay" table with pass or fail before and after and the two pass rates, and the list of changed files. Kiln never opens a proposal without the replay report.

The failures in the proposal are marked reviewed, so they do not trigger another proposal.

## Reviewing a proposal

For a factory with a [config repo](../configuration/definitions-as-code.md#config-repos-on-github), Kiln commits the change to a `kiln/self-improve-<agent>-<id>` branch and opens a pull request titled "Self-improvement: <agent> (<category>)", labeled `kiln:self-improvement`. Merging it ships the change as a [canary](replay-and-canary.md): when the pushed tree is exactly the proposal's candidate, the push sync applies it to 10% of new work items (the server's default share) and marks the proposal merged. If the branch was edited before the merge, the tree no longer matches and the push applies it to all new work items, like any other change.

In Kiln, you can approve or reject any proposal:

- **Approve.** Kiln applies the proposed tree as a 10% [canary](replay-and-canary.md). If the change touches a `twoApprovalPaths` path, two different people must approve first. Agents cannot approve.
- **Reject**, with a reason. Rejected proposals are kept as negative examples for the improver.

Nothing is adopted without a person's review.

## Improving Kiln's own factory

The same loop runs on the factory that builds Kiln. See [Kiln builds Kiln](../guides/kiln-builds-kiln.md).

## Related pages

- [Scorers](scorers.md)
- [Replay and canary](replay-and-canary.md)
- [Policies and budgets](../configuration/policies-and-budgets.md)
- [Make a factory improve itself](../guides/make-a-factory-improve-itself.md)
