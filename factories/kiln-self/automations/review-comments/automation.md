---
triggers:
  - provider: github
    event: pull_request_review_submitted
    filter: { repos: [fishuke/kiln] }
---

Address the review comments on the pull request; continue the existing work.
