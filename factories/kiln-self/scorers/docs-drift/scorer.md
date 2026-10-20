---
name: docs-drift
description: Did the agent misread or contradict a docs page?
agents: [implement, review]
labels:
  - { value: consistent, score: 1 }
  - { value: misread-docs, score: 0, description: The run acted on a docs statement that is wrong or outdated }
passingScore: 1
samplingRate: 25
model: claude-haiku-5-5
selfImprovement: true
---
Compare what the agent did with docs/site. Label misread-docs when a page led it astray; self-improvement then proposes a docs fix.
