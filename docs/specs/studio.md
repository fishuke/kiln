# Studio: phases 1–4 (contract)

Decision: [ADR-012](../adr/0012-studio.md) · Idea: [Studio](../ideas/studio.md). Voice ([ADR-013](../adr/0013-voice.md)) and graduation are out of scope. Dictation in the composer is optional and may be skipped.

This spec is the contract that parallel work builds against. Change it here first, then in code.

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
```

- Local: `127.0.0.1:<port>`.
- Docker: the container IP from `docker inspect`. It throws `SandboxNotReachable` when the container has no network (`--network none`, which means a runner with no egress). The API must share the sandbox network; in compose that's `kiln-egress`.
- Kubernetes: the pod IP. Allowing ingress from the API in the sandbox NetworkPolicy is a follow-up.
- A port outside 1–65535 throws `RangeError`.

## Types (`packages/studio/src/types.ts`)

Every type is a zod schema with an inferred type of the same name. Dates are ISO strings.

```ts
export const ShipMode = z.enum(["safe", "review", "cowboy"]); // default "cowboy"
export const ChatMode = z.enum(["build", "chat", "plan"]); // default "build"
export const Priority = z.enum(["needs_you", "finished", "progress"]);
export const ProjectStatus = z.enum(["creating", "ready", "paused", "failed"]);
export const ChatStatus = z.enum(["idle", "working", "needs_you", "conflict", "failed"]);
export const TurnStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export const VersionKind = z.enum(["initial", "apply", "restore"]);
export const Via = z.enum(["web", "mcp", "api", "voice"]);

export type Project = {
  id: string; // "sp_…"
  team: string;
  name: string;
  template: string; // Template.id, e.g. "nextjs"
  shipMode: ShipMode;
  harness: HarnessType; // default for new chats, "claude-code"
  model?: string;
  status: ProjectStatus;
  error?: string;
  snapshot?: SnapshotRef; // latest workspace snapshot
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Chat = {
  id: string; // "sc_…", 128-bit random suffix: also the preview target id
  projectId: string;
  title: string;
  mode: ChatMode; // the composer's current mode
  harness: HarnessType;
  model?: string;
  branch: string; // "chat/<id>"
  path: string; // "chats/<id>", relative to the sandbox workdir
  port: number; // dev server port, 4101 and up
  status: ChatStatus;
  question?: string; // set while status is needs_you
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
  projectId: string;
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
  id: string; // "sv_…", 128-bit random suffix: also the version preview target id
  projectId: string;
  sha: string; // commit on main
  title: string;
  kind: VersionKind;
  chatId?: string; // apply
  restoredFrom?: string; // restore: the version id
  bookmarked: boolean;
  createdAt: string;
};

export type Preview = { target: string; url: string; status: "starting" | "ready" | "failed" };
```

Store collections: `studio_projects`, `studio_chats`, `studio_turns` and `studio_versions`, each keyed by `id`.

## Template (`packages/studio/src/templates.ts`)

```ts
export type Template = {
  id: string; // "nextjs"
  name: string; // "Next.js"
  /** Run in <workdir>/project, an empty directory, to create the app. Trusted commands. */
  scaffold: string[];
  /** Run in each worktree before its dev server starts (e.g. "pnpm install --prefer-offline"). */
  install: string[];
  /** Dev server command; {port} is replaced. It must bind 0.0.0.0. */
  dev: string;
  /** Runner image with the harness CLIs and the template baked in (defaults to KILN_RUNNER_IMAGE). */
  image?: string;
  egress: string[];
};

export const TEMPLATES: Record<string, Template>;
```

`nextjs`:

- `scaffold`: `test -d /opt/kiln/templates/nextjs && cp -a /opt/kiln/templates/nextjs/. . || pnpm dlx create-next-app@15 . --ts --tailwind --app --eslint --use-pnpm --yes --skip-install`
- `install`: `pnpm install --prefer-offline`
- `dev`: `pnpm next dev --port {port} --hostname 0.0.0.0`
- `egress`: `registry.npmjs.org`

The template owner provides `/opt/kiln/templates/nextjs`, a ready app with `node_modules` and a pnpm store warmed in the runner image, so the first preview takes about 10 seconds.

## Workspace layout (inside the project sandbox)

```
<workdir>/project          main repository, branch main; the versions
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
  sandboxes: SandboxProvider;                         // one backend for Studio
  harness: (type: HarnessType) => HarnessAdapter;
  credentials?: (project: Project, type: HarnessType) => Record<string, string>;
  templates?: Record<string, Template>;               // default TEMPLATES
  image?: string;                                     // fallback runner image
  previewUrl: (target: string, address: SandboxAddress) => string;
  maxRunningChats?: number;                           // default 3
};

