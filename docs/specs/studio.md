# Studio: phases 1–4 (contract)

Decision: [ADR-012](../adr/0012-studio.md) · Idea: [Studio](../ideas/studio.md). Voice ([ADR-013](../adr/0013-voice.md)), coupling an App to a factory, and forge sync and shipping are later phases. Dictation in the composer is optional and may be skipped.

This spec is the contract that parallel work builds against. Change it here first, then in code.

**Naming.** Studio's unit is an **App** (one repository in one sandbox). "Project" means a Kiln Project, which groups factories and, optionally, Apps ([Portfolio](../site/management/portfolio.md)). An App needs no factory.

## Who builds what

| Area                                                                                                      | Owner                      | Depends on                                                                           |
| --------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `Sandbox.expose(port)` (done, `fc7c1cb`) and the preview proxy in `apps/api/src/routes/studio-preview.ts` | sandbox/preview            | this spec                                                                            |
| `packages/studio`: domain, tools, events                                                                  | studio                     | `Sandbox.expose`, `Template` below                                                   |
| `apps/api/src/routes/studio.ts`, `packages/sdk-ts` methods, `apps/mcp` tools                              | studio (after the package) | `packages/studio`                                                                    |
| `apps/web/src/app/studio`                                                                                 | web                        | the API and SDK shapes below; build against `FakeStudioClient` until the routes land |
| The Next.js template and runner image                                                                     | template                   | `Template` below                                                                     |

## Boundaries

- `packages/studio` depends on `@kiln/sandbox`, `@kiln/harness`, `@kiln/store`, `@kiln/events` and `@kiln/schema`, never on `@kiln/engine` or `apps/*`. `Clock` is redeclared structurally (`{ now(): Date }`).
- No change to `apps/api/src/app.ts`. The routes register through `routes/index.ts` (the `MODULES`, `PLATFORM` and `PUBLIC_MODULES` lists), which app.ts already calls. The Studio service is built from `ctx.kiln` (store, objects, bus, clock, sandboxes, `options.harness`) in a per-`Kiln` `WeakMap` in `routes/studio.ts`. If we later want it on `RouteContext` instead, the diff is:

```diff
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ export type RouteContext = {
   checkOrgs: (c: Context<Env>, repos: { owner: string; forge?: string }[]) => void;
+  /** Studio (ADR-012); undefined when the server has no sandbox backend for it. */
+  studio?: Studio;
 };
```

## `Sandbox.expose` (done)

```ts
// packages/sandbox/src/index.ts
export type SandboxAddress = { host: string; port: number };
export class SandboxNotReachable extends Error {
  readonly sandboxId: string;
}
interface Sandbox {
  /** Where the API can reach a server listening on `port` inside the sandbox. */
  expose?(port: number): Promise<SandboxAddress>;
}
type SandboxSpec = {
  // …
  /** A Studio sandbox: the API's preview proxy reaches its dev servers. Studio sets this on every sandbox it creates or resumes. */
  preview?: boolean;
};
new DockerSandboxProvider(runner, { previewNetwork: "kiln-preview" /* KILN_PREVIEW_NETWORK */ });
```

- Local: `127.0.0.1:<port>`.
- Docker: the container IP from `docker inspect`. It throws `SandboxNotReachable` when the container has no network (`--network none`, which means a runner with no egress). A sandbox with `preview: true` also joins the provider's `previewNetwork` (internal; only the API and Studio sandboxes are on it), and `expose` returns its address there. The API is on the preview network, never on `kiln-egress`, and drops every connection and egress-log datagram from the preview subnet (`KILN_PREVIEW_SUBNET`), so sandboxes can't call it.
- Kubernetes: the pod IP. A sandbox with `preview: true` gets the label `kiln.dev/preview: "true"`, and the Helm chart's `kiln-preview-ingress` NetworkPolicy admits the API to ports 4100–4199 of those pods.
- A port outside 1–65535 throws `RangeError`.

## Types (`packages/studio/src/types.ts`)

Every type is a zod schema with an inferred type of the same name. Dates are ISO strings. Ids are a prefix, `_`, and 32 lowercase hex characters (128 bits).

