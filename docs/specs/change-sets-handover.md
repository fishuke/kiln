# Change sets and stack previews: handover

Read [change-sets-and-stack-previews.md](change-sets-and-stack-previews.md) first (the plan), then [ADR-020](../adr/0020-change-sets-and-stack-previews.md), ADR-010, ADR-012, ADR-014, ADR-017 and `CLAUDE.md`.

Repository: `fishuke/kiln`. On 2026-11-25 only the docs were written. They sit uncommitted in the working tree of `studio-context`, next to that branch's own uncommitted Studio Context work. **Nothing is built.**

## Start here

1. Commit the two docs (and the index line in `docs/adr/README.md`) on a fresh branch from `main`, for example `change-sets`. Don't mix them with the uncommitted `studio-context` changes.
2. Answer the open questions in §10 of the plan from the Saba repos (see "Saba facts to collect" below). Phases 2–4 depend on them; Phase 1 does not.
3. ADR-020 is **proposed**. Accept it, or change it, before Phase 2. Phase 1 only extends ADR-010, so it can start now.
4. Build the phases in order. Each phase below lists the files, the tests and the "done when".

Standing instructions from the Studio Context handover (commit identity, pushing to `main`, deploys to anton's Coolify) were given for that work. Confirm they apply here before following them.

## What the code looks like today (2026-11-25)

All paths are relative to the repo root.

- **Work item.** `packages/engine/src/types.ts:106-115`:
  - `repo: string`, `pr: {repo, number, …}`, `previewUrl: string`.
  - `Project` is at `:348` (`{id, name, owner, factories[], roadmapId?, team?}`).
- **Triage.** In `packages/engine/src/workflow.ts`:
  - `triage()` (~948) takes the agent's `repo`.
  - `chooseRepo()` (~1003) falls back to the `repository` decision (`repositoryDecision`, ~1501), with a 0.6 threshold.
  - `repoOf()` (~1020).
  - Around 44 lines in `workflow.ts` touch `repoOf(` / `wi.pr` / `previewUrl`; grep for all three.
- **Runs.** In `packages/engine/src/runs.ts`:
  - Clones the picked repo, `required_repos` and the env repos (~553-565).
  - `cwd = repos[0]` (~868).
  - `pushBranches` (~1352) already pushes the same branch `kiln/<id>-<slug>` to every changed repo.
  - `collectArtifacts` (~1247).
- **PRs.** `ensurePullRequest` (~1148) opens one PR. `prBody`/`evidenceLines` (~1105-1140). Verify (~1201). Preview stage (~1243). Hand-off (~1300-1320). Merge and review events (~1396, ~1467).
- **Previews.**
  - `packages/integrations/src/chat.ts:98-205` has `PreviewDeploy`, `PreviewProvider`, `FakePreview`, `VercelPreview` and `KubernetesPreview`.
  - `apps/api/src/config.ts:135` wires only Vercel or the fake. Nothing calls `destroy`.
- **Evidence.** `packages/evidence/src/index.ts`:
  - `collectPlaywrightEvidence` (96-138) reads only `playwright-report/results.json` in the cwd.
  - `EvidencePackage` (82-90). `previewCard` (147).
- **Merge gate.** `packages/engine/src/merge-gate.ts`: `ReadyForReview` (15-31) holds one PR. The reasons are at 84-103.
- **Sandbox.** `packages/sandbox/src/index.ts`:
  - `SandboxSpec` (19-32), `Sandbox` with `exec`/`spawn`/`expose?` (57-78).
  - Docker args (279-302) use `--cap-drop ALL` and no socket, so **no docker-compose; services run as processes**.
- **Schema.**
  - `packages/schema/src/index.ts`: `Repository` (94-103), `Factory.repositories` (238), `required_repos` (341, 382), `PipelineStage.requires` (390-405), runner (513-531).
  - Resolved in `packages/definitions/src/resolve.ts`.
- **Studio.**
  - `packages/studio/src/types.ts`: `App.source` (67-87), `Chat` (89-111).
  - `studio.ts`:
    - `"app"` is hard-coded about 30 times;
    - `spec()` (~1483), `setUp` (~560), worktrees (~724), `serve()` (~1323), `resolvePreview` (~1314), `freePort` (~1446).
  - `shipper.ts` has 5 more `"app"` literals, the PR (~310) and the deploy (~336).
- **Preview proxy and UI.**
  - Proxy: `apps/api/src/routes/studio-preview.ts` (`sc-<id>.<KILN_STUDIO_PREVIEW_DOMAIN>`, one port per target).
  - UI: `apps/web/src/components/studio/preview-pane.tsx` (~359), `components/kiln/gate-card.tsx`, `app/runs/[id]/page.tsx`.

Line numbers drift, so search by name.

## Protected paths you will hit

Each of these needs the owner's OK before editing (CLAUDE.md):

- `packages/engine/src/state.ts`, for any change to how the work item's state is persisted or migrated.
- `packages/engine/src/gates.ts`, for the new `requires` entries.
- `packages/definitions/src/validate*`, for validating `stack.yaml`.
- `apps/api/src/app.ts`, only if a new route needs registering there.

Ask first, and write down what was approved in this file.

## Phase 1: change sets in the factory (no previews)

**Goal:** one issue produces linked PRs in several repos and one review.

1. **Types.** In `types.ts`, add `ChangeSetRepo`, `repos[]`, `prs[]` and `previews[]` (plan §4).
   - Keep `repo`, `pr` and `previewUrl` as derived getters, or migrate the callers in one go. One go is preferred; there are about 44 sites.
   - Add a store migration from the old fields to one-element arrays, with a test that loads an old SQLite row.
2. **Schema.** `Factory` gets an optional `stack` (a path to `stack.yaml`). Phase 1 only needs the list of repos plus a `multi_repo: true` switch. Use the stack once Phase 2 lands.
3. **Triage.**
   - The triage agent's output takes `repos: string[]`.
   - Add a `repositories` multi-select decision next to `repository`.
   - A factory with one repo, or with no switch, keeps today's path; test that it is unchanged.
4. **Runs.**
   - Make `cwd` the workspace root when there is more than one changed repo.
   - Add a prompt block that lists the changed and context repos (like Atlas's `<multi_repo_workspace>` in `atlas/packages/edge-worker/src/PromptBuilder.ts:77-137`).
   - A repo pushed outside the set joins the set, and the foreman says so.
5. **PRs.** `ensurePullRequest` loops over the pushed repos. Each body gets a `## Change set` section with every sibling PR, rewritten whenever a PR is added. The same branch name is used everywhere.
6. **CI and completion.**
   - `ci_green` checks every PR in the set.
   - `onPullRequestMerged` completes the work item only when all PRs are merged.
   - `onReviewSubmitted` matches any PR in the set.
   - A closed PR flags the work item.
7. **UI.** The run page and gate card list every PR.

**Tests.** Use the fake forge in `packages/engine`:

- Triage picks two repos.
- The run pushes two branches, so two PRs are opened and linked.
- One PR merged → still open. Both merged → done.
- A single-repo factory snapshot is unchanged.

**Done when:** a Linear issue on a multi-repo factory produces linked PRs in `saba-backend` and `saba-manager-app-frontend`, and the work item closes after both merge. Run `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.

## Phase 2: stack definition and `StackRunner`

1. **Schema.**
   - Add a `Stack` zod schema in `packages/schema` (plan §3): services, `kind: app|datastore|library`, `install`/`migrate`/`seed`/`start`/`port`/`health`/`depends_on`/`env`/`env_public`/`contracts`/`surface`, `merge_order` and `flows`.
   - Validate a cycle-free `depends_on`, ports that are unique, and that `${services.x.url}` names a real service.
   - Resolve the stack in `packages/definitions`.
   - Run `pnpm docs:gen`.
2. **`StackRunner` interface** in `packages/engine`. Use the `adapter-contracts` skill and write a contract test run against both the fake and the real runner.
   - `FakeStackRunner` returns fixed URLs.
   - The sandbox runner follows plan §5 steps 1–4, using `spawn` and `expose`.
   - It waits for health with a timeout per service, and its errors name the service and its last log lines.
3. **Env resolution.** `${services.api.url}` becomes `http://localhost:<port>` for server-side env and the exposed URL for `env_public`. Project environments go under it (`VariableService.forFactory`).
4. **Runner image.** `runners/images/stack-node`: Node 22, pnpm, Postgres, Redis, Chromium and Playwright, plus Elasticsearch only if §10 says it's needed. Add a matching `runners/stack.yaml` with a large `shape`. Keep install caches on a volume keyed by lockfile hash; four `pnpm install`s per stack is the slow part.
5. **Proxy.** Generalise `studio-preview.ts` to `<target>-<service>.<domain>`, which maps to that service's port. Keep `sc-<id>` working.
6. **`destroy`.** Wire it from the API config for both the old previews and stacks, and call it when a work item closes.

**Saba file:** write `factories/saba/stack.yaml` (or keep it in the private `kiln-config` repo if Saba config must stay private, which is likely) from the facts below.

**Done when:** `pnpm kiln stack up factories/saba --branch <x>` (add the CLI command) prints four working URLs, and logging into the seller app shows data from the seeded DB.

## Phase 3: stack previews in the workflow

- The preview stage calls `deployStack` when the factory has a stack. It fills `wi.previews[]`, and every PR in the set gets a card listing all URLs.
- The stack stays up until the set is merged or closed, then is destroyed. Add an idle TTL and sleep or wake later if memory is tight.
- Add a `StackPreview` component in `apps/web` (plan §8), used on the run page and the gate card:
  - tabs per surface
  - side-by-side view of 2–3 surfaces
  - a log tail per service through a new route `GET /api/v1/previews/{id}/services/{svc}/logs`
- **Done when:** a Saba work item shows four live previews, and the seller preview calls the branch's API (open devtools: requests go to the `-api` host, not staging).

## Phase 4: proof

- Add `requires` entries `stack_healthy`, `contracts_pass` and per-surface `criteria_videos` (in `gates.ts`, which is protected).
- **Contracts.** Run `@graphql-inspector/cli` in the stack sandbox:
  - `validate` the consumer operations against the API branch's schema
  - `diff` the base schema against the branch schema to list breaking changes
  - check that every consumer of a broken type is in the change set
  - Saba's backend is NestJS with GraphQL. Confirm where the schema file is generated (often `schema.gql` on start) and where each frontend's operations live (`gql` tags in `.ts` need `--documents` globs).
- **Flows.**
  - The verify agent writes Playwright specs tagged `@AC1 @seller @customer`. Kiln runs them with `use: { video: "on" }`, with `baseURL`s per surface injected as env (`KILN_URL_SELLER`, …).
  - Change `collectPlaywrightEvidence` to take the report path and key videos `AC<n>/<service>`.
  - A cross-surface flow is one spec that opens several pages. Name each step with `test.step('seller: …')` so the evidence can caption it.
- **Gate check.** `criteriaCovered` checks that every surface a criterion names has a passing video.
- **Done when:** the plan's §12 acceptance passes, including the broken-rename case failing `contracts_pass`.

## Phase 5: merge as a set

- `ReadyForReview` takes `prs[]`. `merge-safety` sees the whole set.
- Merge in `merge_order`, stopping at the first failure. The foreman reports what merged, and a person continues from there.
- A person merging by hand is noticed, and the rest proceeds.
- `merge-gate.ts` tests: a set with all PRs safe, one unsafe, and a merge that fails midway.

## Phase 6: Studio on a stack

- `App.source` → `sources[]`. Migrate stored Apps to one source with service name `app`, so the literal paths keep working while you refactor them away.
- Create the per-chat worktrees at `chats/<id>/<service>`.
- `serve()` uses `StackRunner`. Each chat gets one database cloned from the seed (`createdb -T`).
- Change `resolvePreview` / `previewUrlFor` to work per service.
- `preview-pane.tsx` uses `StackPreview`. Inject `kiln-bridge.js` into each frontend; for imported repos, inject it through the proxy rather than the template.
- The shipper opens a change set and uses Phases 4–5.
- This touches the active Studio Context work. Do it after `studio-context` has landed on `main`.

## Phase 7 (optional): Kubernetes stack provider

`KubernetesPreview.deployStack`: one namespace per change set, a Deployment and Service per service, and a DNS name for each `${services.*.url}`. Only build this if a full Saba stack doesn't fit in one sandbox.

## Saba facts to collect

Read these from each repo's `package.json`, `.env.example`, `docker-compose*`, `Dockerfile`, `README`, `CLAUDE.md`/`AGENTS.md` and Coolify settings. Put the answers in the plan's §10.

| Repo | Collect |
| --- | --- |
| saba-backend | DB engine and version; migration and seed commands; start command and port; health route; GraphQL schema path; Redis, Elasticsearch and ClickHouse usage; external APIs (payments, SMS, mail, OneSignal) and how to disable them; auth (JWT secret, how to mint a test user per role) |
| saba-app-frontend | How the tenant is picked (host name? ~40 sites); API URL variable and whether it's build-time; NextAuth config; where GraphQL operations live |
| saba-manager-app-frontend | Same; confirm it is the "seller" app (Atlas: Menejer, per-venue manager PWA, base branch `main`, not `master`) |
| saba-super-frontend | Same (Next 12, Apollo); admin login |
| saba-localization | How the apps consume it (package, submodule or fetched JSON) |

Base branches and labels from Atlas (`atlas/deploy/coolify-config.example.json`):

| Repo | Base branch | Label |
| --- | --- | --- |
| saba-manager-app-frontend | `main` | Menejer Frontend |
| saba-backend | `master` | Backend API |
| saba-app-frontend | `master` | Müşteri Frontend |
| saba-super-frontend | `master` | Admin Panel |
| saba-localization | `master` | Translate |

Use the labels as repo `description`s so triage can route by them.

**Seed data is the biggest unknown.** Without a safe seed (an anonymised dump or fixtures with one user per role and a tenant with products), previews are empty and no flow can be recorded. Settle it early with whoever owns Saba's data.

## Running locally

- Install and start: `pnpm install`, then `pnpm dev` (API, MCP and web). Use the fakes for Phases 1 and 3 UI work.
- The full check: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.
- A real stack needs the Docker sandbox backend and the new runner image built locally: `docker build -t kiln/runner-stack-node runners/images/stack-node`.
- Budget roughly 8–12 GB of RAM for the API, three Next dev servers, Postgres, Redis and Chromium, plus Elasticsearch if needed.
- **Don't run a second Kiln API against anton's Docker.** On start it removes sandboxes it doesn't know, which would be the deployed Kiln's. Keep local work on your own Docker.

## Atlas, for reference

Clone: `/home/fishuke/atlas`. Worth copying:

- multi-repo routing by tags and keywords: `packages/edge-worker/src/RepositoryRouter.ts:201-269, 407-457, 579-616`
- the multi-repo prompt blocks: `PromptBuilder.ts:77-137`
- the PR cross-linking steps: `skills/verify-and-ship/SKILL.md:80-109`

Don't copy the preview-pair registry plan (`plans/can-we-also-add-unified-hejlsberg.md`). The stack preview replaces it, and it was never built.