export class Studio {
  constructor(opts: StudioOptions);

  listProjects(team: string): Project[];
  getProject(id: string): { project: Project; chats: Chat[]; versions: Version[] } | undefined;
  createProject(input: { team: string; by: string; name: string; template?: string; shipMode?: ShipMode; harness?: HarnessType; model?: string }): Promise<Project>;
  updateProject(id: string, patch: { name?: string; shipMode?: ShipMode }): Project;
  pause(projectId: string): Promise<Project>;          // snapshot, destroy the sandbox

  newChat(projectId: string, input: { by: string; via: Via; title?: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string }): Promise<{ chat: Chat; turn?: Turn }>;
  getChat(id: string): { chat: Chat; turns: Turn[] } | undefined;
  /** Starts a turn, or steers the running one. Resolves when the turn has started, not finished. */
  send(chatId: string, input: { by: string; via: Via; text: string; mode?: ChatMode }): Promise<{ turn: Turn; steered: boolean }>;
  /** Resolves when the chat has no running turn (tests, CLI). */
  idle(chatId: string): Promise<void>;
  apply(chatId: string, by: string): Promise<{ ok: true; version: Version } | { ok: false; conflict: string[] } | { ok: false; nothing: true }>;
  diff(target: { chatId: string } | { versionId: string }): Promise<string>;  // unified diff

  restore(versionId: string, by: string): Promise<Version>;
  bookmark(versionId: string, on: boolean): Version;
  preview(target: { chatId: string } | { versionId: string }): Promise<Preview>;

  status(input: { team: string; project?: string }): StatusReport;
  /** Address for the preview proxy; undefined for an unknown or stopped target. */
  resolvePreview(target: string): Promise<SandboxAddress | undefined>;
}

export type StatusReport = {
  projects: { id: string; name: string; working: string[]; needsYou: { chatId: string; question: string }[]; latest?: { title: string; at: string } }[];
};

