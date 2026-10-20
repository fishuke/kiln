---
name: meta
description: Every self-improvement PR carries a replay report
agents: [improver]
labels:
  - { value: has-replay, score: 1 }
  - { value: no-replay, score: 0 }
passingScore: 1
samplingRate: 100
model: claude-haiku-5-5
---
Pass only if the pull request body has a "## Replay" section with a before/after table of replayed runs.
