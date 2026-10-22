# Studio: phases 1–4

Decision: [ADR-012](../adr/0012-studio.md) · Idea: [Studio](../ideas/studio.md). Voice (phase 5) and graduation (phase 6) are out of scope here.

## Why

People want to talk to one model and watch an app appear, before a project is ready for a factory. This spec covers the sandbox capability, the Studio domain, the control surface (tools and events), the API, the MCP tools and the web page.

## Packages and boundaries

| Where                           | What                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sandbox`              | `Sandbox.expose(port)` on the local, Docker and Kubernetes backends.                                                                                                |
| `packages/events`               | Studio event types with a `priority`.                                                                                                                               |
| `packages/studio` (new)         | Projects, chats, turns, versions, dev servers and the zod-typed tools. Depends on `sandbox`, `harness`, `store`, `events`, `schema`. Never on `engine` or `apps/*`. |
| `apps/api/src/routes/studio.ts` | REST routes and the preview proxy, registered from `routes/index.ts`.                                                                                               |
| `packages/sdk-ts`               | `KilnClient.studio*` methods.                                                                                                                                       |
| `apps/mcp`                      | `studio_*` tools that call the API with the caller's token.                                                                                                         |
| `apps/web/src/app/studio`       | The Studio page.                                                                                                                                                    |

## `Sandbox.expose(port)`

```ts
/** Where the API can reach a server listening on `port` inside the sandbox. */
expose?(port: number): Promise<{ host: string; port: number }>;
```

- **Local:** `127.0.0.1:<port>`; processes run on the host.
- **Docker:** the container's IP on its network (`docker inspect`), at `<port>`. The API must share that network (in compose, attach it to `kiln-egress`). A sandbox started with `--network none` has no address, so `expose` throws `SandboxNotReachable`.
- **Kubernetes:** the pod IP (`kubectl get pod -o jsonpath={.status.podIP}`). The sandbox NetworkPolicy must allow ingress from the API (a follow-up; today it denies all ingress).
- It's optional on the interface, so the test doubles in other packages keep compiling. Studio checks for it and fails with a clear error.

## Domain (`packages/studio`)

Store collections (runtime state; code lives in the project's Git repository in the sandbox, saved by snapshots):

| Collection        | Document                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `studio_projects` | `id, team, name, template, shipMode, harness, model?, status (creating, ready, paused, failed), snapshot?, error?, createdBy, createdAt, updatedAt`                |
| `studio_chats`    | `id, projectId, title, mode, harness, model?, branch, path, port, status (idle, working, needs_you, conflict, failed), question?, createdAt, updatedAt`            |
| `studio_turns`    | `id, projectId, chatId, prompt, mode, via, status, reply, title?, summary?, checkpoint?, discarded, plan?, question?, activity[], costUsd, startedAt, finishedAt?` |
| `studio_versions` | `id, projectId, sha, title, kind (initial, apply, restore), chatId?, restoredFrom?, bookmarked, createdAt`                                                         |

Workspace layout in the sandbox:

```
<workdir>/project          main repository, branch main (versions)
<workdir>/chats/<chatId>   git worktree, branch chat/<chatId>
<workdir>/version          detached worktree for previewing an old version
```

Rules:

- **Templates.** A template has scaffold commands and a dev command. `nextjs` copies `/opt/kiln/templates/nextjs` from the runner image when it's there, and otherwise runs `create-next-app`. The first commit on `main` is the `initial` version.
- **A turn** starts the chat's harness in its worktree with Studio's instructions and the prompt. While a turn runs, `send` steers it instead of starting another. When it ends, Studio reads `.kiln/studio.json` (`title`, `summary`, `question?`) and records subagent activity (`Task` and `Agent` tool calls).
- **Checkpoints.** `git add -A`; if the index differs from `HEAD`, Studio commits on the chat branch with the turn's title. No diff, no commit, in any mode.
- **Modes are permissions.** Build may edit. Chat and Plan are read-only: the instructions say so, and Studio enforces it by discarding any changes at the end of the turn (`git reset --hard && git clean -fd`) and marking the turn `discarded`. A Plan turn stores its reply as `plan`; "Build it" sends the plan as a Build turn.
- **Apply** merges the chat branch into `main` (`git merge --no-ff`) and records an `apply` version with the titles of the checkpoints since the chat was last applied. On a conflict it aborts the merge and sets the chat to `conflict`.
- **Restore** sets `main`'s tree to an old version's (`git read-tree -u --reset <sha>`), commits, and records a `restore` version. History is never rewritten.
- **Bookmarks** toggle `bookmarked` on a version.
- **Dev servers.** One per chat worktree (and one for the `version` worktree), on ports from 4100 up, started with the template's dev command through `sandbox.spawn`. The preview target is `sandbox.expose(port)`.
- **Limits.** At most `maxRunningChats` (default 3) turns run at once per project.
- **Durability.** Every Store write happens before and after the step that changes it. After each turn the sandbox is snapshotted to object storage, so a restarted API resumes the project from its latest snapshot. `pause(project)` snapshots it and destroys the sandbox. Time comes from an injected `Clock`.

### Ship mode

`shipMode: "safe" | "review" | "cowboy"`, default `cowboy` (ADR-012).

| Mode     | Inside the sandbox (built here)                                                                                                                                                                                                                                             | On the forge (ADR-012; not built here)                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `safe`   | Apply is a person's click                                                                                                                                                                                                                                                   | Nothing is pushed until the person asks                   |
| `review` | Apply is a person's click                                                                                                                                                                                                                                                   | The agent pushes a branch and opens a PR; a person merges |
| `cowboy` | After each turn that changes files, the chat applies to `main`, with any number of chats. On a conflict, Studio runs a resolve turn in that chat (`git merge main`, fix, commit) and applies again. If that still conflicts, the chat is `conflict` and raises `needs_you`. | The agent pushes `main`                                   |

Forge sync is out of scope for phases 1–4. When it comes, ADR-012's guards apply: a push credential scoped to the one Kiln-created Studio repository, cowboy ending at graduation, and every agent push in the audit log. Nothing in this phase pushes, opens a PR or merges outside the sandbox.

## Tools (phase 4)

Each tool is a zod input schema plus a handler on `Studio`, defined once in `packages/studio/src/tools.ts`:

| Tool           | Kind   | Input                                                               |
| -------------- | ------ | ------------------------------------------------------------------- |
| `status`       | server | `{ project? }`: running, needs-you and recent versions, per project |
| `open_project` | server | `{ project }` or `{ name, template? }` (opens or creates)           |
| `new_chat`     | server | `{ project, prompt?, mode?, harness?, model?, title? }`             |
| `send`         | server | `{ chat, text, mode? }`                                             |
| `apply`        | server | `{ chat }`                                                          |
| `restore`      | server | `{ version }`                                                       |
| `bookmark`     | server | `{ version, on }`                                                   |
| `look`         | server | `{ chat }`: a preview target (URL), not a screenshot yet            |
| `focus`        | client | `{ project, chat? }`                                                |
| `show`         | client | `{ view: preview \| code \| history }`                              |

Client tools return an instruction for the caller's UI and change nothing on the server.

## Events (phase 4)

Added to `KilnEventMap`, each with `priority`:

| Event                                                                     | Priority    |
| ------------------------------------------------------------------------- | ----------- |
| `studio.turn_started`                                                     | `progress`  |
| `studio.turn_finished`                                                    | `finished`  |
| `studio.version_created`                                                  | `finished`  |
| `studio.needs_you` (a question, or a conflict the agent couldn't resolve) | `needs_you` |

## API

All routes need a signed-in caller. Projects belong to the caller's team, and only that team can see them.

```
GET  /api/v1/studio/projects
POST /api/v1/studio/projects                    { name, template?, shipMode?, harness?, model? }
GET  /api/v1/studio/projects/{id}               project, chats, versions
PATCH /api/v1/studio/projects/{id}              { name?, shipMode? }
POST /api/v1/studio/projects/{id}/chats         { prompt?, mode?, harness?, model?, title? }
GET  /api/v1/studio/chats/{id}                  chat and turns
POST /api/v1/studio/chats/{id}/messages         { text, mode? }
POST /api/v1/studio/chats/{id}/apply
GET  /api/v1/studio/chats/{id}/diff             diff of the chat since its last apply
POST /api/v1/studio/versions/{id}/restore
POST /api/v1/studio/versions/{id}/bookmark      { on }
POST /api/v1/studio/versions/{id}/preview       starts the version worktree's dev server
GET  /api/v1/studio/versions/{id}/diff
POST /api/v1/studio/tools/{name}                any tool, by name, with its zod input
```

### Preview proxy

- `KILN_STUDIO_PREVIEW_DOMAIN` set (such as `preview.kiln.example.com`): a request to `<target>.<domain>` is proxied to that target's `expose()` address. The target id is unguessable (128 bits) and stands in for auth, because a preview origin never sees Kiln's cookies.
- Unset (local development): the preview URL is the exposed address itself, such as `http://127.0.0.1:4101`.
- The proxy is registered as a public module in `routes/index.ts`, so requests to preview hosts skip the API's token middleware. It only matches hosts under the preview domain and passes every other request through untouched.
- Hot reload needs WebSocket upgrades proxied too. That belongs in `apps/api/src/main.ts` (the Node server's `upgrade` event) and is a follow-up. Until then the page reloads the preview when a turn finishes.

### apps/api/src/app.ts

No change is needed. The routes register through `registerModules` and `registerPublicRoutes` in `routes/index.ts`, which app.ts already calls, and the Studio service is created from `ctx.kiln` (store, objects, bus, clock, sandboxes, harness factory) inside `routes/studio.ts`. If we'd rather hold the Studio service on the app's context than in a per-`Kiln` WeakMap, this is the change (not made):

```diff
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ export type RouteContext = {
   checkOrgs: (c: Context<Env>, repos: { owner: string; forge?: string }[]) => void;
+  /** Studio (ADR-012); undefined when the server has no sandbox backend for it. */
+  studio?: Studio;
 };
@@ export function createApp(kiln: Kiln, options: AppOptions = {}) {
-  const ctx: RouteContext = { app, kiln, options, need, who, visible, access, user, team, canReadRun, canSendRun, adopt, checkOrgs };
+  const ctx: RouteContext = { app, kiln, options, need, who, visible, access, user, team, canReadRun, canSendRun, adopt, checkOrgs, studio: options.studio };
```

## Acceptance

1. `expose` returns a reachable address on local and Docker (fake command runner), and throws for a Docker sandbox without a network.
2. A Build turn that edits files makes one checkpoint. A question makes none. A Chat-mode turn that edits files leaves no change and is marked discarded.
3. In `cowboy` mode every changed turn becomes a version on `main`, with one chat or several. In `safe` and `review` modes nothing reaches `main` until Apply.
4. Two chats that change the same line: the second apply conflicts, the resolve turn runs, and on success both changes are on `main`.
5. Restore makes a new version whose tree equals the old one, and the old versions stay.
6. The tools validate input with zod and act through `Studio`; client tools change nothing.
7. Studio events carry their priority.
8. The API serves the routes above for the caller's team only, the MCP tools call them, and `/studio` shows chat, preview, version cards, History and Bookmarks.

## Follow-ups

WebSocket proxying for hot reload; a Kubernetes ingress policy for previews; screenshots for `look`; idle pause on a timer; forge sync per ship mode; voice (ADR-013); graduation.
