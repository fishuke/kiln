---
name: acceptance-criteria
description: Checks whether a pull request meets its task's acceptance criteria
output: classification
passingScore: 0.8
samplingRate: 25
model: auto
selfImprovement: true
agents:
  - implement
labels:
  - value: meets
    score: 1
  - value: partly
    score: 0.5
  - value: misses
    score: 0
---
Pass "meets" only if every acceptance criterion for the task has a passing test or evidence.
Use "partly" when some criteria are covered. Use "misses" when a criterion has no evidence.