```ts
export const ShipMode = z.enum(["safe", "review", "cowboy"]); // default "cowboy" for templates, "review" for imported repositories
export const ChatMode = z.enum(["build", "chat", "plan"]); // default "build"
export const Priority = z.enum(["needs_you", "finished", "progress"]);
export const AppStatus = z.enum(["creating", "ready", "paused", "failed"]);
export const ChatStatus = z.enum(["idle", "working", "needs_you", "conflict", "failed"]);
export const TurnStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export const VersionKind = z.enum(["initial", "apply", "restore"]);
export const Via = z.enum(["web", "mcp", "api", "voice"]);

export type App = {
  id: string; // "sa_…"
  team: string;
  projectId?: string; // the Kiln Project this App belongs to, if any
  name: string;
  source: AppSource; // a template or an existing repository
  setup?: AppSetup; // what Studio detected when it created the workspace
  shipMode: ShipMode;
  harness: HarnessType; // default for new chats, "claude-code"
  model?: string;
  status: AppStatus;
  error?: string;
  snapshot?: SnapshotRef; // latest workspace snapshot
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSource =
  | { kind: "template"; template: string } // Template.id, e.g. "nextjs"
  | { kind: "repo"; connection?: string; repo: string; branch?: string }; // repo "owner/name"; connection defaults to the server's forge

export type AppSetup = {
  mainBranch: string; // the App's main line in the sandbox: "main" for templates, the cloned branch for repos
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  install: string[]; // from the template or the detected package manager
  dev?: string; // effective dev command; {port} is replaced
  devDetected?: string; // from package.json scripts.dev (or the template), before an override
  devOverride?: string; // set by the person
  envRequired: string[]; // keys from .env.example / .env.sample / .env.local.example
  envMissing: string[]; // required keys the environment resolver didn't provide
};

export type Chat = {
  id: string; // "sc_…": also the preview target id
  appId: string;
  title: string;
  mode: ChatMode; // the composer's current mode
  harness: HarnessType;
  model?: string;
  branch: string; // "chat/<id>"
  path: string; // "chats/<id>", relative to the sandbox workdir
  port: number; // dev server port, 4101–4199
  status: ChatStatus;
  question?: string; // set while status is needs_you or conflict
  appliedSha?: string; // chat branch head at its last apply
  createdAt: string;
  updatedAt: string;
};

export type Activity =
  | { kind: "message"; text: string; at: string }
  | { kind: "reasoning"; text: string; at: string }
  | { kind: "tool"; name: string; text?: string; at: string }
  | { kind: "subagent"; name: string; text: string; at: string } // Task/Agent tool calls
  | { kind: "error"; text: string; at: string };

export type Turn = {
  id: string; // "st_…"
  appId: string;
  chatId: string;
  prompt: string;
  mode: ChatMode;
  via: Via;
  by: string; // user id or email
  status: TurnStatus;
  reply: string; // the agent's final message
  title?: string; // one line, from .kiln/studio.json or the reply
  summary?: string; // two sentences, for badges and voice
  question?: string; // the agent asked the person something
  plan?: string; // plan mode: the plan card's body
  checkpoint?: string; // commit sha on the chat branch, when files changed
  discarded: boolean; // chat/plan mode changed files and Studio reverted them
  resolve?: boolean; // a conflict-resolution turn Studio started itself
  activity: Activity[];
  costUsd: number;
  startedAt: string;
  finishedAt?: string;
};

export type Version = {
  id: string; // "sv_…": also the version preview target id
  appId: string;
  sha: string; // commit on the App's main line
  title: string;
  kind: VersionKind;
  chatId?: string; // apply
  restoredFrom?: string; // restore: the version id
  bookmarked: boolean;
  createdAt: string;
};

export type Preview = { target: string; url: string; status: "starting" | "ready" | "failed" };
```

Store collections: `studio_apps`, `studio_chats`, `studio_turns` and `studio_versions`, each keyed by `id`.

## Template (`packages/studio/src/templates.ts`)

```ts
export type Template = {
  id: string; // "nextjs"
  name: string; // "Next.js"
  /** Run in <workdir>/app, an empty directory, to create the app. Trusted commands. */
  scaffold: string[];
  /** Run in each worktree before its dev server starts (e.g. "pnpm install --prefer-offline"). */
  install: string[];
  /** Dev server command; {port} is replaced. It must bind 0.0.0.0. */
  dev: string;
  /** The preview is ready when GET `path` on the dev port answers with any status; give up after `timeoutMs`. */
  ready?: { path: string; timeoutMs: number };
  /** Runner image with the harness CLIs and the template baked in (defaults to KILN_RUNNER_IMAGE). */
  image?: string;
  egress: string[];
};

export const TEMPLATES: Record<string, Template>;
```