export class StudioError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "busy" | "conflict" | "unavailable", message: string);
}
```

### Behavior

- **Turn.** It persists the turn as `running`, starts the chat's harness in its worktree (cwd `chats/<id>`) with Studio's instructions for the mode and the prompt, and records activity. When the harness finishes, it reads `.kiln/studio.json`, checkpoints, and persists the turn again. Then comes ship mode (below), then a snapshot. `send` during a running turn steers it (`steered: true`).
- **Checkpoint.** `git add -A`; when there's a diff from `HEAD`, commit on the chat branch with the turn's title. No diff, no commit, in every mode.
- **Modes.** In `chat` and `plan` mode, a diff at the end of the turn is reverted (`git reset --hard && git clean -fd`) and `discarded: true` is set. `plan` stores the reply as `plan`. "Build it" is `send({ text: plan, mode: "build" })`.
- **Apply.** In `project`: `git merge --no-ff -m <title> chat/<id>`. The title is the titles of the chat's checkpoints since `appliedSha`, joined with "; " and cut to 80 characters. On a conflict it runs `git merge --abort`, sets the chat to `conflict` and returns the files. `{ nothing: true }` when the chat has no new checkpoints.
- **Ship mode.** `cowboy`: after every turn with a checkpoint, apply. On a conflict, start a resolve turn (`resolve: true`) that tells the agent to run `git merge main`, fix the conflicts and commit, then apply again. If that fails too, set the chat to `needs_you` with the conflicting files as the question. `safe` and `review`: the person applies. Forge behavior per mode (ADR-012: push credential scoped to the one Studio repository, cowboy ends at graduation, agent pushes audited) is not built in phases 1–4. Nothing pushes, opens a PR or merges outside the sandbox.
- **Restore.** `git read-tree -u --reset <sha>`, then commit "Restore: <title>". This records a `restore` version; history is never rewritten.
- **Preview.** A dev server per chat worktree on `chat.port`, and one for `version` on port 4100, started with the template's `dev` command through `sandbox.spawn`. `url` is `previewUrl(target, await sandbox.expose(port))`.
- **Limits.** If `maxRunningChats` turns are already running in the project, `send` throws `StudioError("busy")`.
- **Durability.** Every step persists before and after it runs. After each turn the sandbox is snapshotted to `objects`, and a project whose sandbox isn't in memory resumes from `snapshot`. Dev servers start again lazily. Time comes only from `clock`.

## Events (`packages/events`, added to `KilnEventMap`)

```ts
"studio.turn_started":    { projectId: string; chatId: string; turnId: string; priority: "progress" };
"studio.turn_finished":   { projectId: string; chatId: string; turnId: string; title?: string; summary?: string; changed: boolean; priority: "finished" };
"studio.version_created": { projectId: string; versionId: string; title: string; kind: VersionKind; priority: "finished" };
"studio.needs_you":       { projectId: string; chatId: string; question: string; reason: "question" | "conflict" | "failed"; priority: "needs_you" };
```

## Tools (`packages/studio/src/tools.ts`)

```ts
export type ToolKind = "server" | "client";
export type StudioTool<I extends z.ZodType> = { name: string; kind: ToolKind; description: string; input: I };
export const STUDIO_TOOLS: StudioTool<z.ZodType>[];
export function runTool(studio: Studio, name: string, input: unknown, caller: { team: string; by: string; via: Via }): Promise<ToolResult>;
export type ToolResult = { ok: true; data: unknown; client?: ClientAction } | { ok: false; error: string };
export type ClientAction = { focus: { project: string; chat?: string } } | { show: "preview" | "code" | "history" };
```

| Name           | Kind   | Input (zod)                                                                                                                                 |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | server | `{ project?: string }`                                                                                                                      |
| `open_project` | server | `{ project: string } \| { name: string; template?: string; shipMode?: ShipMode }`; returns the project plus `client: { focus }`             |
| `new_chat`     | server | `{ project: string; prompt?: string; mode?: ChatMode; harness?: HarnessType; model?: string; title?: string }`; returns `client: { focus }` |
| `send`         | server | `{ chat: string; text: string; mode?: ChatMode }`                                                                                           |
| `apply`        | server | `{ chat: string }`                                                                                                                          |
| `restore`      | server | `{ version: string }`                                                                                                                       |
| `bookmark`     | server | `{ version: string; on: boolean }`                                                                                                          |
| `look`         | server | `{ chat: string }`; returns the `Preview` (a screenshot is a follow-up)                                                                     |
| `focus`        | client | `{ project: string; chat?: string }`                                                                                                        |
| `show`         | client | `{ view: "preview" \| "code" \| "history" }`                                                                                                |

Client tools return `{ ok: true, data: null, client }` and change nothing on the server.

## API (`apps/api/src/routes/studio.ts`)

Every route needs a signed-in caller (`ctx.user`). Projects belong to `ctx.team(c)`; a project of another team answers 404. Bodies are validated with the zod schemas above; a `StudioError` maps to 404, 400, 409, 409 and 503.

| Method and path                              | Body                                               | Response                                                                                     |
| -------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/v1/studio/projects`                |                                                    | `{ projects: Project[] }`                                                                    |
| `POST /api/v1/studio/projects`               | `{ name, template?, shipMode?, harness?, model? }` | `Project` (status `creating`; poll until `ready`)                                            |
| `GET /api/v1/studio/projects/{id}`           |                                                    | `{ project, chats: Chat[], versions: Version[] }` (versions newest first)                    |
| `PATCH /api/v1/studio/projects/{id}`         | `{ name?, shipMode? }`                             | `Project`                                                                                    |
| `POST /api/v1/studio/projects/{id}/chats`    | `{ prompt?, mode?, harness?, model?, title? }`     | `{ chat: Chat, turn?: Turn }`                                                                |
| `GET /api/v1/studio/chats/{id}`              |                                                    | `{ chat, turns: Turn[] }` (oldest first)                                                     |
| `POST /api/v1/studio/chats/{id}/messages`    | `{ text, mode? }`                                  | `{ turn: Turn, steered: boolean }`                                                           |
| `POST /api/v1/studio/chats/{id}/apply`       |                                                    | `{ ok: true, version } \| { ok: false, conflict: string[] } \| { ok: false, nothing: true }` |
| `GET /api/v1/studio/chats/{id}/diff`         |                                                    | `{ diff: string }` (since the chat's last apply)                                             |
| `GET /api/v1/studio/chats/{id}/preview`      |                                                    | `Preview` (starts the dev server if needed)                                                  |
| `GET /api/v1/studio/chats/{id}/events`       |                                                    | SSE: `turn` (a `Turn`, on every change) and `chat` (a `Chat`)                                |
| `POST /api/v1/studio/versions/{id}/restore`  |                                                    | `Version`                                                                                    |
| `POST /api/v1/studio/versions/{id}/bookmark` | `{ on: boolean }`                                  | `Version`                                                                                    |
| `GET /api/v1/studio/versions/{id}/diff`      |                                                    | `{ diff: string }` (against its parent version)                                              |
| `GET /api/v1/studio/versions/{id}/preview`   |                                                    | `Preview` (checks the version out in `version`)                                              |
| `GET /api/v1/studio/status`                  |                                                    | `StatusReport`                                                                               |
| `POST /api/v1/studio/tools/{name}`           | the tool's input                                   | `ToolResult`                                                                                 |

### Preview proxy (`apps/api/src/routes/studio-preview.ts`, a `PUBLIC_MODULES` entry)

- `KILN_STUDIO_PREVIEW_DOMAIN` set (e.g. `preview.kiln.example.com`): `previewUrl(target) = https://<target>.<domain>`. The proxy matches `Host: <target>.<domain>` only, calls `studio.resolvePreview(target)` and forwards the request (method, path, query, headers minus `cookie` and `authorization`, body) to `http://<host>:<port>`. An unknown target answers 404. Every other host goes to `next()`. The target id carries 128 bits of randomness and is the only credential; Kiln cookies never reach the preview origin.
- Unset (local development): `previewUrl = http://<address.host>:<address.port>`, and nothing is proxied.
- WebSocket upgrades for hot reload go in `apps/api/src/main.ts` (Node `upgrade`) and are a follow-up. Until then the web page reloads the iframe on `turn_finished`.

## SDK (`packages/sdk-ts`), used by the web page and MCP

```ts
studioProjects(): Promise<{ projects: Project[] }>;
studioCreateProject(input): Promise<Project>;
studioProject(id): Promise<{ project: Project; chats: Chat[]; versions: Version[] }>;
studioUpdateProject(id, patch): Promise<Project>;
studioNewChat(projectId, input): Promise<{ chat: Chat; turn?: Turn }>;
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

- `/studio` lists projects, with a "New app" form (name, template, ship mode).
- `/studio/[project]` has the chat rail on the left and the preview on the right.
- **Chat rail.** One chat tab per chat and "+" for a new one. Turns are shown with the AI Elements `Message` / `MessageScroller`. A turn with a checkpoint shows a version card with the title, **Details** (diff) and **Preview**. The composer is `PromptInput` with a Build/Chat/Plan mode picker (⌥P). A plan card has **Build it**. A chat in `conflict` or `needs_you` shows the question. Without cowboy mode, an **Apply** button shows when the chat has unapplied checkpoints.
- **Top bar.** History and Bookmarks panels (versions; bookmark toggle; preview a version with a "Previewing" banner, **Restore** and **Back to latest**), a ship-mode picker, and a needs-you badge from `studioStatus()`.
- **Preview pane.** Preview and Code tabs (Code shows the chat diff), a route field, reload, and open in a new tab. It reloads on `turn_finished`.
- **Server actions** call `api.studio*` (the `lib/kiln.ts` proxy); the page polls `studioChat` every 2 s while a turn runs, or uses the SSE route once it exists.

## Acceptance

1. `expose` returns a reachable address on local, Docker and Kubernetes (fake command runner) and throws `SandboxNotReachable` for a Docker sandbox without a network. (Done.)
2. A build turn that edits files makes one checkpoint; a question makes none; a chat-mode turn that edits files leaves no change and is marked `discarded`.
3. In `cowboy` mode every changed turn becomes a version on `main`, with one chat or several. In `safe` and `review`, nothing reaches `main` until Apply.
4. When two chats change the same line, the second apply conflicts, the resolve turn runs, and on success both changes are on `main`; otherwise the chat is `needs_you`.
5. Restore makes a new version whose tree equals the old one, and the earlier versions stay.
6. Tools validate input with zod and act through `Studio`; client tools change nothing.
7. Studio events carry their priority.
8. The API serves the routes for the caller's team only, the MCP tools call them, and `/studio` shows chats, preview, version cards, History and Bookmarks.

## Follow-ups

WebSocket proxying for hot reload; a Kubernetes ingress policy for previews; screenshots for `look`; idle pause on a timer; forge sync per ship mode (ADR-012's guards); voice (ADR-013); graduation.
