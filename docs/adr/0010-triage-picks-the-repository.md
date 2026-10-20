# ADR-010: Triage picks the repository in a multi-repository factory

Status: Accepted · Date: 2026-10-20

## Context
A factory lists one or more repositories, and every stage used the first one: runs cloned all of them and worked in the first, and pull requests, verification and hand-off went to the first. A team whose product spans several repositories (a web app, an API, an admin panel, translations) needed one factory per repository and a routing label on every issue. Atlas routed issues by label too. People should send an issue to the product, and the factory should work out where the change goes.

## Decision
- Repositories in `factory.yaml` take an optional `description`.
- In a factory with more than one repository, triage records the work item's repository (`repo`, `owner/name`). It uses the triage agent's `repo` when the triage agent ran and named one of the factory's repositories. Otherwise it asks a typed `repository` decision whose options are the factory's repositories, with their descriptions in the state. An answer under 0.6 keeps the first repository, and the foreman says so.
- Runs for that work item clone the picked repository (plus any `required_repos`) and work in it. Pull requests, verification and hand-off use it.
- A factory with one repository is unchanged and asks nothing.

## Consequences
- One factory can serve a product made of several repositories; labels are no longer needed for routing.
- A work item changes one repository. Work that spans repositories still needs `required_repos` or separate work items.
- A wrong pick is visible in the foreman's "Working in …" message.