`nextjs`:

- `scaffold`: `test -d /opt/kiln/templates/nextjs && cp -a /opt/kiln/templates/nextjs/. . || pnpm dlx create-next-app@15 . --ts --tailwind --app --eslint --use-pnpm --yes --skip-install`
- `install`: `test -d node_modules || cp -al "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/node_modules" node_modules 2>/dev/null || true`, then `pnpm install --prefer-offline`. A worktree hard-links the project's `node_modules` (0.2 s) instead of importing 400 MB from the image's pnpm store, which overlayfs copies up (20 s).
- `dev`: `pnpm next dev --turbopack --port {port} --hostname 0.0.0.0` (Turbopack compiles the first page in about 2 s, webpack in about 6 s)
- `ready`: `{ path: "/", timeoutMs: 60000 }`
- Studio starts the dev server with `KILN_STUDIO_PREVIEW_DOMAIN` in its environment when the server has one; the template's `next.config.ts` turns it into `allowedDevOrigins: ["*.<domain>"]` (port stripped), so hot reload works through the proxy. Dev ports stay within 4100–4199.
- `egress`: `registry.npmjs.org`

The template owner provides `/opt/kiln/templates/nextjs`, a ready app with `node_modules` and a pnpm store warmed in the runner image (`runners/images/studio`, tagged `kiln-runner-studio:local`), so the first preview takes about 10 seconds. The template data is in `templates/templates.json`; `TEMPLATES` must match it. `StudioOptions.image` comes from `KILN_STUDIO_IMAGE`, else `KILN_RUNNER_IMAGE`.

## App source and import

An App starts from a template or from an existing repository (`source.kind`). Preview, versions and chats work the same for both.

Import (`source.kind: "repo"`):

