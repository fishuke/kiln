# Studio redesign: Context first (plan)

Status: plan, not built. Experimental. Builds on [studio.md](studio.md) (the current contract) and ADR-012.
Written for an agent that starts with no other context: read this file, then `studio.md`, then the files named in each phase.

## 1. What we are building

Studio becomes a place where a team designs a product together, with an agent, before engineering starts.

- **Left: the Context.** One living document that is the source of truth for the product. People and the agent build it brick by brick. Each brick is a **fragment** with a type.
- **Right: the prototype.** The running app the agent builds from the Context.
- **No chat rail.** The conversation happens inside the document: the agent asks questions as interactive blocks, the answers become fragments while you watch, and the prototype follows.

The loop:

1. A person asks for something in the composer.
2. The agent asks questions with generated UI (choices, sliders, option cards), placed in the document where they belong.
3. The person answers in place. Each answer is recorded in the Context at once, as a decision.
4. The agent writes the rest of the Context (requirements, flows, constraints) live, then builds or updates the prototype.
5. The person reads the Context, checks the prototype, edits or comments, and asks again. Repeat until both are right.
6. Export: the Context ships with the prototype when engineering starts (the existing Ship flow, or an export for Claude Code or Codex).

**Name.** The document is called **Context** (decided in the envisioning meeting; not "PRD", not "plan"). Its parts are **fragments**. The UI never says "PRD" or "plan mode".

## 2. What is wrong with the current Studio (do not repeat)

Evidence is from `apps/web/src/components/studio/`.

| # | Problem | Evidence |
|---|---------|----------|
| 1 | The only durable record of intent is a chat transcript. Decisions are buried in turns and nobody can find or review them. | `workspace.tsx:429-468` renders every turn; there is no document. |
| 2 | A plan is a markdown card inside one turn. It can't be edited, commented on or kept current. Building it sends the plan text back as a prompt. | `turn-view.tsx:217-246` (`PlanCard`), `workspace.tsx:441-444`. |
| 3 | Questions are one line of plain text in an amber note. The person answers by typing into the same composer, with no options, no structure and no record of the answer as a decision. | `turn-view.tsx:249-261` (`QuestionNote`); `Turn.question` is a string in `lib/studio/types.ts:115`. |
| 4 | The person must pick a mode (Build, Chat, Plan) before they type. It is a system concept, not a user goal. | `Composer` mode picker, `workspace.tsx:149,325`. |
| 5 | A teammate who opens the App sees the owner's whole chat, newest at the bottom, with tool traces. There is no summary and no "what needs me". | `workspace.tsx:433` maps all turns for everyone. |
| 6 | No multiplayer: no presence, no comments, no roles inside an App. Updates arrive by polling and one SSE stream per chat. | `workspace.tsx:173-179`, `use-studio.ts`. |
| 7 | The left rail is one fixed 400–440 px column that is replaced by History or Tasks, so the conversation disappears while you look at versions. | `workspace.tsx:387-419,644`. |
| 8 | The top bar and rail expose engineering concepts first: chat tabs per worktree, ship mode, apply, conflicts, trace ids. | `ChatTabs` `workspace.tsx:59-107`, `turn-view.tsx:85-98`. |
| 9 | Nothing links a statement of intent to the place in the prototype that implements it. | No such field anywhere. |
| 10 | The preview never says whether it reflects the latest intent. It reloads when a turn finishes, and that is all. | `usePreview(..., finished)`. |

Keep: the preview pane and its failure states (`preview-pane.tsx`, `setup-panel.tsx`, `failed-app.tsx`), versions and restore, command approvals, the `StudioClient` interface with a `FakeStudioClient` (`lib/studio/client.ts`, `fake.ts`), shipping, voice.

## 3. Decisions

