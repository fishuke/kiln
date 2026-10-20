---
name: Procedure Compliance
description: Whether the agent complied with the standing rules delivered through system context and invoked and followed through on the skills its situation called for.
agents:
    - Kiln Review Agent
    - Kiln Foreman Agent
    - Kiln Implement Agent
    - Kiln Spec Agent
    - Kiln Triage Agent
labels:
    - value: fully_compliant
      description: The agent followed every applicable rule and followed through on every triggered skill.
      score: 1
    - value: mostly_compliant
      description: The agent followed all significant rules and skills, slipping only on something low-stakes.
      score: 0.8
    - value: noncompliant
      description: The agent missed an applicable rule, skipped a triggered skill, breached a protective rule, or skipped required validation while reporting work complete.
      score: 0.2
passingScore: 0.5
samplingRate: 10
model: gpt-5-6-luna-xhigh
selfImprovement: true
---
(Body shortened for the fixture.)
