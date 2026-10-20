---
title: Scorers
description: Grade a sample of each agent's runs against a rubric with labeled outcomes, a passing score and a sampling rate, and feed failures into self-improvement.
owner: docs
section: Measure and improve
---

A scorer is a rubric in `scorers/<name>/scorer.md` that grades a share of an agent's finished runs with one of a fixed set of labels.

## A scorer file

```markdown
---
name: acceptance-criteria
description: Checks whether the change meets its acceptance criteria
agents: [implement]
labels:
  - { value: meets, score: 1, description: Every criterion has a passing test }
  - { value: partly, score: 0.5 }
  - { value: misses, score: 0 }
passingScore: 0.8
samplingRate: 25
model: claude-haiku-5-5
selfImprovement: true
---
Pass "meets" only if every acceptance criterion has a passing test or evidence.
Use "partly" when some criteria are covered. Use "misses" when a criterion has no evidence.
```

| Key | Default | Notes |
| --- | --- | --- |
| `name` | required | The scorer's name on scores. |
| `description` | none | |
| `agents` | required | Agents whose runs it grades. Each must exist. |
| `labels` | required | 1 to 20 labels, each with a unique `value`, a `score` from 0 to 1 and an optional `description`. |
| `passingScore` | required | 0 to 1. A label passes when its score is at least this. |
| `samplingRate` | 25 | Percent of runs to grade, 0 to 100. |
| `model` | required | The model for an LLM judge. The default typed-decision judge does not use it. |
| `selfImprovement` | `false` | When true, failed scores feed [self-improvement](self-improvement.md). |

The body is the rubric the judge reads.

## Which runs are scored

When a work run finishes, Kiln scores it with every scorer that lists its agent.

- Sampling is by a stable hash of the run ID and the scorer name, so the same run is always in or out of the sample for that scorer. About `samplingRate` percent of runs are scored.
- Replays and benchmark runs ignore sampling: when Kiln scores them, every scorer for the agent grades them.
- The server can be set to score every run, ignoring `samplingRate`.
- A run is scored at most once per scorer.

## How a run is judged

The judge gets the rubric, the run's summary, its result file, the last part of its event transcript and the agent's name, and picks one label.

By default the judge is a [typed decision](../configuration/decisions.md): the labels become the options of one choice question, so judging is cheap enough to score many more runs. When the top label's probability is below 0.7 and an LLM judge is configured, the run goes to the LLM judge instead.

A label that is not in the scorer's list is not recorded; Kiln writes an `invalid_label` entry to the audit log.

## Scores

Each score records the run, factory, agent, scorer, label, numeric score, pass or fail, the judge's rationale, which judge decided, and the definition SHA the run used. Scores from work runs of a scorer with `selfImprovement: true` count toward self-improvement until a proposal marks them reviewed.

Use scores in:

- [Dashboard metrics](metrics.md): pass rate per agent and per definition,
- [Self-improvement](self-improvement.md): unreviewed failures trigger a proposal,
- [Replay and canary](replay-and-canary.md): pass rates before and after a change.

## Related pages

- [Self-improvement](self-improvement.md)
- [Dashboard metrics](metrics.md)
- [Benchmarks](benchmarks.md)
- [Typed decisions](../configuration/decisions.md)
