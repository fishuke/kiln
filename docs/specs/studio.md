# Studio: phases 1–4 (contract)

Decision: [ADR-012](../adr/0012-studio.md) · Idea: [Studio](../ideas/studio.md). Voice ([ADR-013](../adr/0013-voice.md)) and coupling an App to a factory are later phases; shipping is in [Shipping](#shipping). Dictation in the composer is optional and may be skipped.

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

- `packages/studio` depends on `@kiln/sandbox`, `@kiln/harness`, `@kiln/store`, `@kiln/events`, `@kiln/schema` and (for shipping) the forge interface in `@kiln/integrations`, never on `@kiln/engine` or `apps/*`. `Clock` is redeclared structurally (`{ now(): Date }`).
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
  title?: string; // one line, from .kiln/studio.json, else the reply's first line, else "Changes"
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

Store collections: `studio_apps`, `studio_chats`, `studio_turns` and `studio_versions`, each keyed by `id`; shipping adds `studio_repos` (the App's forge repository and whether Kiln created it), `studio_ship_choices` and `studio_pull_requests`.

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

The template owner provides `/opt/kiln/templates/nextjs`, a ready app with `node_modules` and a pnpm store warmed in the runner image (`runners/images/studio`, tagged `kiln-runner-studio:local`), so the first preview takes about 10 seconds. The template data is in `templates/templates.json`; `TEMPLATES` must match it. `StudioOptions.image` comes from `KILN_STUDIO_IMAGE`, else `KILN_RUNNER_IMAGE`, else the engine's `DEFAULT_RUNNER_IMAGE` (`node:22-bookworm`), the same fallback agent runs use.

## App source and import

An App starts from a template or from an existing repository (`source.kind`). Preview, versions and chats work the same for both.

Import (`source.kind: "repo"`):

1. **Clone.** `StudioOptions.clone(source)` returns a clone URL with a short-lived, repo-scoped token (the API builds it from the forge interface: `cloneUrl` + `sandboxToken`). Studio passes it as the sandbox's one repository (`repos: [{ name: "app", url }]`, no branch), so the provider clones it into `<workdir>/app` and allows the clone host through the egress proxy. Studio then checks out `source.branch` (default: the repository's default branch). That branch becomes `setup.mainBranch`. Studio then removes the `origin` remote, so the token doesn't stay in the workspace.
2. **Package manager** from the lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun, else npm. `install` is `pnpm install --prefer-offline`, `yarn install`, `bun install`, or `npm install --no-audit --no-fund` (plus `--no-package-lock` when the repository has no lockfile).
3. **Egress.** An imported App's sandbox may reach `registry.npmjs.org` (and the clone host while it's created). A registry the repository's lockfile names elsewhere is not allowed yet (open question).
4. **Install on first open.** It runs once when the workspace is created; snapshots keep later opens warm. Each new chat worktree installs again (with a warm store, this is fast).
5. **Dev command.** `package.json` `scripts.dev` → `<pm> run dev`, recorded as `devDetected`. A person can set `devOverride` (`PATCH … { devCommand }`; `null` clears it). With neither, the App is `ready` but previews answer `StudioError("invalid", "no dev command")`.
6. **Port.** The dev server gets `PORT={port}` and `HOST=0.0.0.0`. For `next dev` and `vite` without an explicit port, Studio appends `--port {port}` (and `--hostname`/`--host 0.0.0.0`). If the server prints a different `localhost:<n>` / `0.0.0.0:<n>` URL in its first output, Studio records that port for the target.
7. **Environment.** Required keys come from `.env.example`, `.env.sample` or `.env.local.example` and only drive the list of missing keys. `StudioOptions.env(app)` provides values: the API resolves the App's environment variables (team → Kiln Project → App, see [Spec change: environments](#spec-change-environments)), only what people assigned, never the secret vault. They're passed to installs, dev servers and harness runs and never written to the repository; secret values are redacted from turn and dev-server output. Missing keys are listed in `setup.envMissing`. The App is still `ready`, and the UI shows them with a link to its environment.

