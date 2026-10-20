---
description: Implements and validates changes
agentType: IMPLEMENT
harness:
  type: claude
  model: frontier-high
  auth:
    source: managedSecret
    secretName: TEAM_ANTHROPIC
required_repos:
  - owner: acme
    name: webapp
---
Implement.
