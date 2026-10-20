---
triggers:
    - provider: github
      event: pull_request_review_submitted
      filter:
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
---
(Body shortened for the fixture.)
