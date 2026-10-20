---
triggers:
  - provider: github
    event: issue_labeled
    filter: { labels: [kiln-ready] }
  - provider: linear
    event: agent_session_created
---
Take this issue through the factory's standard lifecycle.
