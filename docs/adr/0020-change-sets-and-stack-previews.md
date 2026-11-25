# ADR-020: Change sets across repositories, proved on a stack preview

Status: Proposed · Date: 2026-11-25

## Context

A product like Saba is five repositories: a NestJS API (`saba-backend`), three Next.js frontends (customer `saba-app-frontend`, manager/seller `saba-manager-app-frontend`, super admin `saba-super-frontend`) and translations (`saba-localization`). Most features touch the API and at least one frontend.

ADR-010 lets triage pick **one** repository per work item; ADR-012 makes a Studio App **one** Git repository. So a cross-service feature today is either several work items that never see each other, or one run that pushes extra branches (`required_repos`) with no pull request, preview or evidence for them. A frontend preview calls the live or staging API, so it can't show a feature whose backend isn't merged yet, and nothing proves the services work together before merge.

Atlas (the Cyrus fork) routes one issue to several repositories and opens cross-linked PRs, but it boots no stack, pairs no previews and runs no cross-service check; its preview pairing is an unbuilt plan. This is new ground, not a port.

## Decision

**A work item, or a Studio App, can change a set of repositories.** The unit of delivery is a **change set**: the same branch in each changed repository, one pull request per repository, linked to each other and reviewed, gated and merged together.

**The product's topology lives in Git as a stack.** A `stack.yaml` (in the factory tree, and referenced by the Kiln Project so its Apps share it) names each **service**: its repository, how it installs, migrates, seeds and starts, its port, its health check, the services it depends on and the environment it needs, which can reference other services (`NEXT_PUBLIC_API_URL: ${services.api.url}`). Datastores (Postgres, Redis, Elasticsearch) are services too. Repositories in a factory with no stack behave as today.

**Triage picks several repositories.** ADR-010's single pick becomes a multi-pick when the factory has a stack: the triage agent names `repos[]`, otherwise a typed `repositories` decision does. A factory without a stack keeps ADR-010 exactly.

**One stack preview per change set, in one sandbox.** The whole stack runs as processes in a single sandbox (ADR-017 stays: no Docker socket, no compose). Changed services run the change set's branch; unchanged services run their base branch, so a backend-only change still has every frontend to click through. Every service with a port is exposed through `Sandbox.expose`, so each frontend gets its own URL and each frontend is wired to *this* stack's API. Datastores start from a seed declared in the stack, never from shared staging data. A Kubernetes provider may later run the same stack as one namespace; the contract is the same.

**Proof is part of the gate.** Before a change set is ready for review, Kiln runs on the stack preview: each service's own checks, the migrations, the stack's contract check (for Saba: frontend GraphQL operations validated against the branch's schema) and the end-to-end flows, which record a video per acceptance criterion per surface. A flow may cross services (a seller creates a product, a customer sees it), and its video shows each surface in turn. These become new `requires` entries: `stack_healthy`, `contracts_pass`, `criteria_videos` per service.

**One review, merged in order or not at all.** Reviewers see the change set: every pull request, every preview URL, the evidence. The merge gate (ADR-014) judges the change set as a whole. Merging follows the stack's dependency order (translations and API before the frontends) and stops at the first failure; Kiln reports what was merged. No agent gains merge or approve permission (ADR-008).

## Consequences

- `WorkItem.repo`/`pr`/`previewUrl` become `repos[]`, `prs[]` and `previews[]` (a work item with one repository is a change set of one). Every `repoOf` caller in the workflow is touched; the work item completes when all its pull requests are merged.
- `PreviewProvider` gains a stack deploy that returns one URL per service; the PR preview card and gate evidence list them all.
- Studio Apps get `sources[]`: one worktree per repository per chat, one dev server per service, and a service switcher (and side-by-side view) in the preview pane. This is Studio Phase 7 in `docs/ideas/studio.md`.
- The stack sandbox is large (an API, three Next.js dev servers, Postgres, Redis, Elasticsearch). Runner shapes and the runner image must hold it; a slim mode can skip services the flows don't need.
- Seed data becomes something a product maintains. Without it, previews are empty and flows can't be recorded.
- ADR-010 and ADR-012 are not edited. They still describe a factory or App without a stack.

Plan: `docs/specs/change-sets-and-stack-previews.md`.
