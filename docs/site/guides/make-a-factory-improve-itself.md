---
title: Make a factory improve itself
description: Set up scorers, thresholds and guard rails so a factory turns its own repeated failures into reviewed, replay-tested definition changes.
owner: docs
section: Guides
---

This guide sets up the full improvement loop for a factory: scorers flag failures, Kiln proposes a definition change, replays prove it, a person reviews it, and a canary confirms it.

## Before you start

- The factory's definition lives in a [config repo](../configuration/definitions-as-code.md#config-repos-on-github), so proposals arrive as pull requests.
- The factory has done some real work, so there are runs to score.

## 1. Decide what "good" means

Write a scorer for the agent you want to improve. Make the labels concrete, and describe each one so the judge and your reviewers read them the same way.

```markdown
---
name: criteria
description: Does the change meet every acceptance criterion?
agents: [implement]
labels:
  - { value: meets, score: 1, description: Every criterion has a passing test }
  - { value: partly, score: 0.5, description: Some criteria have no test }
  - { value: misses, score: 0, description: The change does not do what was asked }
passingScore: 1
samplingRate: 25
model: claude-haiku-5-5
selfImprovement: true
---
Compare the acceptance criteria with the tests the run added or changed.
```

Save it as `scorers/criteria/scorer.md`. With `passingScore: 1`, only `meets` passes. See [Scorers](../measure-and-improve/scorers.md).

## 2. Set the thresholds

```yaml
# factory.yaml
selfImprovement:
  failedRunThreshold: 10
  maxAgeDays: 7
```

The check starts a proposal for an agent once its unreviewed failures cover 10 distinct runs, or the oldest is 7 days old. The default threshold is 25. A lower number gives you proposals sooner, with less evidence in each.

## 3. Put up guard rails

```yaml
# policies/guard.yaml
description: Self-improvement may tune agents, not the rules that check them
protectedPaths: [policies/**, gates/**, decisions/**, scorers/**]
twoApprovalPaths: [agents/review/**]
```

- Changes to `protectedPaths` are dropped from proposals. Kiln always drops `policies/` and `gates/`.
- Changes to `twoApprovalPaths` need two different people to approve.
- Protecting `scorers/**` stops the factory from making its own grading easier.

See [Policies and budgets](../configuration/policies-and-budgets.md).

## 4. Validate and merge

Open a pull request in the config repo with the three changes. The [validation workflow](../configuration/definitions-as-code.md#validate-pull-requests-with-github-actions) runs `kiln validate`. Merge it; the push applies the definition.

## 5. Let failures build up

Work as usual. About a quarter of the `implement` runs get a score. Check the agent's pass rate on the [dashboard](../measure-and-improve/metrics.md).

To try the loop without waiting, use **Run now** for the factory's self-improvement. It starts a proposal for every agent with at least one unreviewed failure.

## 6. Review the proposal

Kiln opens a pull request titled "Self-improvement: implement (instructions)" or similar. Read it in this order:

1. **Regressions addressed.** Each failed run, with its score and the judge's rationale. Do the failures look real?
2. **Replay.** The pass rate before and after, and a pass or fail per replayed run. A proposal that does not improve the after rate is a warning sign.
3. **Changes.** The changed files. By default, a "Lessons from reviewed failures" section in the agent's instructions.
4. **Dropped changes.** Any changes to protected paths that Kiln removed.

Then either:

- **Merge it.** If you merge it unchanged, the push applies it as a 10% canary and marks the proposal merged. If you edited the branch first, the push applies it to all new work items.
- **Approve it in Kiln instead.** Kiln applies it as a 10% canary without merging. This needs `definitions:write` on the factory. The pull request stays open; merging it later applies the change to everyone.
- **Reject it, with a reason.** The improver will not repeat a rejected lesson.

## 7. Watch the canary

Compare the candidate with the applied definition in the per-definition metrics. After 7 days, Kiln promotes the candidate if its pass rate is within 2 points of the applied one, and rolls it back otherwise. You can promote or roll back sooner. See [Replay and canary](../measure-and-improve/replay-and-canary.md).

## 8. Keep the loop honest

- Read a sample of passing runs now and then, to catch a judge that is too lenient.
- When a scorer's labels change, expect a wave of new failures. Raise `failedRunThreshold` for a while if needed.
- Benchmark before and after big changes to models or skills. See [Benchmarks](../measure-and-improve/benchmarks.md).

## Related pages

- [Self-improvement](../measure-and-improve/self-improvement.md)
- [Scorers](../measure-and-improve/scorers.md)
- [Replay and canary](../measure-and-improve/replay-and-canary.md)
- [Kiln builds Kiln](kiln-builds-kiln.md)
