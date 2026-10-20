---
triggers:
    - provider: github
      event: pull_request_labeled
      filter:
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
---
(Body shortened for the fixture.)
