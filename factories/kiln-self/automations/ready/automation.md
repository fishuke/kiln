---
triggers:
  - provider: github
    event: issue_labeled
    filter: { labels: [kiln-ready], repos: [fishuke/kiln] }
---
Take this Kiln issue through the feature pipeline. Follow CLAUDE.md: one task, tests first, keep PRs under ~400 lines, update docs/site pages for the task.
