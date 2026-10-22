# ADR-012: Studio, a vibe-coding space next to factories

Status: Proposed · Date: 2026-10-22

## Context

Factories are built for repeatable, reviewed work: specs, gates, pull requests and a person who merges (ADR-002, ADR-008). That is too much ceremony for the start of a project, when someone wants to talk to one model, see the result in seconds and change direction freely. Chat-to-preview tools work this way, and people expect it. Kiln has most of the parts (sandboxes, harnesses, steering, snapshots, the chat UI) but no live preview of a running dev server, no lightweight versions, and no way to start without a factory and a repository. We also want to drive this hands-free with a realtime voice model that moves between projects and chats.

## Decision

Kiln gets a **Studio**, separate from factories, that a project can later **graduate** from into a factory.

**Model.** Workspace → Project → Chat → lead agent → subagents.

- A **project** is one Git repository inside one sandbox, started from a template (first: Next.js). Its `main` line is the project's history of versions.
- A **chat** is a line of work on its own Git worktree and branch, with its own dev server port and preview. It has one lead agent: a harness session (ADR-004, ADR-009) with the model the person picks, steered by each message. Subagents are spawned by the harness inside the chat's worktree; Kiln shows them and does not orchestrate them.
- One sandbox per project runs every chat's dev server. Chats pause when idle, using the existing sandbox snapshots, and a project has a limit on how many chats can run at once.

**Versions.** A turn that changes files makes a checkpoint commit on its chat's branch. A turn that changes nothing makes nothing, in any mode. **Apply** merges a chat into `main` and records a version with a one-line title written by the model. When Apply happens is set by the project's ship mode (below). Restore makes a new version with an old version's tree, so history is never rewritten. Bookmarks are pinned versions.

**Modes** are permissions, not versioning rules: Build (read, edit, run), Chat (read only, may use a cheaper model), Plan (read, then a plan card with "Build it").

**Live preview.** `Sandbox` gains `expose(port)`, with a fake, so the API can proxy a chat's dev server, hot reload included. Previews are served from their own origin (`<id>.preview.<domain>`, wildcard DNS and certificate), never from Kiln's origin, so code an agent generated can't read Kiln's cookies or call its API. Local development may use a direct `localhost` port.

**One control surface.** Every Studio action is a zod-typed tool in `packages/studio`, exposed through the API and the Kiln MCP: `status`, `open_project`, `new_chat`, `send`, `apply`, `restore`, `bookmark`, `look`. The web UI, MCP clients and voice all use it. The tools are of two kinds: _server tools_ change Studio, _client tools_ (`focus`, `show`) move the person's screen. A **focus** (project and chat) is the default target of a message. Studio events (`turn.finished`, `chat.needs_input`, `version.created`) go on the event bus with a priority: _needs you_, _finished_ or _progress_.

**Voice is a conductor, not a coder.** A realtime voice model sits behind a `VoiceProvider` interface in `packages/voice`, with a fake; OpenAI Realtime is the first adapter. The browser connects over WebRTC with a short-lived token the API mints from the team's key (ADR-007). Voice calls the same tools as everyone else. It relays the person's words to a chat as they said them, adding only routing context. It speaks _needs you_ events at the next pause, never over the person, shows _finished_ events as badges, and keeps _progress_ silent. It asks for a spoken confirmation before Apply, Restore or Graduate. Its conversation and focus are stored on the server, so a dropped or expired session resumes. Toward factories, voice is read-only; deciding a gate by voice needs its own ADR.

**Graduation.** "Turn into factory" is a person's action. It creates a repository on the forge, pushes `main` with its history, creates a factory from a template pointed at that repository, and seeds a project brief from the chats and bookmarked versions. The Studio project then becomes read-only.

**Ship mode, and a Studio exception to ADR-008.** Studio projects are experiments, not production code, so each project has a `shipMode`:

| Mode               | Inside the sandbox                                                                                      | On the project's forge repository                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `safe`             | Apply is a person's click                                                                               | Nothing is pushed until the person asks                             |
| `review`           | Apply is a person's click                                                                               | The agent pushes a branch and opens a pull request; a person merges |
| `cowboy` (default) | Every chat applies after each turn that changes files; on a conflict the chat's agent resolves it first | The agent pushes `main`                                             |

In `cowboy` mode an agent merges, which ADR-008 forbids for factories. This ADR makes a narrow exception for Studio, held by two guards:

- The push credential a Studio run receives is scoped to that one Studio repository, which Kiln created for the project and labels as such. It can't reach a factory's or any other repository.
- Graduation ends the exception. A graduated project's repository belongs to a factory and ADR-008 applies unchanged; Studio has no path to merge into a factory's repository.

Every agent push in `cowboy` mode is recorded in the audit log.

## Consequences

- New packages: `packages/studio` (projects, chats, turns, versions, tools) and `packages/voice`. New sandbox capability: `expose(port)` on the local and Docker backends first, Kubernetes later.
- Studio state (projects, chats, turns, versions, voice sessions) is runtime state in the Store. Code lives in the project's Git repository, saved through sandbox snapshots. Studio projects are not factory definitions.
- `apps/api/src/app.ts` gains Studio routes, the preview proxy and voice token minting. That file is protected, so the change needs explicit approval.
- Self-hosters who want Studio need wildcard DNS and a certificate for the preview domain.
- Keeping a sandbox and an agent session open while a person works costs more than a factory turn (ADR-011). Idle pause and the per-project limit on running chats bound that cost.
- Because the control surface comes first, Studio can be driven from Claude Code over MCP before voice exists, and the tools can be tested without audio.
- The earlier "product-owner chat with a fast preview" idea is replaced by this one; see docs/ideas/studio.md.
