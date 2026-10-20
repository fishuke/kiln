# ADR-003: Definitions as code in the v1alpha1-compatible layout

Status: Accepted · Date: 2026-10-20

## Context
Factory definitions (factory.yaml, agents/<name>/agent.md, automations, runners, routers, scorers, benchmarks, skills, webhooks) are reviewed as code in a GitHub repo, and many teams already have trees in the v1alpha1 format.

## Decision
Kiln reads the same layout under `schemaVersion: kiln/v1`, adds `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/`, and imports `v1alpha1` trees automatically (`kiln import`, or connecting a config repo in that format). A factory is either Kiln-managed or bound to a config repo; merges to its default branch are validated and applied as one unit.

## Consequences
- Unsupported v1alpha1 keys are dropped with warnings (environmentId, workerHost, macOS/Windows runners, Azure DevOps).
- Resource names may contain spaces.
- The definition SHA is a content hash of the tree, not a git commit.