**Ship mode on imported repositories (decided).** An imported App defaults to `review`. Inside the sandbox the modes behave as in the ship mode table (cowboy auto-applies to the App's main line). What reaches the forge is in [Shipping](#shipping).

**Import authorization.** An import is allowed only for a repository the caller's team may use: `ctx.checkOrgs` (the team's enabled GitHub orgs) runs in `POST /apps` and in the `open_app` tool before Studio is called. `source.connection` must be one of the team's forge connections; without it, the server's forge is used, under the same org check.

**App environment.** An App's environment comes only from values a person assigned to it (the `project-env` resolver: team → Kiln Project → App). Studio never resolves the keys of an example env file through the secret vault, which would fall back to server secrets. Until `project-env` is merged, an App's environment is empty and every required key is listed as missing.

## Workspace layout (inside the App's sandbox)

```
<workdir>/app              main repository, branch setup.mainBranch; the versions
<workdir>/chats/<chatId>   git worktree, branch chat/<chatId>
<workdir>/version          detached worktree for previewing an old version
```

`.kiln/` is listed in `.git/info/exclude`, so `.kiln/studio.json` (`{ title, summary, question? }`, written by the agent at the end of a turn) is never committed.

## Enabling Studio and restarts

- Studio is on only when the server sets `KILN_STUDIO=1`. Otherwise every Studio route answers 503 `Studio is not enabled on this server (KILN_STUDIO=1)`, and no preview resolver is registered.
- On startup, Studio reconciles what a restart cut off: an App still `creating` becomes `failed` ("interrupted by a restart"); a `running` turn becomes `failed` with the same reason; a `working` chat becomes `needs_you` with that turn's failure as the question. Paused and ready Apps resume lazily from their snapshot.

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
  image: string; // runner image when the template names none (see Template)
  previewUrl: (target: string, address: SandboxAddress) => string;
  /** Imported Apps: a clone URL with a short-lived repo-scoped token, and the branch to use. */
  clone?: (source: Extract<AppSource, { kind: "repo" }>) => Promise<{ url: string; branch?: string }>;
  /** Environment for installs, dev servers and runs: the App's resolved variables (team → project → App). */
  env?: (app: App) => Record<string, string>;
  maxRunningChats?: number; // default 3
  basePort?: number; // the version preview's port; chats use the next 99. Default 4100
  previewDomain?: string; // KILN_STUDIO_PREVIEW_DOMAIN, passed to dev servers (see Template)
  fetch?: typeof fetch; // for the preview ready check; default global fetch
};

export class Studio {
  constructor(opts: StudioOptions);

  listApps(team: string): App[];
  getApp(id: string): { app: App; chats: Chat[]; versions: Version[] } | undefined; // versions newest first
  createApp(input: { team: string; by: string; name: string; projectId?: string; source?: AppSource; harness?: HarnessType; model?: string }): Promise<App>; // ship mode: the default for the source // default source: the nextjs template
  updateApp(id: string, patch: { name?: string; projectId?: string | null; devCommand?: string | null }): App; // ship mode: ship's setShipMode
  /** Resolves when a new App is ready or has failed (creation runs in the background). */
  ready(appId: string): Promise<void>;
  /** Stops every dev server, agent and sandbox without snapshotting (process shutdown, tests). */
  shutdown(): Promise<void>;
  pause(appId: string): Promise<App>; // snapshot, destroy the sandbox; the next use resumes it

