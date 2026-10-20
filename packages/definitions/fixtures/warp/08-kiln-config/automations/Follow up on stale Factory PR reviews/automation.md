---
triggers:
    - provider: schedule
      event: cron_fired
      schedule:
        name: stale-factory-pr-reviews-1
        cron: 0 8 * * 1
---
(Body shortened for the fixture.)
