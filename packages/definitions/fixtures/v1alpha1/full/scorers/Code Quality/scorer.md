---
description: Is the code well designed?
output: classification
agents:
  - name: Web Implement
    includeDescendants: true
labels:
  - value: approve
    score: 1
  - value: reject
    score: 0
passingScore: 1
samplingRate: 25
model: judge-small
selfImprovement: true
---
Grade the code.
