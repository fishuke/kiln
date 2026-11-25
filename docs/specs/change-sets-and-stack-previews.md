# Change sets and stack previews: one feature across backend and frontends

Decision: [ADR-020](../adr/0020-change-sets-and-stack-previews.md) (proposed). First product: Saba.

## 1. Goal

From one Linear or Jira issue, or one Studio App, Kiln builds a feature that touches `saba-backend`, `saba-app-frontend` (customer), `saba-manager-app-frontend` (manager/seller), `saba-super-frontend` (super admin) and, when needed, `saba-localization`. Before anyone reviews it, Kiln shows:

- one live preview URL **per frontend**, all talking to **this branch's** backend;
- a video per acceptance criterion per affected surface, including flows that cross surfaces;
- green per-repo checks, migrations, and a contract check between the API and each frontend;
- the linked pull requests as one change set, reviewed and merged together.

## 2. What exists and what's missing

| Need | Kiln today | Atlas today |
| --- | --- | --- |
| Route one issue to several repos | Triage picks one (`workflow.ts` `chooseRepo`); `required_repos` clones extras | Labels, `[repo=a,b]` tags, keyword match (`RepositoryRouter.ts`) |
| Branch per repo | `pushBranches` already pushes `kiln/<id>-<slug>` to every changed repo (`runs.ts:1352`) | One worktree per repo, same branch name |
| One PR per repo, linked | One PR only (`ensurePullRequest`, `wi.pr`) | Agent opens PRs and adds "Related PRs" to the bodies |
| Preview wired to the branch's API | One URL per PR (`PreviewProvider`); frontends call the live API | Coolify per-PR previews, unpaired; pairing is a plan |
| Video evidence | Playwright per criterion, first repo only (`collectPlaywrightEvidence`) | Prompt hints only; no browser in the image |
| Cross-service proof | None | None |
| Merge together | Merge gate judges one PR | Manual |

## 3. The stack definition

A new definition file, `stack.yaml`, in the factory tree. A Kiln Project points to one (`Project.stack`), so the factory and the Project's Studio Apps share it. Validated by zod in `packages/schema`.

```yaml
apiVersion: kiln/v1
kind: Stack
name: saba
runner: { image: kiln/runner-stack-node, shape: xlarge }   # Postgres, Redis, ES, Chromium in the image
services:
  postgres: { kind: datastore, start: postgres-start, port: 5432, seed: { from: s3://kiln-seeds/saba/latest.sql.gz } }
  redis:    { kind: datastore, start: redis-server --port 6379, port: 6379 }
  search:   { kind: datastore, start: elasticsearch-start, port: 9200, optional: true }
  api:
    repo: sabagroup/saba-backend
    install: pnpm install --frozen-lockfile
    migrate: pnpm migration:run
    start: pnpm start:dev
    port: 3000
    health: /health
    depends_on: [postgres, redis]
    env: { DATABASE_URL: "postgres://kiln@localhost:5432/saba", REDIS_URL: "redis://localhost:6379" }
    contracts: { graphql_schema: schema.gql }
  customer:
    repo: sabagroup/saba-app-frontend
    surface: Customer site
    install: pnpm install --frozen-lockfile
    start: pnpm dev
    port: 3001
    depends_on: [api]
    env: { NEXT_PUBLIC_API_URL: "${services.api.url}" }
    contracts: { graphql_operations: "src/**/*.graphql" }
  seller:
    repo: sabagroup/saba-manager-app-frontend
    surface: Manager app
    start: pnpm dev
    port: 3002
    depends_on: [api]
    env: { NEXT_PUBLIC_API_URL: "${services.api.url}" }
  admin:
    repo: sabagroup/saba-super-frontend
    surface: Super admin
    start: pnpm dev
    port: 3003
    depends_on: [api]
    env: { NEXT_PUBLIC_API_URL: "${services.api.url}" }
  i18n:
    repo: sabagroup/saba-localization
    kind: library          # no process; consumed by the others
    link: { into: [customer, seller, admin] }
merge_order: [i18n, api, admin, seller, customer]
flows: e2e/              # Playwright specs, in the factory tree or a repo
```

Rules:

- `${services.<name>.url}` resolves to the URL that service is reachable at **from where the reader runs**: the in-sandbox address for server-side code, the exposed preview URL for browser code (`NEXT_PUBLIC_*`). The stack says which with `env_public: [NEXT_PUBLIC_API_URL]`.
- Project environments ([project-environments.md](project-environments.md)) still apply; the stack's env goes on top for its service.
- Commands, ports and seed above are placeholders until we read the Saba repos (§10).

