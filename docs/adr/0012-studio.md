# ADR-012: Studio, a vibe-coding space next to factories

Status: Proposed · Date: 2026-10-22

## Context

Factories are built for repeatable, reviewed work: specs, gates, pull requests and a person who merges (ADR-002, ADR-008). That is too much ceremony when someone wants to talk to one model, see the result in seconds and change direction freely, whether they're starting something new or changing an existing app. Chat-to-preview tools work this way, and people expect it. Kiln has most of the parts (sandboxes, harnesses, steering, snapshots, the chat UI) but no live preview of a running dev server, no lightweight versions, and no way to work without a factory. People outside the engineering team, such as a customer testing a change, also need a way to send what they built to a developer for review. And we want people to drive all of this by voice, so every action must be callable by clients other than the web UI.

## Decision

Kiln gets a **Studio**, an entry in Kiln's sidebar next to Factories. A Studio **App** is a sibling of a factory: it is built from the same definitions (agents, skills, MCPs, policies, decisions), works on its own, and can be linked to a factory when the team wants automation around it.

**Model.** Team → Kiln Project (optional) → App → Chat → lead agent → subagents.

- An **App** is one Git repository inside one sandbox. It starts from a **template** (first: Next.js) or **imports an existing repository** through a forge connection. Its `main` line is the App's history of versions. "App" is used rather than "project" because a Kiln Project already groups factories ([Portfolio](../site/management/portfolio.md)).
- A **Kiln Project** can group Apps and factories, for example one product's frontend App and its backend factory. Its environments (variables and secrets) are inherited by its Apps' previews and its factories' runs, and each layer can override them (team → project → app or factory).
- A **chat** is a line of work on its own Git worktree and branch, with its own dev server port and preview. It has one lead agent: a harness session (ADR-004, ADR-009) with the model the person picks, steered by each message. Subagents are spawned by the harness inside the chat's worktree; Kiln shows them and does not orchestrate them.
- An **App's definition** uses the factory definition format (`kiln/v1`): the lead agent and model, skills (some marked mandatory, loaded into every chat), MCPs, policies, decisions and budgets. A new App gets defaults inherited from the team and the Kiln Project, so nobody has to configure anything to start. App definitions are stored by content hash, edited in the UI, and can be exported to Git. Pipelines and automations are optional.
- One sandbox per App runs every chat's dev server. Chats pause when idle, using the existing sandbox snapshots, and an App has a limit on how many chats can run at once.

**Versions.** A turn that changes files makes a checkpoint commit on its chat's branch. A turn that changes nothing makes nothing, in any mode. **Apply** merges a chat into the App's `main` and records a version with a one-line title written by the model. Restore makes a new version with an old version's tree, so history is never rewritten. Bookmarks are pinned versions.

**Modes** are permissions, not versioning rules: Build (read, edit, run), Chat (read only, may use a cheaper model), Plan (read, then a plan card with "Build it").

**Ship mode.** Each App has a `shipMode`, which sets when Apply happens and what reaches its forge repository:

| Mode     | Inside the sandbox                                                                                      | On the forge                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `safe`   | Apply is a person's click                                                                               | Nothing is pushed until the person asks                                                              |
| `review` | Apply is a person's click                                                                               | The agent pushes a `studio/<app>` branch and opens a pull request; a person merges                   |
| `cowboy` | Every chat applies after each turn that changes files; on a conflict the chat's agent resolves it first | Template App: the agent pushes `main`. Imported App: the agent pushes the `studio/<app>` branch only |

The default is `cowboy` for an App from a template and `review` for an imported App. No agent ever pushes to an imported repository's default branch. An App's policy sets the highest ship mode each role may use, so a customer can use `cowboy` on an App they created and only `review` on the team's production App; people pick their ship mode up to that cap.

**A Studio exception to ADR-008.** Pushing `main` in `cowboy` mode is an agent merging, which ADR-008 forbids for factories. It is allowed only for an App started from a template, on the repository Kiln created for it, because that is an experiment and not production code. The push credential a Studio run receives is scoped to that one repository. Every agent push is recorded in the audit log. The exception ends when the repository is linked to a factory.

