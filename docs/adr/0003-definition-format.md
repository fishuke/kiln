# ADR-003: A definition format compatible with Warp Factories

Status: Accepted · Date: 2026-10-20

## Context
Teams may already have Warp factory definitions, and Warp's layout (factory.yaml, agents/<name>/agent.md, automations, runners, routers, scorers, benchmarks, skills, webhooks) is reviewed as code in a GitHub repo.

## Decision
Kiln reads the same layout under `schemaVersion: kiln/v1`, adds `pipelines/`, `gates/`, `policies/`, `decisions/` and `memories/`, and imports `v1alpha1` trees automatically (`kiln import --from-warp`, or connecting a Warp-exported config repo such as `fishuke/kiln-config`). A factory is either Kiln-managed or bound to a config repo; merges to its default branch are validated and applied as one unit.

## Consequences
- Unsupported Warp keys are dropped with warnings (environmentId, workerHost, macOS/Windows runners, Azure DevOps).
- Resource names may contain spaces, as in Warp exports.
- The definition SHA is a content hash of the tree, not a git commit.
