---
name: Verbosity
description: Whether the agent's written, text output was proportionate to the work.
agents:
    - Kiln Review Agent
    - Kiln Foreman Agent
    - Kiln Implement Agent
    - Kiln Spec Agent
    - Kiln Triage Agent
labels:
    - value: proportionate
      description: 'The agent''s output matched the work: most messages consistently said what happened and what comes next, no point was repeated or restated, and nothing the recipient needed was omitted.'
      score: 1
    - value: verbose
      description: 'The agent padded its output repeatedly: preamble restating the request, narration of what it was about to do, summaries re-describing a visible diff or an earlier summary, filler in place of plain statements, or a PR description whose length or template sections outstrip the diff it describes. The signal to noise ratio is poor.'
      score: 0.2
    - value: terse
      description: 'The agent under-communicated: it went silent through long stretches of work, finished without saying what changed or needs review, or dropped information the recipient needed to act.'
      score: 0.1
passingScore: 0.5
samplingRate: 10
model: gpt-5-6-luna-xhigh
selfImprovement: true
---
(Body shortened for the fixture.)
