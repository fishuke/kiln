---
agent: foreman
triggers:
  - provider: webhook
    event: received
    filter: { webhook: pagerduty }
---
An alert fired. Triage it with the SRE agent, link the runbook, and post findings in the incident channel.