  newChat(appId: string, input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string }): Promise<{ chat: Chat; turn?: Turn }>;
  getChat(id: string): { chat: Chat; turns: Turn[] } | undefined; // turns oldest first
  getVersion(id: string): Version | undefined;
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
- **Ship mode.** `cowboy`: after every turn with a checkpoint, apply. On a conflict, start a resolve turn (`resolve: true`) that tells the agent to run `git merge <main>`, fix the conflicts and commit, then apply again. If that conflicts too, the chat becomes `needs_you` with the conflicting files as the question. `safe` and `review`: the person applies. What reaches the forge is in [Shipping](#shipping).
- **Restore.** `git read-tree -u --reset <sha>`, then commit "Restore: <title>". This records a `restore` version; history is never rewritten.
- **Ready check.** A dev server is `starting` until GET `ready.path` on its port answers (any status), polled every 200 ms, and `failed` after `ready.timeoutMs`; a dev server whose process ends is started again by the next preview. Imported Apps use `{ path: "/", timeoutMs: 60000 }`, the same as the Next.js template.
- **Preview.** A dev server per chat worktree on `chat.port`, and one for `version` on `basePort`, started with `setup.dev` through `sandbox.spawn`. `url` is `previewUrl(target, await sandbox.expose(port))`. An App has at most 99 chats, so ports stay within 4100–4199.
- **Limits.** If `maxRunningChats` turns are already running in the App, `send` throws `StudioError("busy")`.
- **Durability.** Every step persists before and after it runs. After each turn the sandbox is snapshotted to `objects`, and an App whose sandbox isn't in memory resumes from `snapshot` (worktrees are repaired, because their paths may change). Dev servers start again lazily. Time comes only from `clock`.
- **Sandboxes** carry the label `kiln.studio.app: <id>` and `preview: true`, which puts them on the preview network (Docker) or gives them `kiln.dev/preview: "true"` (Kubernetes).

## Chats reuse runs and subagents (next; supersedes the direct harness turn above)

ADR-012: every agent execution in a chat is a **run**, and parallel work is **subagent runs**, exactly as in factories ([Tasks, runs and subagents](../site/developer-tools/tasks-and-runs.md)). Studio builds no lead/child mechanism of its own. Built today: a turn calls `harness.start` directly. This section replaces that; nothing below is built yet.

**What maps to what**

| Studio                            | Runs                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A turn                            | One run of the App's lead agent (from the App definition), `source: "WEB_APP"` (or `MCP`), `metadata: { "studio.app": <appId>, "studio.chat": <chatId> }`                                                               |
| A person's next message in a chat | `RunService.followup(chat.runId, …)`: steers the live run, or continues the finished one in a new run (`continuationOf`)                                                                                                |
| A chat started by an agent        | `spawn_agent` / `run_agents` from the chat's run with its run token; `spawnableBy` and the five-level limit apply. The child run gets its own worktree, branch and preview (below), and Studio shows it as a child chat |
| Stop                              | `RunService.interrupt` (the run is `blocked` until a follow-up)                                                                                                                                                         |
| Agent types                       | The agents of the App definition (`app-definitions` branch), with their `spawnableBy`                                                                                                                                   |
| Status                            | The App's run trees (`ancestor_run_id`), read through Studio's routes                                                                                                                                                   |

`Turn` becomes Studio's record of a run: `Turn.runId` is added, and `checkpoint`, `discarded`, `plan`, `title` and `summary` stay Studio's. `Chat.runId` is the latest run of that line of work. The parent/child relation comes from `Run.parentRunId`; Chat gets no parent field of its own.

**Additions to the shared run machinery** (for factories too; not in `gates.ts` or `state.ts`):

1. **Workspace hook.** `KilnOptions.workspaces?: { acquire(run: Run, parent?: Run): Promise<{ sandbox: Sandbox; cwd: string } | undefined>; release(run: Run): Promise<void> }`. When `acquire` returns a workspace, the run executes there instead of creating its own sandbox. It doesn't clone, doesn't destroy the sandbox at the end, and records `startState.repos` from `cwd`'s `HEAD`. Studio's provider answers for runs with `studio.app` metadata: the App sandbox, plus a new worktree for a child run.
2. **Report to the parent.** `spawn` takes `report?: boolean`. When the child finishes (`succeeded`, `failed`, `blocked` after an interrupt, or a budget stop) or asks a question, Kiln delivers `{ name, title, summary, branch, reason, question? }` to the parent with `followup`. That steers the parent if it's live, or starts its next run if it finished. This replaces polling and mirrors how `run_finished` wakes the foreman (ADR-011).
3. **Fork.** `spawn` takes `fork?: boolean`: the child's prompt starts with the parent's conversation, taken from its transcript; by default it gets only the brief.
4. **Name.** `spawn` takes `name?`, unique among the runs of one root tree, and `followups` accept a name within the caller's tree as well as an id.

**Open decisions (need an answer before building):**

- **App runs and factories.** `Run.factory` and `definitionSha` resolve through `kiln.defs`. Either App definition trees are stored in the same content-addressed definition store with an App id in place of a factory id, or runs get an `app` field and `RunService` resolves App definitions through `AppDefinitions`. Recommended: the second, because App definitions are layered (team → Kiln Project → App).
- **Reading App runs.** `/runs` access is decided in `canReadRun` in `apps/api/src/app.ts` (protected). Either App runs are readable only through Studio's routes (no protected change), or `canReadRun` learns App team access (needs approval). Recommended: Studio's routes first.
- **Run tokens for App runs.** They are scoped to the App's run tree, may spawn, follow up, interrupt and call the Studio tools for that App only, and never decide gates, merge or approve (ADR-008). The cowboy push credential is a separate, ship-mode-scoped grant (ADR-012).

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

| Name       | Kind   | Input (zod)                                                                                                                             |
| ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | server | `{ app?: string }`                                                                                                                      |
| `open_app` | server | `{ app: string } \| { name: string; source?: AppSource; projectId?: string }`; returns the App plus `client: { focus }`                 |
| `new_chat` | server | `{ app: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string; title?: string }`; returns `client: { focus }` |
| `send`     | server | `{ chat: string; text: string; mode?: ChatMode }`                                                                                       |
| `apply`    | server | `{ chat: string }`                                                                                                                      |
| `restore`  | server | `{ version: string }`                                                                                                                   |
| `bookmark` | server | `{ version: string; on: boolean }`                                                                                                      |
| `look`     | server | `{ chat: string }`; returns the `Preview` (a screenshot is a follow-up)                                                                 |
| `focus`    | client | `{ app: string; chat?: string }`                                                                                                        |
| `show`     | client | `{ view: "preview" \| "code" \| "history" }`                                                                                            |

Client tools return `{ ok: true, data: null, client }` and change nothing on the server. Every server tool acts only on the caller's team's Apps; another team's App answers "unknown app".

## API (`apps/api/src/routes/studio.ts`)

Every route needs a signed-in caller (`ctx.user`) and a token scope: reads need `read` and changes need `send`, both team-wide (`ctx.need(c, scope, "*")`). Apps belong to `ctx.team(c)`; an App of another team answers 404. Bodies are validated with the zod schemas above. A `StudioError` maps `not_found` → 404, `invalid` → 400, `busy` and `conflict` → 409, `unavailable` → 503.

| Method and path                              | Body                                              | Response                                                                                                   |
| -------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/studio/apps`                    |                                                   | `{ apps: App[] }`                                                                                          |
| `POST /api/v1/studio/apps`                   | `{ name, projectId?, source?, harness?, model? }` | `App` (status `creating`; poll until `ready`)                                                              |
| `GET /api/v1/studio/apps/{id}`               |                                                   | `{ app, chats: Chat[], versions: Version[] }` (versions newest first)                                      |
| `PATCH /api/v1/studio/apps/{id}`             | `{ name?, projectId?, devCommand? }`              | `App`                                                                                                      |
| `POST /api/v1/studio/apps/{id}/pause`        |                                                   | `App`                                                                                                      |
| `POST /api/v1/studio/apps/{id}/chats`        | `{ prompt?, mode?, harness?, model?, title? }`    | `{ chat: Chat, turn?: Turn }`                                                                              |
| `GET /api/v1/studio/chats/{id}`              |                                                   | `{ chat, turns: Turn[] }` (oldest first)                                                                   |
| `POST /api/v1/studio/chats/{id}/messages`    | `{ text, mode? }`                                 | `{ turn: Turn, steered: boolean }`                                                                         |
| `POST /api/v1/studio/chats/{id}/apply`       |                                                   | `ApplyResult`                                                                                              |
| `GET /api/v1/studio/chats/{id}/diff`         |                                                   | `{ diff: string }` (since the chat branched or was last applied)                                           |
| `GET /api/v1/studio/chats/{id}/preview`      |                                                   | `Preview` (starts the dev server if needed)                                                                |
| `GET /api/v1/studio/chats/{id}/events`       |                                                   | SSE, driven by the chat's `studio.*` bus events: `chat` (a `Chat`) and `turn` (the `Turn` the event names) |
| `POST /api/v1/studio/versions/{id}/restore`  |                                                   | `Version`                                                                                                  |
| `POST /api/v1/studio/versions/{id}/bookmark` | `{ on: boolean }`                                 | `Version`                                                                                                  |
| `GET /api/v1/studio/versions/{id}/diff`      |                                                   | `{ diff: string }` (against its parent version)                                                            |
| `GET /api/v1/studio/versions/{id}/preview`   |                                                   | `Preview` (checks the version out in `version`)                                                            |
| `GET /api/v1/studio/status`                  |                                                   | `StatusReport`                                                                                             |
| `POST /api/v1/studio/tools/{name}`           | the tool's input                                  | `ToolResult`                                                                                               |

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

## Shipping

What reaches the App's forge repository, per ship mode (ADR-012), and the App's pull request. Code in `packages/studio/src/ship/`; the API wires it.

### Where a push may go

An App pushes its main line (`setup.mainBranch` in the sandbox) to exactly one of two branches of its repository:

- `studio/<app id>`: always allowed.
- **The main branch** (`main` for a template App, `setup.mainBranch` for an imported one), only when both hold:
  - (a template App **and** the repository is one Kiln created for it through `Forge.createRepository`) **or** (an imported App in `cowboy` whose App policy turns on `shipMode.pushDefaultBranch`, which only team owners and admins change and whose `changedBy` records who and when), **and**
  - the repository is not linked to a factory (`ShipperOptions.linkedToFactory(repo)`: any factory that names the repository).

`assertPushAllowed` checks this right before every push and refuses any other branch. An imported App in `cowboy` without the opt-in pushes only `studio/<app id>`. A push to an imported repository's main branch is audited with `optedInBy` and `optedInAt` from the policy's `changedBy.pushDefaultBranch`.

| Ship mode | When it pushes                                            | Where                                                      | Pull request                           |
| --------- | --------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `safe`    | Only on `ship`                                            | `studio/<app id>`                                          | `ship` opens or updates it             |
| `review`  | After every new version (apply or restore), and on `ship` | `studio/<app id>`                                          | Opened on the first push, then updated |
| `cowboy`  | After every new version                                   | The main branch when allowed above, else `studio/<app id>` | None (`ship` still opens one)          |

The initial version pushes nothing. A template App's repository is created on its first push: `ShipperOptions.newRepo(app)` names the owner, the name is the App's name as a slug plus six characters of its id, private, empty. Without `newRepo` a template App can't be pushed (`StudioError("unavailable")`).

**Credentials.** Each push asks the forge for a fresh credential scoped to that one repository (`Forge.sandboxToken(repo)`; GitHub: an installation token for that repository with `contents: write`), runs `git push "$KILN_PUSH_URL" <main>:refs/heads/<branch>` as a trusted command with the URL only in that command's environment, never adds a remote and never forces. Errors are returned with the token removed. **Audit.** Every push is in the audit log (`studio.push`: actor, repository, branch, sha, ship mode); a refused push is logged as `studio.push_refused`, a push after a turn that failed as `studio.push_failed` (with the error); repository creation as `studio.repo_created`; every pull request state change and ship-mode change too. The actor is the person who asked, or `agent:studio` for pushes after a turn.

### Ship-mode caps

```ts
export const TeamRole = z.enum(["owner", "admin", "member"]); // the team roles in packages/auth
export type ShipModeChoice = { id: string /* app id */; mode: ShipMode; by: string; role?: TeamRole; at: string }; // runtime: who picked what
```

Caps come only from the App policy: `ShipperOptions.policyOf(app)` is `appDefinitions.policy(targetOf(app))` (`AppPolicySummary`, see [App definitions](app-definitions.md)), and the highest mode a person may pick is `maxShipMode(policy, role)`. `Shipper.setShipMode(appId, mode, actor)` refuses agents and a mode above the cap (`StudioError("invalid")`), then updates the App and records the choice in `studio_ship_choices`. Every ship-mode change goes through it.

**Policies are the only truth for caps and the gate.** Ship-mode caps and the merge-gate switch come from the App definition's policies through the `app-definitions` resolver (ADR-012, ADR-014). There are no Store copies (`studio_ship_policies` and `merge_gate_settings` are not built). Neither `PATCH /apps/{id}` nor `open_app` accepts `shipMode`; a ship-mode change goes through `Shipper.setShipMode`.

### The App's pull request

**Ship flow (one contract for ship, the merge gate and the web).** A `ship` tool (server) opens or updates the App's pull request from its main line. Its state:

```text
uat ──ready──▶ ready_for_review ──gate──▶ merged
 │                    │               └──▶ waiting_for_review ──person merges──▶ merged
 └──cancel──▶ cancelled ◀──cancel─────────────┘
```

- **UAT**: the author tests it; new turns update the same pull request.
- **ready_for_review**: the author is done. Ship calls the merge gate (ADR-014) once: `readyForReview({ scope, repo, number, by, pullRequestId, preview? })` → `{ outcome: "merged" } | { outcome: "review"; reasons: string[] }`. `merged` sets the state to `merged`; `review` sets it to `waiting_for_review` with the reasons.
- **waiting_for_review**: a person reviews and merges on the forge. The merge gate, not ship, creates the reviewers' Inbox item and raises the single `needs_you` event (`merge_gate.review_updated`). Ship maps that event onto its pull request record and emits nothing for the same transition.
- **merged** (by the gate, or a person on the forge, seen through the forge webhook) and **cancelled** (the pull request is closed) are final. The gate's `pullRequestClosed({ repo, number, merged: false })` removes its Inbox item.
- The merge gate is **off by default** (ADR-014): with it off, `readyForReview` always answers `review`.

```ts
export const PullRequestState = z.enum(["uat", "ready_for_review", "waiting_for_review", "merged", "cancelled"]);
export type AppPullRequest = {
  id: string; // "spr_…"
  appId: string;
  forge: string;
  repo: string; // "owner/name"
  number: number;
  url: string;
  branch: string; // "studio/<app id>"
  base: string; // the main branch
  state: PullRequestState;
  versionId: string; // the App version its head is
  builtInPreview?: string; // Studio's preview of that version (ShipperOptions.versionPreviewUrl)
  reviewReasons?: string[]; // set with waiting_for_review
  previewUrl?: string; // the deployment preview, when a preview provider is configured
  createdBy: string; // the author
  createdAt: string;
  updatedAt: string;
};
// store: studio_pull_requests
```

- One open pull request per App. `ship` or a `review` push opens it in `uat`; later pushes update it (same branch) and set `versionId` and the previews again. A push to an App in `ready_for_review` or `waiting_for_review` moves it back to `uat` (and calls the gate's `pullRequestClosed({ repo, number, merged: false })`, so its Inbox item clears until the author is ready again).
- `ready_for_review` is set only by a person, the author (`createdBy`); actors `studio` and `agent:*` are refused.
- `cancelled` (the author or a team admin) closes the pull request on the forge (`Forge.closePullRequest`) and, when it was past `uat`, calls the gate's `pullRequestClosed({ repo, number, merged: false, by })`.
- `merged` and `cancelled` are final; the next `ship` opens a new pull request. `Shipper.reviewUpdated` maps `merge_gate.review_updated` (`merged` → `merged`, `closed` → `cancelled`); `Shipper.forgeMerged(repo, number)` records a merge seen through the forge webhook while the gate wasn't involved.

### Merge gate (ADR-014)

Contract: [merge-gate.md](merge-gate.md). Ship calls the gate when the author marks the App's pull request ready for review, never when it is only opened. `packages/studio` redeclares these types structurally (no `@kiln/engine` import); `apps/api/src/routes/studio.ts` passes `kiln.mergeGate` as `ShipperOptions.mergeGate`. The App switch is `AppDefinitions.policy(target).mergeGate`, which `apps/api/src/routes/merge-gate.ts` registers with `kiln.mergeGate.useAppPolicy`.

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

### Forge additions (`packages/integrations`)

```ts
interface Forge {
  /** An empty repository; throws RepositoryExistsError when the name is taken. GitHub: POST /orgs/{owner}/repos (or /user/repos for the token's own account). */
  createRepository?(input: { owner: string; name: string; private: boolean; description?: string }): Promise<{ repo: RepoRef; url: string }>;
  closePullRequest?(repo: RepoRef, number: number): Promise<PullRequest>;
}
```

Both have `FakeForge` and `GitHubForge` implementations and one contract suite. A GitHub App needs `administration: write` on the organization to create repositories.

### Tool and event

| Name   | Kind   | Input (zod)                                                                           |
| ------ | ------ | ------------------------------------------------------------------------------------- |
| `ship` | server | `{ app: string; title?: string; state?: "uat" \| "ready_for_review" \| "cancelled" }` |

No `state` (or `uat`) pushes and opens or updates the pull request; returns the `AppPullRequest`. `runTool` takes the `Shipper` as an optional fifth argument; without it `ship` answers "shipping isn't configured on this server".

```ts
"studio.pull_request_state_changed": { appId: string; pullRequestId: string; state: PullRequestState; url: string; priority: "finished" };
// for the transitions ship makes itself (uat, ready_for_review, cancelled, a forge merge). Never needs_you:
// the merge gate's merge_gate.review_updated is the one needs-you event for a review.
```

### Service (`packages/studio/src/ship/shipper.ts`)

```ts
export type ShipperOptions = {
  studio: Studio;
  store: Store;
  bus: EventBus;
  clock: Clock;
  forge: (app: App) => Forge | undefined; // the App's forge connection
  newRepo?: (app: App) => { owner: string } | undefined; // where template Apps' repositories are created
  linkedToFactory: (repo: string) => boolean;
  policyOf: (app: App) => AppPolicySummary; // appDefinitions.policy(targetOf(app))
  mergeGate: StudioMergeGate; // kiln.mergeGate
  previews?: PreviewProvider; // the deployment preview
  versionPreviewUrl?: (app: App, versionId: string) => string; // Studio's own preview of a version
  audit: (actor: string, action: string, target: string, details?: unknown) => void; // kiln.audit
};
export class Shipper {
  start(): () => void; // follow studio.version_created
  idle(appId: string): Promise<void>; // queued pushes done
  push(appId: string, actor: Actor): Promise<{ repo: AppRepo; branch: string; sha: string }>;
  setShipMode(appId: string, mode: ShipMode, actor: Actor): App; // the API's PATCH shipMode goes here
  ship(appId: string, input: { title?: string; state?: "uat" | "ready_for_review" | "cancelled" }, actor: Actor): Promise<AppPullRequest>;
  reviewUpdated(input: {
    pullRequestId?: string;
    repo?: string;
    number?: number;
    state: "deciding" | "merged" | "needs_review" | "closed";
    reasons?: string[];
  }): AppPullRequest | undefined;
  forgeMerged(repo: string, number: number): AppPullRequest | undefined;
  pullRequest(appId: string): AppPullRequest | undefined; // the open one
  pullRequests(appId: string): AppPullRequest[]; // newest first
  repo(appId: string): AppRepo | undefined;
  choice(appId: string): ShipModeChoice | undefined;
}
```

**Hook in the Studio service.** `Studio.withWorkspace(appId, fn: (sandbox, app) => Promise<T>)` runs `fn` with the App's sandbox under the App's Git lock. The `Shipper` pushes from there.

## Later (not built in phases 1–4)

**Coupling to a factory** (optional per App).

## Spec change: environments

Kiln Projects hold environments (see [project-environments.md](project-environments.md)). The resolver lives in `packages/engine` (`kiln.variables`), not in `packages/studio`; Studio only receives the result:

```ts
// packages/engine/src/platform/variables.ts
kiln.variables.forApp(app: { id: string; team: string; projectId?: string }, environment = "preview"): {
  env: Record<string, string>; // team → project → App, later layers override
  secretValues: string[]; // for redaction from turn output and logs
  sources: Record<string, { scope: "team" | "project" | "factory" | "app"; owner: string; secret: boolean }>;
};
```

- `forApp` returns only values people assigned in the team, project and App layers. It never falls back to server secrets, the admin secret store or `KILN_SECRET_<NAME>`. A harness credential comes from `StudioOptions.credentials`, not from here.
- This is the one environment resolver: factory runs (`kiln.variables.forFactory`) and PR previews use the same layers. Don't add another.
- `routes/studio.ts` builds `Studio` with `env: (app) => kiln.variables.forApp(app).env` and redacts `secretValues` from turn events and dev server logs it stores.
- App-level overrides are a variable layer with `scope: "app"`, `owner: <app id>` (`PUT /api/v1/variables/app/{appId}/preview`). The App's settings can link to it; Studio does not store variables itself.
- `setup.envMissing` is computed against this map, so a key set on the project clears it for every App in that project.
- Dev servers, installs and harness runs all get `preview`. `production` is for shipping, later.

## Acceptance

1. `expose` returns a reachable address on local, Docker and Kubernetes (fake command runner) and throws `SandboxNotReachable` for a Docker sandbox without a network. (Done.)
2. A build turn that edits files makes one checkpoint; a question makes none; a chat-mode turn that edits files leaves no change and is marked `discarded`.
3. In `cowboy` mode every changed turn becomes a version on the main line, with one chat or several. In `safe` and `review`, nothing reaches it until Apply.
4. When two chats change the same line, the second apply conflicts, the resolve turn runs, and on success both changes are on the main line; otherwise the chat is `needs_you`.
5. Restore makes a new version whose tree equals the old one, and the earlier versions stay.
6. Tools validate input with zod and act through `Studio`; client tools change nothing.
7. Studio events carry their priority.
8. Shipping: no path pushes a main branch except a template App's Kiln-created repository or an imported App whose person chose `cowboy`, and never a repository linked to a factory (tested for each case); every push is audited; the pull request moves uat → ready_for_review (author only) → merged or waiting_for_review, or cancelled (closed on the forge).
9. The API serves the routes for the caller's team only, the MCP tools call them, and `/studio` shows chats, preview, version cards, History and Bookmarks.

## Follow-ups

A Kubernetes ingress policy for previews (written in the Helm chart, pending security review); screenshots for `look`; idle pause on a timer; the later items above; voice (ADR-013).
