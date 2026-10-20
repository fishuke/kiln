---
triggers:
    - provider: github
      event: issue_mentioned
      filter:
        labels:
            - factory:kiln
        mentioned:
            - warp
            - warp-factory
        repos:
            - fishuke/social-xp
    - provider: github
      event: pull_request_mentioned
      filter:
        labels:
            - factory:kiln
        mentioned:
            - warp
            - warp-factory
        repos:
            - fishuke/social-xp
    - provider: github
      event: issue_assigned
      filter:
        assignees:
            - warp
            - warp-factory
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
    - provider: github
      event: pull_request_assigned
      filter:
        assignees:
            - warp
            - warp-factory
        labels:
            - factory:kiln
        repos:
            - fishuke/social-xp
---
(Body shortened for the fixture.)