## 4. Work items become change sets

`packages/engine/src/types.ts`:

```ts
type ChangeSetRepo = { repo: string; base: string; role: "changed" | "context" };
type ServicePreview = { service: string; surface?: string; url: string; status: "starting" | "ready" | "failed" };
// WorkItem
repos: ChangeSetRepo[];      // replaces repo
prs: PullRequestRef[];       // replaces pr
previews: ServicePreview[];  // replaces previewUrl
```

The store migration maps old `repo`/`pr`/`previewUrl` into one-element arrays.

- **Triage** (`workflow.ts` `triage`/`chooseRepo`): with a stack, the triage agent returns `repos: string[]` from the stack's repositories. Otherwise a typed `repositories` decision does, and its options carry each service's description and surface. Under 0.6 confidence, the foreman asks. A factory without a stack keeps ADR-010.
- **Runs** (`runs.ts`): clone every stack repository, so the agent can read the API while editing a frontend. The working directory becomes the workspace root. The prompt lists which repositories are `changed` and which are `context`, like Atlas's `<multi_repo_workspace>`. A repository the agent changes outside the set is added to the set, and the foreman says so.
- **Pull requests** (`ensurePullRequest`): one per pushed repository, same branch. Each body has a **Change set** section with every sibling PR, the preview URLs and the evidence, rewritten whenever the set changes.
- **CI** (`ci_green`): every PR in the set.
- **Completion** (`onPullRequestMerged`): done when every PR is merged. A closed PR in the set flags the work item.

## 5. Stack previews

**Where it runs.** One sandbox per change set, from the stack's runner (ADR-017: processes only, no Docker). `packages/sandbox` gains nothing new: `spawn` and `expose` already exist. A new `StackRunner` in `packages/engine` (with a `FakeStackRunner`):

1. Clone each service at the change set's branch if it is changed, otherwise at its base.
2. Start datastores, restore seeds, wait for health.
3. Install (cached by lockfile hash), run `migrate`, start each service in `depends_on` order, wait for `health`.
4. `expose` each port and record `ServicePreview { service, surface, url }`.

**URLs.** `pr-<wi>-<service>.<KILN_PREVIEW_DOMAIN>` through the existing preview proxy (`studio-preview.ts` generalised from one port per target to one per service).

**Lifetime.** Up from the first green build until the change set is merged or closed, then `destroy`. Idle stacks sleep after a TTL and wake on the next visit (snapshot the sandbox). This also wires `destroy`, which nothing calls today.

**The provider contract** (`packages/integrations/src/chat.ts`):

```ts
type StackDeploy = { changeSet: string; stack: StackDefinition; branches: Record<string, string>; env: Record<string, string> };
interface PreviewProvider {
  deploy(input: PreviewDeploy): Promise<PreviewResult>;               // unchanged, single app
  deployStack?(input: StackDeploy): Promise<{ services: ServicePreview[] }>;
  destroy(id: string): Promise<void>;
}
```

The sandbox provider implements `deployStack` first. `KubernetesPreview` can implement it later, as one namespace with a Deployment per service and service DNS for `${services.*.url}`. Coolify's own per-PR previews can stay. They aren't used as proof, because they aren't paired.

## 6. Proof

A new `prove` action runs on the stack preview, in the `verify` stage, before review. Each step is a `requires` entry:

| `requires` | What runs | Fails when |
| --- | --- | --- |
| `ci_green` | Every PR's CI | Any PR red or missing checks |
| `stack_healthy` | §5 steps 1–3 | A service doesn't build, migrate or pass its health check |
| `contracts_pass` | For each consumer with `graphql_operations`: validate its operations against the API branch's `graphql_schema` (graphql-inspector); breaking schema changes are listed | An operation doesn't validate, or a breaking change has a consumer not in the change set |
| `criteria_videos` | The verify agent writes or extends Playwright flows in `flows/`, tagged with criterion and surfaces; Kiln runs them against the stack's URLs with video on | A criterion has no passing video for every surface it names |

**Videos.** `collectPlaywrightEvidence` reads the stack run's report, not `repos[0]`. Each video is keyed `AC<n>/<service>`. A flow that crosses surfaces (the seller adds a product, then the customer sees it) is one video with a caption bar naming the surface, plus a screenshot per step. Videos go to the PR bodies, the gate card and the Linear or Jira issue.

