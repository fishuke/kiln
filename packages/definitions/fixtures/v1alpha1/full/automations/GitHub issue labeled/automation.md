---
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels: [factory:web-platform]
      repos: [acme/webapp]
---
Take the issue through the lifecycle.
