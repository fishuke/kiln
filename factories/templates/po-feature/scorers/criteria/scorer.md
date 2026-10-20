---
name: criteria
description: Does the pull request meet every acceptance criterion?
agents: [implement]
labels:
  - { value: meets, score: 1, description: Every criterion has a passing test or video }
  - { value: partly, score: 0.5, description: Some criteria are covered }
  - { value: misses, score: 0, description: A criterion has no evidence }
passingScore: 1
samplingRate: 25
model: claude-haiku-5-5
selfImprovement: true
---
Grade the run against the work item's acceptance criteria. Pass only when every criterion is covered.