**A failure loops.** A failure goes back to `build` with the failing step's output (`on_fail: build`, `max_loops`), as verify does today.

## 7. Review and merge

- **Gate card** (`gate-card.tsx`): one card per change set, with the PRs (repo, diff size, CI), a preview grid (§8) and the evidence by criterion.
- **Merge gate** (`merge-gate.ts`): `ReadyForReview` takes `prs[]`. Reasons are computed for each PR and for the set. The 300-line limit applies per PR.
- **Merge:** in `merge_order`, stopping at the first failure. The foreman reports "merged api, admin; seller failed: conflict" and the work item waits for a person. People can always merge by hand; Kiln notices and continues.

## 8. Multiple previews in the UI

The same `StackPreview` component is used on the work item page, the gate card and Studio.

- **Tabs**, one per surface (Customer site · Manager app · Super admin · API), each with status and an "open" link. API shows its GraphQL playground or health page.
- **Side-by-side**: pick two or three surfaces and see them next to each other at phone or desktop size. This is the view for cross-surface flows.
- **Logs**: a per-service log tail for when something is red.
- A change set of one repository shows today's single preview.

## 9. Studio

This is Studio Phase 7 in `docs/ideas/studio.md`.

- `App.source` becomes `sources[]`; an App can be created from a Project's stack ("New App on Saba").
- A chat gets a worktree per repository (`chats/<id>/<service>/`), and the hard-coded `"app"` paths in `studio.ts` and `shipper.ts` go.
- `serve()` runs the stack (§5) instead of one `dev` command. Datastores are shared between the chats of one App, with one database per chat cloned from the seed.
- The preview pane shows the stack tabs. The prototype bridge (`kiln-bridge.js`) is injected into every frontend, so Inspect works on each.
- Ship opens a change set (§4) and goes through the same proof and merge as a factory.

## 10. Open questions (need the Saba repos)

1. Start commands, ports, required env and the health route for each repo, and how each frontend reads the API URL (build-time `NEXT_PUBLIC_*` or runtime).
2. The database: Postgres, MySQL or Mongo? Do migrations exist? What seed is safe to use (an anonymised dump or fixtures)? Are ClickHouse and Elasticsearch needed for the core flows, or can they be stubbed?
3. Multi-tenancy in `saba-app-frontend`: ~40 customer sites by host name. Which tenant does a preview use, and how is it picked (header, query or env)?
4. Auth: NextAuth or JWT login for each surface. A seeded user per role, so flows can log in.
5. How `saba-localization` reaches the apps: a package, a submodule or a fetched JSON file.
6. External services (payments, OneSignal, SMS, email) that must be faked or blocked in previews; these become egress rules.
7. Is `saba-manager-app-frontend` the "seller frontend"? Atlas calls it Menejer (venue manager).

## 11. Phases

1. **Change sets in the factory.** `repos[]`/`prs[]`, triage multi-pick, linked PR bodies, CI across the set, completion. No previews yet. This already beats Atlas: one issue, linked PRs, one review.
2. **Stack definition and `StackRunner`.** Schema, fake, the sandbox implementation, the preview proxy per service, `destroy`, the runner image with Postgres, Redis and Chromium. A Saba `stack.yaml` booted by hand.
3. **Stack previews in the workflow.** The preview stage deploys the stack, the PR card and gate show every URL, and the `StackPreview` UI.
4. **Proof.** `stack_healthy`, `contracts_pass` (GraphQL), `criteria_videos` per surface, cross-surface flows.
5. **Merge as a set.** Merge gate over `prs[]`, ordered merge, partial-failure reporting.
6. **Studio on a stack.** `sources[]`, per-repo worktrees, the stack in `serve()`, the multi-preview pane, shipping a change set.
7. **Kubernetes stack provider** (optional), for stacks too large for one sandbox.

## 12. Acceptance (whole feature, on Saba)

- An issue saying "sellers can mark a product as featured; customers see a Featured badge; admins can see a count" produces three linked PRs (api, seller, customer) and no PR for admin if admin needs no change. The admin preview still runs at its base branch.
- The work item shows four preview URLs. The seller and customer previews call the branch's API: the new field exists there and not on staging.
- The evidence has a passing video for each criterion on each surface it names, plus one cross-surface video.
- Renaming the field in the API without updating the customer frontend fails `contracts_pass`, naming the broken operation.
- The change set merges in `merge_order`, or stops and reports at the first failure.
- A factory without a stack, and a Studio App with one source, behave exactly as before.
