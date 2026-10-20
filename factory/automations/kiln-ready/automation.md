---
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: [fishuke/klin]
      labels: [kiln-ready]
---
A labeled issue is a new work item. Triage it, then ask for spec approval.
