# ADR-019: Studio Context, a shared document the prototype is built from

Status: Accepted · Date: 2026-11-24 (proposed 2026-11-23; accepted by the owner)

## Context

ADR-012 gave Studio a page with a chat rail and a preview. The only durable record of what a team wants is the chat transcript: decisions are buried in turns, a plan is a card inside one turn, the agent's questions are one line of text, and a teammate who opens the App reads the owner's whole conversation to find out what was decided. There is no place to review intent, and nothing says whether the preview reflects it. The evidence is in `docs/specs/studio-context.md`, section 2.

Studio is meant for a team designing a product before engineering starts, with people who are not developers. They need one document they can read, edit and review, and an agent that builds from that document and nothing else.

## Decision

Each App gets a **Context**: one living document that is the source of truth for what the App should be. People and the agent build it from **fragments** (text, section, requirement, decision, assumption, constraint, question, flow, risk, metric, image). The prototype is built from the Context. The page shows the Context on the left and the prototype on the right, with no chat rail and no mode picker. The plan is `docs/specs/studio-context.md`.

**This changes ADR-012's page model, not its engine.** Apps, chats, runs, worktrees, versions, ship modes and the preview stay as ADR-012 describes them. The Context page shows one main thread per App; parallel chats and subagents stay in the engine and are listed under Activity. Modes stay in the engine: the page sends none, and the server picks `build` when a turn may change code and treats a Context-only turn like `plan`. ADR-012 is not edited.

**A second source of truth next to Git, with a stated boundary.** CLAUDE.md says definitions live in Git and runtime state lives in the Store, and never to treat both as truth. The Context is a third kind of thing: authored content that people edit together in real time, which Git can't hold while it is being written. So:

- The Context document is the truth for **intent**. It is a Yjs document held by the API, synced to each open page (see Transport below) and persisted as snapshots in the object store. A second Yjs document holds discussion (comment threads).
- Git stays the truth for **code**. The prototype's repository never holds the working copy of the Context.
- Everything else about a Context in the Store is either state (`studio_context`, `studio_members`, `studio_questions`, `studio_proposals`, `studio_signoffs`) or an index derived from the document (`studio_fragments`), rebuilt from it and never written by a route. When the index and the document disagree, the document wins.
- The agent's worktree gets a read-only copy, `.kiln/context.md`, at the start of each turn. On ship, the Context is exported into the repository as `docs/context.md` and `docs/context.json`. Both are copies. Nothing reads them back.

**The agent changes the Context only through tools.** The Context is not a file the agent can edit. `context_read`, `context_write`, `context_remove`, `ask`, `link_preview` and `mark_built` are server tools, exposed to App runs through the Kiln MCP with the run's token. The server applies each write to its own copy of the document as a peer, so every client sees the agent write.

**Two permission levels, enforced on the server.** An App member is an **editor** or a **viewer**; the creator is the owner, an editor who manages members. Every write is checked against the permission of **the person who prompted the turn**, not the agent's:

- An editor's edits, answers and prompts change the Context.
- A viewer reads and comments. A viewer's edit, answer or prompt becomes a **proposal** that an editor accepts or rejects. For a viewer's socket the server drops incoming updates to the Context document and sends the current state back; the page also disables editing, but the server is the gate.

Functional roles (product, design, engineering, security, legal, data, qa) are separate: they drive ownership and review of fragments, never access.

**Questions never block a run.** `ask` records typed questions (a fixed set of kinds the page renders; the agent never sends markup) and ends the turn in `needs_you`. Answers start the next turn through the existing follow-up path, so a restart loses nothing and nothing times out.

**No new agent permission.** Agents still can't merge or approve (ADR-008). The Context tools give an agent no write that the person who prompted it doesn't have. Membership of an App's Context is edited by people only.

**Transport.** The page reaches the API only through Kiln's web server, as every other Studio call does: the browser's session cookie belongs to the web origin and the web server has no way to carry a WebSocket. So the document syncs over the two things that already work there: a server-sent event stream from the API (the document's state, then each Yjs update and presence change) and a POST for the page's own updates. Both go through the same session and team checks as the routes. This replaces the WebSocket the plan first described; nothing in `apps/api/src/app.ts` or `packages/auth` changes. A viewer's POST of a document update is refused, and the stream sends them the current state.

**Editor.** The page uses BlockNote's core, React and shadcn packages (MPL-2.0) and Yjs (MIT). BlockNote's `@blocknote/xl-*` packages are GPL-3.0 or commercial and are not used; Kiln stays MIT (ADR-007). Agent edits, the inline "Ask the agent" with Accept and Reject, and exports are Kiln's own code.

**Behind a flag.** The page is the default only with `KILN_STUDIO_CONTEXT=1`. The current page stays until the new one passes the plan's acceptance list.

## Consequences

- `packages/studio` gains the Context types, six tools and new turn instructions; `packages/events` gains `studio.question_asked`, `studio.question_answered`, `studio.context_changed`, `studio.proposal_opened` and `studio.review_requested`.
- The API gains a sync stream and an update route for the Context (`GET` and `POST /api/v1/studio/apps/{id}/context/sync`), and routes for questions, proposals, members, sign-offs, the Brief and export.
- The API now holds live documents in memory. On one node (ADR-005) that is one process; running more than one API process needs the documents on a shared backend first.
- The object store holds Context snapshots; a restart reloads them. Losing the object store loses Contexts that were never shipped, so it belongs in backups next to the Store.
- A Context can drift from the code. The page says so (the freshness chip compares the Context version the last build read with the current one); nothing forces them back together.
- Two Yjs documents per App and their history grow without bound until snapshots are compacted. Compaction is not designed yet.
- A viewer can spend the App's budget by prompting, even though their turn can only propose. The App's existing budget and running-chat limits apply; a per-role limit may be needed.

## Update 2026-11-25

At the owner's request, functional roles (product, design, engineering, security, legal, data, qa) are removed from Studio Context, and with them a fragment's owner and reviewer roles, sign-offs, review requests, the My review panel, their routes and the `studio.review_requested` event. The editor and viewer permissions (and the owner who manages members) stay as decided above; proposals and comment threads stay. Member rows and document blocks stored with `role`, `ownerRole` or `reviewerRoles` still load, and those keys are ignored. The decision text above is left as it was accepted.
