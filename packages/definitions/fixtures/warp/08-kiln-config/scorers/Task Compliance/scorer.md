---
name: Task Compliance
description: Whether the agent fulfilled the mandate of its assigned factory role and did what the user or its orchestrating agent asked.
agents:
    - Kiln Review Agent
    - Kiln Foreman Agent
    - Kiln Implement Agent
    - Kiln Spec Agent
    - Kiln Triage Agent
labels:
    - value: fully_compliant
      description: The agent did everything its role and directives required, and surfaced any deviation.
      score: 1
    - value: mostly_compliant
      description: The agent delivered a usable result and met all significant directives, with only minor gaps.
      score: 0.8
    - value: noncompliant
      description: The agent left meaningful work undone, missed or half-did a directive, violated an explicit constraint, ignored a correction, or misreported its work.
      score: 0.2
    - value: insufficient_evidence
      description: The task description is unclear or incomplete, making it impossible to judge compliance.
      score: 0.5
passingScore: 0.5
samplingRate: 10
model: gpt-5-6-luna-xhigh
selfImprovement: true
---
(Body shortened for the fixture.)