1. **Editor: BlockNote** (`@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn`). A BlockNote block has a stable id, a type, props and children, which is a fragment. It has custom React blocks, a slash menu, drag handles, Yjs collaboration with cursors, and comment threads. Tiptap would need all of that built by hand, and its collaboration and comments are paid cloud services.
   - **Licence check before installing.** Kiln is MIT. BlockNote's core packages are MPL-2.0 (fine as a dependency). Its `@blocknote/xl-*` packages (AI, PDF and DOCX export, multi-column) are GPL-3.0 or commercial: **do not add them.** Confirm each package's licence field at install time. We write agent edits and exports ourselves.
2. **Realtime: Yjs.** One Y.Doc per App for the Context (BlockNote's document), one for discussion (comment threads, proposals). The API holds both, syncs them over WebSocket and persists them. The agent is a peer with a cursor.
3. **The agent changes the Context only through tools.** The Context is not a file the agent can edit. Every write goes through a server tool that checks the permission of **the person who prompted the turn**.
4. **Permissions are two levels.** An App member is an **editor** or a **viewer**. Editors edit, answer questions and accept proposals; when an editor prompts the agent, the agent may write. Viewers read and comment; when a viewer prompts the agent, its writes become **proposals** an editor accepts or rejects. The creator is the owner (an editor who manages members).
5. **Functional roles are separate from permissions.** A member also has a role (product, design, engineering, security, legal, data, qa). Roles drive ownership and review, never access.
6. **No modes.** The mode picker goes. The agent decides whether a request needs questions, Context changes, a prototype change or only an answer. One primary action remains: **Build prototype** (or **Update prototype**).
7. **Questions never block a run.** `ask` records questions and the turn ends in `needs_you`. Answers start the next turn through the existing follow-up path (`followup(chat.runId)`), so a restart loses nothing and there is no timeout.
8. **One main thread per App in this view.** Parallel chats and worktrees stay in the engine and under Activity, but the page stops showing chat tabs.
9. **Behind a flag.** The new page is the default only when `KILN_STUDIO_CONTEXT=1` (add to `apps/web/src/lib/studio/flag.ts`). The current page stays until the new one passes its acceptance list.
10. **ADR.** This changes ADR-012's page model and adds a second source of truth next to Git. Write a new ADR ("Studio Context") with the next free number before the server phases; do not edit ADR-012.

## 4. Experience

### 4.1 Layout

```
┌─ top bar: App ▾ · Context | My review | Threads ·········· presence · Share · Ship ─┐
├──────────────────────────────────────┬───────────────────────────────────────────────┤
│ CONTEXT (document, max 720 px text)  │ PROTOTYPE                                     │
│                                      │  route ▾   ⟳   device   ↗   inspect           │
│  Brief (catch-up, collapsible)       │  ┌───────────────────────────────────────┐    │
│  # Problem                           │  │ iframe                                │    │
│  ▸ requirement  ▸ decision  ? ask    │  └───────────────────────────────────────┘    │
│  …                                   │  "2 changes behind the Context · Update"      │
│ ─ activity line (one row) ─────────  │                                               │
│ [ composer: Ask, change or build…  ] │                                               │
└──────────────────────────────────────┴───────────────────────────────────────────────┘
```

- The split is draggable (default 46 / 54), remembered per person, with a keyboard toggle to give either pane the full width. Below `lg` the panes are tabs, as today.
- The document is the only scrolling surface on the left. The composer is docked under it and never covers text.
- Tools sit at the edges and in the block's own gutter (Fitts): the block handle on the left, comment and status on the right.

### 4.2 First run (empty App)

The document shows one centred composer and three example requests. After the first prompt the composer moves to the dock (one shared layout animation), the document gets its title, and the first questions arrive. No empty panes: the prototype pane shows what it is waiting for ("Answer the questions and I'll build the first version").

An App with a past opens on a Context being written, never on this empty page: when the Context is empty and the App has earlier conversations (any chat, the old Studio's included) or code beyond its template (an imported repository, applied changes), the snapshot carries `draft: "conversations" | "code"` and an editor's page calls `POST …/context/draft`. The agent reads the code and the quoted conversations (newest first, within a budget), writes the Context from what they support, then asks about the rest. The server drafts at most once per App, so a person who clears the Context, or two people opening it at once, never start a second draft.

### 4.3 Questions (generated UI)

The agent calls `ask` with a typed spec. The page renders it from a fixed registry of components; the agent never sends markup.

| Kind | Renders as | Use |
|------|-----------|-----|
| `single` | Option cards, each with a label, a one-line consequence and an optional "recommended" mark | A choice between 2–4 directions |
| `multi` | Checkable chips | Scope: which of these are in |
| `boolean` | Two large buttons | Yes or no |
| `scale` | A slider with labelled ends | How strict, how many, how fast |
| `rank` | Draggable list | Priorities |
| `text` | One line or a short paragraph | Names, numbers, wording |
| `sketch` | Option cards with a small wireframe (SVG from a fixed set of layout primitives) | Layout direction |

Rules:

- At most 4 options per question and at most 3 questions on screen at once (Hick, Miller). More go into a stepper with "2 of 5" and a progress bar (goal gradient).
- Every question has **Something else** (free text) and **You decide**. "You decide" records an **assumption** fragment, marked as assumed, that anyone can overturn later.
- A question block lives in the document under the section it concerns, and is also listed in the dock ("3 questions waiting") so nobody hunts for it.
- Keyboard: `1`–`4` pick, `Enter` confirms, `Tab` moves to the next question, `S` skips.
- Answering is optimistic. On answer, the question block morphs into a **decision** fragment (the chosen option stays in place, the others fold away, 200 ms), with the question kept as its title and "Decided by Ada · just now" under it. **Change answer** stays on the decision (undo, user control).
- The agent continues when the batch is answered or skipped, or when the person presses **Continue**. Editors answer; a viewer's answer is a proposal.

### 4.4 Watching the agent write

- The agent has a presence chip and a cursor in the document. Text streams in at its cursor; new fragments slide in (150 ms) and carry a tint that fades over 1.2 s.
- The **activity line** above the composer is one row: a state and its object ("Writing Requirements › Sign-in", "Building the prototype: 3 of 7 files", "Waiting for 2 answers"), with Stop. Opening it shows this turn's steps. Tool names, traces and costs live only there.
- If the person scrolls away, the line offers "Jump to where the agent is writing" instead of moving the page.
- The full transcript is **Activity**, a panel that is closed by default and never shown to a newcomer first.

### 4.5 Fragments in the document

- Types: `text`, `section`, `requirement`, `decision`, `assumption`, `constraint`, `question`, `flow`, `risk`, `metric`, `image`. Plain writing stays plain: a `text` fragment has no chrome. Typed fragments get a small left mark (one glyph and one colour per type, used everywhere the type appears).
- Resting state shows the content only. Hover or focus shows the gutter: handle (drag, type menu), owner role, reviewers, version, comment count, link-to-prototype. Selection opens details in place, one level deep (history, provenance, reviewers). No drawer inside a drawer.
- Slash menu inserts a typed fragment. Nesting is by indent, up to five levels; deeper nodes get a breadcrumb.
- Every state change can be undone (`⌘Z` across people-safe Yjs undo) and every fragment has version history with restore.
- Disabled, not hidden: a viewer sees edit controls greyed with "Viewers can comment and propose".

### 4.6 Prototype pane

- Reuses `preview-pane.tsx`. Adds a **freshness chip**: "Up to date with the Context" or "2 changes behind · Update". It compares the Context version the last build read with the current one and lists the changed fragments.
- **Linked fragments.** A fragment with a `preview_reference` shows a target icon. Clicking it sets the route and outlines the element in the prototype. **Inspect** in the pane does the reverse: click an element, the document scrolls to its fragment.
- The pane keeps its own frame and neutral surround so it never reads as document content (figure and ground).

### 4.7 Joining as a teammate (catch-up)

A person who opens an App they did not start, or returns after more than a day, lands on the document with the **Brief** open at the top, not on the chat:

1. Five lines written by the agent: what this is, who it is for, the decisions that matter, what is still open.
2. **Since your last visit**: changed fragments, grouped, each a link.
3. **Needs you**: fragments waiting for your role's review, open questions, threads that mention you.

The Brief is a collapsible block, regenerated when the Context version moves, and cached per version. The owner's prompts are not shown anywhere on this path.

### 4.8 Review lens and threads

- **My review** filters the document to fragments whose `reviewerRoles` include my role. Each shows its lineage (the path of parents, summarised in one line) so it makes sense out of place. Actions: **Looks good**, **Needs changes** (opens a thread), **Add what is missing** (a new fragment or a proposal). A sign-off is tied to the fragment version and goes stale when it changes.
- Reviewer roles are assigned by the agent when it writes a fragment. A person who does not hold a role cannot remove it, and anyone can request another role's review.
- **Threads**: comments on any fragment (BlockNote comments on the discussion doc), several people per thread, resolve and reopen. The Threads view lists every open thread across the document.

### 4.9 Motion and feel

- 150–250 ms, ease-out, transform and opacity only. Layout changes animate (question to decision, composer to dock, pane resize). Everything honours `prefers-reduced-motion`.
- Every action answers within 400 ms (Doherty): edits, answers and comments are optimistic; the server confirms after.
- No modal dialogs except destructive confirmations (the existing `Confirm`). Notifications are inline markers or toasts.

### 4.10 Principles this design is held to

| Principle | Where it shows |
|-----------|----------------|
| Visibility of system status | Activity line, agent cursor, freshness chip, sync and presence indicators |
| Match with the real world | "Context", "decision", "requirement"; no modes, worktrees or shas on the main path |
| User control and freedom | Undo, change answer, Stop, restore a fragment or a prototype version |
| Consistency | One glyph and colour per fragment type; one place for agent internals |
| Error prevention | Viewers' writes are proposals; deleting a parent states how many children go with it |
| Recognition over recall | Questions offer options; lineage and owner shown on the fragment |
| Flexibility and efficiency | Slash menu, number keys on questions, pane shortcuts |
| Minimalist design | Chrome appears on hover or focus; transcript closed by default |
| Recover from errors | Preview failures keep their current plain-language panel; sync conflicts never lose text (CRDT) |
| Help | Example prompts on empty state; tooltips with shortcuts |
| Hick, Miller, chunking | At most 4 options, 3 questions on screen, sections collapse |
| Fitts | Primary action in the dock, block tools in the gutter |
| Goal gradient | Question stepper progress; "2 changes behind" |
| Common region, proximity | A fragment with its threads and proposals is one bounded unit |
| Progressive disclosure | One level: fragment details in place, agent steps behind the activity line |

## 5. Data model

Add to `packages/studio/src/types.ts` (zod, same conventions as `studio.md`) and mirror in `apps/web/src/lib/studio/types.ts` and `packages/sdk-ts`.

```ts
export const FragmentType = z.enum(["text", "section", "requirement", "decision", "assumption", "constraint", "question", "flow", "risk", "metric", "image"]);
export const FunctionalRole = z.enum(["product", "design", "engineering", "security", "legal", "data", "qa"]);
export const Permission = z.enum(["owner", "editor", "viewer"]);

/** Derived from the Context document; the document is the truth. */
export type Fragment = {
  id: string;                 // the BlockNote block id
  appId: string;
  type: FragmentType;
  parent?: string;            // fragment id
  ownerRole: FunctionalRole;
  reviewerRoles: FunctionalRole[];
  content: string;            // plain text of the block, for search, briefs and exports
  version: number;            // +1 each time its content settles (2 s after the last change)
  provenance: Provenance[];   // newest last
  previewReference?: { route: string; selector?: string };
};
export type Provenance = { by: string; kind: "person" | "agent"; onBehalfOf?: string; turnId?: string; questionId?: string; at: string };

export type Member = { appId: string; user: string; permission: Permission; role: FunctionalRole; invitedBy: string; lastSeenAt?: string; lastSeenVersion?: number };

export type Question = {
  id: string;                 // "sq_…"
  appId: string; chatId: string; turnId: string;
  fragmentId: string;         // the question block in the document
  spec: QuestionSpec;         // discriminated by kind: single | multi | boolean | scale | rank | text | sketch
  status: "open" | "answered" | "skipped" | "delegated";
  answer?: unknown;           // validated against spec
  answeredBy?: string; answeredAt?: string;
};

export type Proposal = { id: string; appId: string; by: string; kind: "edit" | "add" | "remove" | "answer"; fragmentId?: string; parent?: string; patch: unknown; status: "open" | "accepted" | "rejected"; decidedBy?: string; reason?: string; at: string };
export type SignOff = { appId: string; fragmentId: string; role: FunctionalRole; by: string; state: "approved" | "changes"; version: number; at: string };
export type ContextState = { appId: string; version: number; builtVersion?: number; briefVersion?: number; brief?: string };
```

Store collections: `studio_members`, `studio_questions`, `studio_proposals`, `studio_signoffs`, `studio_context` (state plus the two Y.Doc snapshots in the object store), `studio_fragments` (derived index, rebuilt from the document; never written by a route).

`ChatMode` stays in the engine. The new page sends no mode; the server picks `build` when the turn may change code and treats a Context-only turn like today's `plan` (code changes discarded).

## 6. Agent tools

Add to `packages/studio/src/tools.ts`, exposed to App runs through the existing MCP path with the run's token. Every tool resolves the turn's prompter and applies their permission.

| Tool | Input | Effect |
|------|-------|--------|
| `context_read` | `{ fragment?: string; depth?: number }` | The document or a subtree as markdown with fragment ids |
| `context_write` | `{ id?: string; type; parent?; after?; content; ownerRole?; reviewerRoles?; previewReference? }` | Insert or replace a fragment. Editor's turn: applied as the agent peer, streamed. Viewer's turn: a `Proposal` |
| `context_remove` | `{ id }` | Same rule |
| `ask` | `{ questions: QuestionSpec[]; under?: string }` (1–5) | Inserts question blocks, records `Question`s, ends the turn in `needs_you` |
| `link_preview` | `{ fragment; route; selector? }` | Sets `previewReference` |
| `mark_built` | `{}` | Sets `builtVersion` to the version the turn read |

Turn instructions (in `studio.ts`, next to the current mode instructions around line 220) change to: read the Context first; ask before assuming, and prefer options over open questions; record every decision and requirement in the Context as you go, in small fragments; build only from the Context; put `data-kiln-fragment="<id>"` on the elements that implement a fragment and call `link_preview`.

The build agent gets a read-only copy at `.kiln/context.md` in its worktree at the start of each turn (already git-excluded). On ship, the Context is exported into the repository as `docs/context.md` and `docs/context.json`.

## 7. Realtime and server

- **Sync endpoint.** A WebSocket at `/api/v1/studio/apps/{id}/context/sync` using `y-protocols` (sync and awareness). `apps/api/src/main.ts` already handles upgrades for previews (lines 50–55); add this beside it. `apps/api/src/app.ts` and `packages/auth/**` are protected paths: do not edit them; authenticate the upgrade with the same session check the routes use, and ask if that needs a change there.
- **Read-only enforcement.** For a viewer's socket the server drops incoming update messages on the Context doc and sends the current state back. The discussion doc accepts updates from every member. The UI also disables editing, but the server is the gate.
- **Agent peer.** Tool calls apply to the server's copy of the doc in small transactions with the origin set to the agent, so every client sees the text arrive and the agent's awareness state carries its cursor and current action.
- **Persistence.** Debounced snapshot (2 s) of each doc to the object store; state row in `studio_context`. A server observer rebuilds `studio_fragments`, bumps `version` on settle and appends provenance.
- **Events** (`packages/events`): `studio.question_asked`, `studio.question_answered`, `studio.context_changed` (debounced, with the version), `studio.proposal_opened`, `studio.review_requested`. Questions also raise the existing `studio.needs_you` with `reason: "question"`.
- **Routes** (`apps/api/src/routes/studio.ts`, same scopes and team checks): `GET …/apps/{id}/context` (state, members, open questions, proposals), `POST …/questions/{id}/answer`, `POST …/questions/continue`, `POST …/proposals/{id}/decide`, `GET|POST|PATCH|DELETE …/apps/{id}/members`, `POST …/fragments/{id}/signoff`, `POST …/fragments/{id}/review-request`, `GET …/apps/{id}/brief`, `GET …/apps/{id}/context/export`.
- **Client.** Extend `StudioClient` with the same methods and a `contextProvider(appId)` that returns a Yjs provider; `FakeStudioClient` implements it in memory with a scripted agent so the page runs with no backend.

## 8. Phases

Kiln's rules apply to each phase: failing tests first, `pnpm typecheck && pnpm test && pnpm lint` (and `pnpm build` for web), docs updated, small pull requests. Work on a branch, not on `main`: the working tree on `main` has unrelated uncommitted changes that must not be swept in.

**Phase 1: the page, against the fake (web only).** This is where the experience is proven; spend the most care here.
- New: `apps/web/src/components/studio/context/` (`context-workspace.tsx`, `document.tsx`, `blocks/` for each fragment type and the question kinds, `dock.tsx` with composer and activity line, `brief.tsx`, `freshness.tsx`), plus the flag and the route switch in `app-page.tsx`.
- Extend `lib/studio/types.ts`, `client.ts`, `fake.ts` (a scripted agent: asks three questions of different kinds, streams fragments, "builds", marks stale after an edit).
- Reuse `preview-pane.tsx`, `composer.tsx` (without the mode picker), `confirm.tsx`.
- Done when, on the fake: first prompt to answered questions to a written Context to a prototype works without touching a mode or a chat tab; answers morph into decisions and can be changed; the activity line and agent cursor show progress; the freshness chip goes stale and clears; a second browser tab on the fake's shared state shows the same document; reduced motion works; `model.test.ts`-style unit tests cover question validation, freshness and catch-up selection.

**Phase 2: server truth.** ADR, then types, store collections, the Yjs endpoint with viewer enforcement, the tools, new turn instructions, answers starting the follow-up turn, events, SDK and MCP additions, `ApiStudioClient`.
- Done when: a real turn asks through `ask` and the questions appear in a second browser at the same time; a viewer's socket cannot change the Context (tested at the protocol level); a viewer's prompt yields proposals only; a restart mid-question loses nothing.

**Phase 3: people.** Members and invites, permissions in the UI, presence and cursors, comment threads, proposals with accept and reject, the Brief and "since your last visit".
- Done when: a newly invited viewer lands on the Brief, sees no transcript, can comment and propose, and cannot edit.

**Phase 4: review.** Reviewer roles from the agent, the My review lens with lineage, sign-offs that go stale, review requests, the Threads view.

**Phase 5: prototype links and export.** `data-kiln-fragment` and a small postMessage bridge in the Next.js template (the preview is on another origin), fragment to element and element to fragment, `mark_built`, Context export on ship.

## 9. Confirmed by the owner (2026-11-23)

Do not stop to ask about these.

1. A viewer's answer to an agent question is a proposal, not an answer.
2. The new page has one thread per App; parallel chats and subagents show under Activity.
3. Only the owner invites members.
4. The Brief is written by a separate cheap call when the Context version moves, cached per version.
5. Functional roles are the fixed list in section 5; teams cannot add their own yet.