1. **Clone.** `StudioOptions.clone(source)` returns a clone URL with a short-lived, repo-scoped token (the API builds it from the forge interface: `cloneUrl` + `sandboxToken`). Studio clones it into `<workdir>/app` and checks out `branch` (default: the repository's default branch). That branch becomes `setup.mainBranch`. Studio then removes the `origin` remote, so the token doesn't stay in the workspace.
2. **Package manager** from the lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun, else npm. `install` is `pnpm install --prefer-offline`, `yarn install`, `bun install`, or `npm install --no-audit --no-fund` (plus `--no-package-lock` when the repository has no lockfile).
3. **Install on first open.** It runs once when the workspace is created; snapshots keep later opens warm. Each new chat worktree installs again (with a warm store, this is fast).
4. **Dev command.** `package.json` `scripts.dev` → `<pm> run dev`, recorded as `devDetected`. A person can set `devOverride` (`PATCH … { devCommand }`; `null` clears it). With neither, the App is `ready` but previews answer `StudioError("invalid", "no dev command")`.
5. **Port.** The dev server gets `PORT={port}` and `HOST=0.0.0.0`. For `next dev` and `vite` without an explicit port, Studio appends `--port {port}` (and `--hostname`/`--host 0.0.0.0`). If the server prints a different `localhost:<n>` / `0.0.0.0:<n>` URL in its first output, Studio records that port for the target.
6. **Environment.** Required keys come from `.env.example`, `.env.sample` or `.env.local.example`. `StudioOptions.env(app)` (the API resolves the team's Kiln secrets and environment templates, and later its Kiln Project's) provides values. They're passed to installs, dev servers and harness runs and never written to the repository. Missing keys are listed in `setup.envMissing`. The App is still `ready`, and the UI shows them with a link to Secrets.

**Ship mode on imported repositories (decided).** An imported App defaults to `review`: its forge sync opens a pull request and never pushes to the default branch. `cowboy` is allowed, but on an imported repository it pushes only to a `studio/<app id>` branch, never the default branch. Template Apps keep the `cowboy` default. Inside the sandbox the modes behave as in the ship mode table (cowboy auto-applies to the App's main line). Nothing in phases 1–4 pushes.

## Workspace layout (inside the App's sandbox)

```
<workdir>/app              main repository, branch setup.mainBranch; the versions
<workdir>/chats/<chatId>   git worktree, branch chat/<chatId>
<workdir>/version          detached worktree for previewing an old version
```

`.kiln/` is listed in `.git/info/exclude`, so `.kiln/studio.json` (`{ title, summary, question? }`, written by the agent at the end of a turn) is never committed.

## Service (`packages/studio/src/studio.ts`)

```ts
export type StudioOptions = {
  store: Store;
  objects: ObjectStore;
  bus: EventBus;
  clock: Clock;
  sandboxes: SandboxProvider; // one backend for Studio
  harness: (type: HarnessType) => HarnessAdapter;
  credentials?: (app: App, type: HarnessType) => Record<string, string>;
  templates?: Record<string, Template>; // default TEMPLATES
  image?: string; // fallback runner image
  previewUrl: (target: string, address: SandboxAddress) => string;
  /** Imported Apps: a clone URL with a short-lived repo-scoped token, and the branch to use. */
  clone?: (source: Extract<AppSource, { kind: "repo" }>) => Promise<{ url: string; branch?: string }>;
  /** Environment for installs, dev servers and runs (Kiln secrets and environment templates). */
  env?: (app: App) => Record<string, string>;
  maxRunningChats?: number; // default 3
  basePort?: number; // the version preview's port; chats use the next 99. Default 4100
};

export class Studio {
  constructor(opts: StudioOptions);

  listApps(team: string): App[];
  getApp(id: string): { app: App; chats: Chat[]; versions: Version[] } | undefined; // versions newest first
  createApp(input: { team: string; by: string; name: string; projectId?: string; source?: AppSource; shipMode?: ShipMode; harness?: HarnessType; model?: string }): Promise<App>; // default source: the nextjs template
  updateApp(id: string, patch: { name?: string; projectId?: string | null; shipMode?: ShipMode; devCommand?: string | null }): App;
  /** Resolves when a new App is ready or has failed (creation runs in the background). */
  ready(appId: string): Promise<void>;
  /** Stops every dev server, agent and sandbox without snapshotting (process shutdown, tests). */
  shutdown(): Promise<void>;
  pause(appId: string): Promise<App>; // snapshot, destroy the sandbox; the next use resumes it

  newChat(appId: string, input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string }): Promise<{ chat: Chat; turn?: Turn }>;
  getChat(id: string): { chat: Chat; turns: Turn[] } | undefined; // turns oldest first
  /** Starts a turn, or steers the running one. Resolves when the turn has started, not finished. */
  send(chatId: string, input: { by: string; via: Via; text: string; mode?: ChatMode }): Promise<{ turn: Turn; steered: boolean }>;
  /** Resolves when the chat has no running turn, including a resolve turn Studio started itself. */
  idle(chatId: string): Promise<void>;
  apply(chatId: string, by: string): Promise<ApplyResult>;
  diff(target: { chatId: string } | { versionId: string }): Promise<string>; // unified diff

  restore(versionId: string, by: string): Promise<Version>;
  bookmark(versionId: string, on: boolean): Version;
  preview(target: { chatId: string } | { versionId: string }): Promise<Preview>;

  status(input: { team: string; app?: string }): StatusReport;
  /** Address for the preview proxy; undefined for an unknown or stopped target. */
  resolvePreview(target: string): Promise<SandboxAddress | undefined>;
}

export type ApplyResult = { ok: true; version: Version } | { ok: false; conflict: string[] } | { ok: false; nothing: true };

export type StatusReport = {
  apps: { id: string; name: string; working: string[]; needsYou: { chatId: string; question: string }[]; latest?: { title: string; at: string } }[];
};

export class StudioError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "busy" | "conflict" | "unavailable", message: string);
}
```

### Behavior

- **Turn.** It persists the turn as `running`, starts the chat's harness in its worktree (cwd `chats/<id>`) with Studio's instructions for the mode and the prompt, and records activity. When the harness finishes, it reads `.kiln/studio.json`, checkpoints, and persists the turn again. Then comes ship mode (below), then a snapshot. `send` during a running turn steers it (`steered: true`).
- **Checkpoint.** `git add -A`; when there's a diff from `HEAD`, commit on the chat branch with the turn's title. When the agent committed itself, the new `HEAD` is the checkpoint. No change, no checkpoint, in every mode.
- **Modes.** In `chat` and `plan` mode, any change at the end of the turn is reverted (`git reset --hard <start> && git clean -fd`) and `discarded: true` is set. `plan` stores the reply as `plan`. "Build it" is `send({ text: plan, mode: "build" })`.
- **Apply.** In `app`: `git merge --no-ff -m <title> chat/<id>`. The title is the subjects of the chat's non-merge commits not yet on the main line, joined with "; " and cut to 80 characters. On a conflict it runs `git merge --abort`, sets the chat to `conflict` and returns the files. `{ nothing: true }` when the chat has no new commits.
- **Ship mode.** `cowboy`: after every turn with a checkpoint, apply. On a conflict, start a resolve turn (`resolve: true`) that tells the agent to run `git merge <main>`, fix the conflicts and commit, then apply again. If that conflicts too, the chat becomes `needs_you` with the conflicting files as the question. `safe` and `review`: the person applies. Nothing pushes, opens a PR or merges outside the sandbox in phases 1–4.
- **Restore.** `git read-tree -u --reset <sha>`, then commit "Restore: <title>". This records a `restore` version; history is never rewritten.
- **Preview.** A dev server per chat worktree on `chat.port`, and one for `version` on `basePort`, started with `setup.dev` through `sandbox.spawn`. `url` is `previewUrl(target, await sandbox.expose(port))`. An App has at most 99 chats, so ports stay within 4100–4199.
- **Limits.** If `maxRunningChats` turns are already running in the App, `send` throws `StudioError("busy")`.
- **Durability.** Every step persists before and after it runs. After each turn the sandbox is snapshotted to `objects`, and an App whose sandbox isn't in memory resumes from `snapshot` (worktrees are repaired, because their paths may change). Dev servers start again lazily. Time comes only from `clock`.
- **Sandboxes** carry the labels `kiln.studio.app: <id>` and `kiln.dev/preview: "true"`.

## Events (`packages/events`, added to `KilnEventMap`)

```ts
"studio.turn_started":    { appId: string; chatId: string; turnId: string; priority: "progress" };
"studio.turn_finished":   { appId: string; chatId: string; turnId: string; title?: string; summary?: string; changed: boolean; priority: "finished" };
"studio.version_created": { appId: string; versionId: string; title: string; kind: VersionKind; priority: "finished" };
"studio.needs_you":       { appId: string; chatId: string; question: string; reason: "question" | "conflict" | "failed"; priority: "needs_you" };
```

## Tools (`packages/studio/src/tools.ts`)

```ts
export type ToolKind = "server" | "client";
export type StudioTool<I extends z.ZodType, N extends string> = { name: N; kind: ToolKind; description: string; input: I };
export const STUDIO_TOOLS: readonly StudioTool[];
export function runTool(studio: Studio, name: string, input: unknown, caller: ToolCaller): Promise<ToolResult>;
export type ToolCaller = { team: string; by: string; via: Via };
export type ToolResult = { ok: true; data: unknown; client?: ClientAction } | { ok: false; error: string };
export type ClientAction = { focus: { app: string; chat?: string } } | { show: "preview" | "code" | "history" };
```

| Name       | Kind   | Input (zod)                                                                                                                                  |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | server | `{ app?: string }`                                                                                                                           |
| `open_app` | server | `{ app: string } \| { name: string; source?: AppSource; shipMode?: ShipMode; projectId?: string }`; returns the App plus `client: { focus }` |
| `new_chat` | server | `{ app: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string; title?: string }`; returns `client: { focus }`      |
| `send`     | server | `{ chat: string; text: string; mode?: ChatMode }`                                                                                            |
| `apply`    | server | `{ chat: string }`                                                                                                                           |
| `restore`  | server | `{ version: string }`                                                                                                                        |
| `bookmark` | server | `{ version: string; on: boolean }`                                                                                                           |
| `look`     | server | `{ chat: string }`; returns the `Preview` (a screenshot is a follow-up)                                                                      |
| `focus`    | client | `{ app: string; chat?: string }`                                                                                                             |
| `show`     | client | `{ view: "preview" \| "code" \| "history" }`                                                                                                 |

Client tools return `{ ok: true, data: null, client }` and change nothing on the server. Every server tool acts only on the caller's team's Apps; another team's App answers "unknown app".

## API (`apps/api/src/routes/studio.ts`)

Every route needs a signed-in caller (`ctx.user`). Apps belong to `ctx.team(c)`; an App of another team answers 404. Bodies are validated with the zod schemas above. A `StudioError` maps `not_found` → 404, `invalid` → 400, `busy` and `conflict` → 409, `unavailable` → 503.

| Method and path                              | Body                                                         | Response                                                              |
| -------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /api/v1/studio/apps`                    |                                                              | `{ apps: App[] }`                                                     |
| `POST /api/v1/studio/apps`                   | `{ name, projectId?, source?, shipMode?, harness?, model? }` | `App` (status `creating`; poll until `ready`)                         |
| `GET /api/v1/studio/apps/{id}`               |                                                              | `{ app, chats: Chat[], versions: Version[] }` (versions newest first) |
| `PATCH /api/v1/studio/apps/{id}`             | `{ name?, projectId?, shipMode?, devCommand? }`              | `App`                                                                 |
| `POST /api/v1/studio/apps/{id}/pause`        |                                                              | `App`                                                                 |
| `POST /api/v1/studio/apps/{id}/chats`        | `{ prompt?, mode?, harness?, model?, title? }`               | `{ chat: Chat, turn?: Turn }`                                         |
| `GET /api/v1/studio/chats/{id}`              |                                                              | `{ chat, turns: Turn[] }` (oldest first)                              |
| `POST /api/v1/studio/chats/{id}/messages`    | `{ text, mode? }`                                            | `{ turn: Turn, steered: boolean }`                                    |
| `POST /api/v1/studio/chats/{id}/apply`       |                                                              | `ApplyResult`                                                         |
| `GET /api/v1/studio/chats/{id}/diff`         |                                                              | `{ diff: string }` (since the chat branched or was last applied)      |
| `GET /api/v1/studio/chats/{id}/preview`      |                                                              | `Preview` (starts the dev server if needed)                           |
| `GET /api/v1/studio/chats/{id}/events`       |                                                              | SSE: `turn` (a `Turn`, on every change) and `chat` (a `Chat`)         |
| `POST /api/v1/studio/versions/{id}/restore`  |                                                              | `Version`                                                             |
| `POST /api/v1/studio/versions/{id}/bookmark` | `{ on: boolean }`                                            | `Version`                                                             |
| `GET /api/v1/studio/versions/{id}/diff`      |                                                              | `{ diff: string }` (against its parent version)                       |
| `GET /api/v1/studio/versions/{id}/preview`   |                                                              | `Preview` (checks the version out in `version`)                       |
| `GET /api/v1/studio/status`                  |                                                              | `StatusReport`                                                        |
| `POST /api/v1/studio/tools/{name}`           | the tool's input                                             | `ToolResult`                                                          |

### Preview proxy (`apps/api/src/routes/studio-preview.ts`, a `PUBLIC_MODULES` entry)

- `KILN_STUDIO_PREVIEW_DOMAIN` set (e.g. `preview.kiln.example.com`): `previewUrl(target) = https://<label>.<domain>`, where `<label>` is the target id with `_` replaced by `-` (`sc_3f…` → `sc-3f…`): DNS labels and wildcard certificates don't allow `_`, and browsers lowercase host names, so a target id's random suffix must be lowercase letters and digits (32 hex characters for 128 bits). A domain ending in `.localhost` (optionally with a port, e.g. `preview.localhost:4000`) gives `http://` URLs for local development. The proxy matches `Host: <label>.<domain>` only, calls `studio.resolvePreview(target)` and forwards the request (method, path, query, headers minus `cookie`, `authorization` and `x-kiln-*`, body) to `http://<host>:<port>`; it drops `set-cookie` from the response. An unknown, stopped or malformed target answers the same 404. Every other host goes to `next()`. The target id carries 128 bits of randomness and is the only credential; Kiln cookies never reach the preview origin.
- The proxy finds Studio through `setPreviewResolver(kiln, studio)` (exported by `routes/studio-preview.ts`), which `routes/studio.ts` calls when it builds the Studio service. `previewUrlFor(env)` from the same file is the `previewUrl` option for `Studio`.
- Unset (local development): `previewUrl = http://<address.host>:<address.port>`, and nothing is proxied.
- WebSocket upgrades for hot reload are proxied in `apps/api/src/main.ts` (Node `upgrade`) by the same rules. The web page still reloads the iframe on `turn_finished`.

## SDK (`packages/sdk-ts`), used by the web page and MCP

```ts
studioApps(): Promise<{ apps: App[] }>;
studioCreateApp(input): Promise<App>;
studioApp(id): Promise<{ app: App; chats: Chat[]; versions: Version[] }>;
studioUpdateApp(id, patch): Promise<App>;
studioPauseApp(id): Promise<App>;
studioNewChat(appId, input): Promise<{ chat: Chat; turn?: Turn }>;
studioChat(id): Promise<{ chat: Chat; turns: Turn[] }>;
studioSend(chatId, { text, mode? }): Promise<{ turn: Turn; steered: boolean }>;
studioApply(chatId): Promise<ApplyResult>;
studioChatDiff(chatId): Promise<{ diff: string }>;
studioChatPreview(chatId): Promise<Preview>;
studioRestore(versionId): Promise<Version>;
studioBookmark(versionId, on): Promise<Version>;
studioVersionDiff(versionId): Promise<{ diff: string }>;
studioVersionPreview(versionId): Promise<Preview>;
studioStatus(): Promise<StatusReport>;
studioTool(name, input): Promise<ToolResult>;
```

The SDK re-declares these types (it doesn't depend on `packages/studio`), and a test checks they stay assignable.

## Web page (`apps/web/src/app/studio`)

- `/studio` lists Apps, with a "New app" form: name, ship mode, an optional Kiln Project, and a source that is either a template or an existing repository. Repositories are listed with the existing `api.forgeRepositories()`, plus an optional branch. An App with `setup.envMissing` shows the missing keys with a link to Secrets; the dev command can be overridden in the App's settings.
- `/studio/[app]` has the chat rail on the left and the preview on the right.
- **Chat rail.** One chat tab per chat and "+" for a new one. Turns are shown with the AI Elements `Message` / `MessageScroller`. A turn with a checkpoint shows a version card with the title, **Details** (diff) and **Preview**. The composer is `PromptInput` with a Build/Chat/Plan mode picker (⌥P). A plan card has **Build it**. A chat in `conflict` or `needs_you` shows the question. Without cowboy mode, an **Apply** button shows when the chat has unapplied checkpoints.
- **Top bar.** History and Bookmarks panels (versions; bookmark toggle; preview a version with a "Previewing" banner, **Restore** and **Back to latest**), a ship-mode picker, and a needs-you badge from `studioStatus()`.
- **Preview pane.** Preview and Code tabs (Code shows the chat diff), a route field, reload, and open in a new tab. It reloads on `turn_finished`.
- **Server actions** call `api.studio*` (the `lib/kiln.ts` proxy); the page polls `studioChat` every 2 s while a turn runs, or uses the SSE route once it exists.

## App definitions

Specified in [App definitions](app-definitions.md). What other Studio work builds against:

- `@kiln/schema`: `AppManifest` (`app.yaml`), `AppPolicy` (`policies/<name>.yaml` in an App tree) and `AppShipMode` (the same values as `ShipMode`).
- An App's agents are factory agents (`agents/<name>/agent.md`: model, MCP servers, skills, `spawnableBy`), resolved with the factory's `resolveAgent`. Every App has a `general` agent from the built-in layer, so nothing needs configuring.
- `@kiln/studio`: `AppDefinitions` (content-hashed layers team → Kiln Project → App, store collections `studio_app_definitions` and `studio_app_definition_refs`) and

  ```ts
  chatConfig(targetOf(app), opts?: { agent?: string; harness?: HarnessType; model?: string }): ChatAgentConfig
  ```

  The turn runner calls it before `harness.start` for the chat's agent (`new_chat({ agent? })`, default `general`) and for each agent it spawns as a subagent run. It appends `instructions` (the agent's instructions plus every mandatory skill) to the mode instructions, passes `skills` as `StartOptions.skills`, records `definitionSha` on the turn, and resolves `mcpServers` through a `StudioOptions` hook the API provides. A chat's explicit harness or model overrides the definition's. An unknown agent throws `StudioError("invalid")`. Ship mode caps (overall and per team role), the imported-App default-branch opt-in and the merge gate switch live only in the App definition's policies: read them with `appDefinitions.policy(targetOf(app))` (`AppPolicySummary`, with who changed each and when) and `maxShipMode(policy, role)`. Both switches are off by default.
- API: `apps/api/src/routes/studio-definitions.ts` (`/api/v1/studio/{apps/{id},projects/{id},team}/definition` and `/settings`, `/api/v1/studio/apps/{id}/definition/export`); `appDefinitionsFor(kiln)` returns the instance `routes/studio.ts` should pass to `Studio`.
- Web: `apps/web/src/components/studio-settings/` exports `AppSettingsView({ scope, settings, canEditPolicy })` and `APP_SETTINGS_NAV`, which the `/studio` pages mount inside a `SettingsColumn` (for example at `/studio/[app]/settings`, with `settings = await api.studioSettings({ app })`).

## Later (not built in phases 1–4)

These types are recorded so later work and the UI agree on them. None of this is built yet, and no forge pushing exists.

**Ship flow.** A `ship` tool (server) opens or updates the App's pull request from its main line, and its state moves through **UAT** → **ready for review** → **merged** or **cancelled** (ADR-012). Ready for review adds an Inbox item for the App's reviewers.

```ts
export const PullRequestState = z.enum(["uat", "ready_for_review", "merged", "cancelled"]);
export type AppPullRequest = {
  id: string; // "sp_…"
  appId: string;
  forge: string;
  repo: string; // "owner/name"
  number: number;
  url: string;
  branch: string; // "studio/<app id>" on imported repositories
  state: PullRequestState;
  previewUrl?: string; // the deployment preview, when a preview provider is configured
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
// tool:  ship  { app: string; title?: string; state?: "uat" | "ready_for_review" | "cancelled" }
// event: "studio.pull_request_state_changed": { appId; pullRequestId; state: PullRequestState; priority: "needs_you" (ready_for_review, for reviewers) | "finished" }
// store: studio_pull_requests
```

**Forge sync per ship mode.** `review` opens the pull request above. `cowboy` pushes `main` for a template App, or the `studio/<app id>` branch for an imported one. ADR-012's guards apply: a push credential scoped to the one repository, the exception ending when the repository is coupled to a factory, and every agent push in the audit log.

### Merge gate (ADR-014)

Contract: [merge-gate.md](merge-gate.md). Ship calls the gate when the author marks the App's pull request ready for review, never when it is only opened. `packages/studio` redeclares these types structurally (no `@kiln/engine` import); `apps/api/src/routes/studio.ts` passes `kiln.mergeGate` as `StudioOptions.mergeGate` (or the Shipper's option) and registers the App switch with `kiln.mergeGate.useAppPolicy((appId) => <resolved App policy>.mergeGate)`.

```ts
export interface StudioMergeGate {
  readyForReview(input: {
    scope: { kind: "app"; appId: string; team: string };
    repo: string; // AppPullRequest.repo, "owner/name"
    number: number; // AppPullRequest.number
    by: string; // the author who marked it ready
    pullRequestId: string; // AppPullRequest.id
    preview?: { url?: string; status: "ready" | "failed" | "none" }; // AppPullRequest.previewUrl, when there is one
    tests?: "passed" | "failed" | "none";
    areas?: string[]; // the parts of the app it touches, if Studio knows them
    link?: string; // the App in Studio, where a reviewer opens it
  }): Promise<{ outcome: "merged" } | { outcome: "review"; reasons: string[] }>;
  pullRequestClosed(input: { repo: string; number: number; merged: boolean; by?: string }): unknown;
}
```

- `merged`: set the `AppPullRequest` to `merged`. `review`: set it to `waiting_for_review` with `reasons`.
- The gate creates the Inbox item (`studio_pr_review`, for the team's owners and admins) and the one needs-you event, `merge_gate.review_updated` (`{ reviewId; appId; pullRequestId; repo; number; state; priority }`). Ship adds no Inbox item and emits no `needs_you` event for `waiting_for_review`.
- A person's later merge reaches the gate through the forge webhook; ship follows `merge_gate.review_updated` with `state: "merged"` (or its own `forgeMerged`) to set `merged`.
- Cancelling a pull request that is `waiting_for_review`: call `pullRequestClosed({ repo, number, merged: false })` so the Inbox item clears.
- The switch is the App definition's `mergeGate` policy, off by default. Studio never turns it on.

**Coupling to a factory** (optional per App) and **Kiln Project environments** inherited by previews.

## Acceptance

1. `expose` returns a reachable address on local, Docker and Kubernetes (fake command runner) and throws `SandboxNotReachable` for a Docker sandbox without a network. (Done.)
2. A build turn that edits files makes one checkpoint; a question makes none; a chat-mode turn that edits files leaves no change and is marked `discarded`.
3. In `cowboy` mode every changed turn becomes a version on the main line, with one chat or several. In `safe` and `review`, nothing reaches it until Apply.
4. When two chats change the same line, the second apply conflicts, the resolve turn runs, and on success both changes are on the main line; otherwise the chat is `needs_you`.
5. Restore makes a new version whose tree equals the old one, and the earlier versions stay.
6. Tools validate input with zod and act through `Studio`; client tools change nothing.
7. Studio events carry their priority.
8. The API serves the routes for the caller's team only, the MCP tools call them, and `/studio` shows chats, preview, version cards, History and Bookmarks.

## Follow-ups

A Kubernetes ingress policy for previews (written in the Helm chart, pending security review); screenshots for `look`; idle pause on a timer; the later items above; voice (ADR-013).
