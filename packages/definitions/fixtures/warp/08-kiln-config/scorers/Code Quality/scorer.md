---
name: Code Quality
description: Whether the code, tests, and comments the agent produced are well-designed and consistent with the target repo's conventions.
agents:
    - Kiln Implement Agent
labels:
    - value: approve
      description: The agent produced well-designed, correct code that is consistent with repo conventions, adequately tested, and clean of smells; a senior reviewer would approve it outright, with at most trivial nits.
      score: 1
    - value: block
      description: 'The agent produced code with at least one defect a reviewer would insist on fixing before merge: a correctness or concurrency bug, a missed edge case, an inconsistent pattern, weak or missing tests, or mixed-in artifacts that do not belong.'
      score: 0.2
    - value: insufficient_evidence
      description: The transcript shows no code diff, or too little of one to judge.
      score: 0.5
passingScore: 0.5
samplingRate: 10
model: gpt-5-6-luna-xhigh
selfImprovement: true
---
(Body shortened for the fixture.)
