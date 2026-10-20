---
agent: Local Builder
triggers:
  - provider: schedule
    event: cron_fired
    schedule:
      name: weekly
      cron: 0 8 * * 1
---
Audit dependencies.