**Studio pull requests and review.** In `review` mode, or when a person clicks **Ship**, Studio opens a pull request and the App's pull request moves through states the author controls:

- **UAT**: the author tests it in the built-in preview, and in the pull request's deployment preview when a preview provider is configured (see [Previews](../site/integrations/previews.md)). New turns keep updating the same pull request.
- **Ready for review**: the author is done testing. Only now does the App's merge gate (ADR-014) check it: if it's safe to merge, Kiln merges it; otherwise it appears in the reviewers' Inbox and a person reviews and merges. Not every Studio pull request needs a person's review.
- **Cancelled**: the pull request is closed and nothing reaches a reviewer.

The App records the pull request, its previews and its state, so the people involved see the same status in Studio and the Inbox.

**Linking to a factory (optional).** An App can be linked to a factory, for example the one that owns its repository or one that monitors deployments. The factory's automations then run on the App's pull requests the same way as on any other: for example `pull_request_opened` for checks, `pull_request_merged` for deploy follow-up. Merges into a linked factory's repository follow ADR-008 and ADR-014. "Turn into factory" on a template App creates a factory pointed at its repository and seeds a project brief from the chats and bookmarked versions.

**Live preview.** `Sandbox` gains `expose(port)` so the API can proxy a chat's dev server, hot reload included. Previews are served from their own origin (`sc-<id>.<preview domain>`, wildcard DNS and certificate), never from Kiln's origin, so code an agent generated can't read Kiln's cookies or call its API. The preview domain should be a separate registrable domain, so preview code can't set cookies on Kiln's domain. The proxy drops cookies and Kiln credentials in both directions. Sandboxes reach the API only through a dedicated preview network. Local development may use a direct `localhost` port.

**One control surface.** Every Studio action is a zod-typed tool in `packages/studio`, exposed through the API and the Kiln MCP: `status`, `open_app`, `new_chat`, `send`, `apply`, `restore`, `bookmark`, `ship`, `look`. The web UI, MCP clients and the voice session (ADR-013) all use it. The tools are of two kinds: _server tools_ change Studio, _client tools_ (`focus`, `show`) move the person's screen. A **focus** (App and chat) is the default target of a message. Studio events (`turn.finished`, `chat.needs_input`, `version.created`, `pull_request.state_changed`) go on the event bus with a priority: _needs you_, _finished_ or _progress_.

**Voice.** Each chat composer has dictation. Spoken conversation and moving between chats and Apps by voice are decided in ADR-013, as a client of the tools above.

**Roles** (who may open, ship or review an App) are planned separately.

## Consequences

- New package `packages/studio` (Apps, chats, turns, versions, pull request states, tools). New sandbox capability `expose(port)` on the local, Docker and Kubernetes backends.
- Studio state (Apps, chats, turns, versions, pull request states) is runtime state in the Store. Code lives in the App's Git repository, saved through sandbox snapshots and pushed to the forge according to the ship mode. An App's definition is a factory-format definition stored by content hash; its runtime state is not.
- Studio routes and the preview proxy register through `apps/api/src/routes/index.ts`, so `apps/api/src/app.ts` doesn't change. Websockets for hot reload are handled in `apps/api/src/main.ts`.
- The Inbox gains a kind of item: a Studio pull request ready for review.
- Kiln Projects gain environments, used by Studio previews and factory runs alike.
- Self-hosters who want Studio need a wildcard DNS record and certificate for the preview domain, preferably on a separate registrable domain.
- Keeping a sandbox and an agent session open while a person works costs more than a factory turn (ADR-011). Idle pause and the per-App limit on running chats bound that cost.
- An imported App needs the repository's environment variables to boot; project environments and the import flow supply them.
- The earlier "product-owner chat with a fast preview" idea is replaced by this one; see docs/ideas/studio.md.
