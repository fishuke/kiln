---
triggers:
    - provider: github
      event: pull_request_merged
      filter:
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
    - provider: github
      event: pull_request_closed
      filter:
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
---
(Body shortened for the fixture.)
