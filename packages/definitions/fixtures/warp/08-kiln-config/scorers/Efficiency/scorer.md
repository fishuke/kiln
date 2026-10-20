---
name: Efficiency
description: Whether the agent worked directly toward its result, or wasted effort on redundant steps, avoidable rework, or unnecessary back-and-forth.
agents:
    - Kiln Review Agent
    - Kiln Foreman Agent
    - Kiln Implement Agent
    - Kiln Spec Agent
    - Kiln Triage Agent
labels:
    - value: highly_efficient
      description: 'The agent took a direct path: nothing re-read or re-run, independent steps batched, no work redone.'
      score: 1
    - value: mostly_efficient
      description: 'The agent slipped once or twice: a duplicated read, an early retry, or a small correction — with no knock-on cost.'
      score: 0.8
    - value: mostly_inefficient
      description: The agent wasted effort repeatedly, or caused a round of rework an earlier check would have prevented.
      score: 0.4
    - value: highly_inefficient
      description: 'The agent''s waste dominated the run: the same defect reworked across cycles, repeated user correction, or extended flailing / looping.'
      score: 0.2
passingScore: 0.5
samplingRate: 10
model: gpt-5-6-luna-xhigh
selfImprovement: true
---
(Body shortened for the fixture.)
