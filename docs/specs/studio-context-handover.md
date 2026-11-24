# Studio Context: handover

Read [studio-context.md](studio-context.md) first (the plan), then [studio.md](studio.md) (the current contract), then `CLAUDE.md`.

Repository: `fishuke/kiln`. Branch: `studio-context` (cut from `main` at `827afa5`). On 2026-11-23 Phase 1 was built and Phase 2 was started; the state is below.

## Standing instructions from the owner

Updated 2026-11-24. Where these differ from the first handover, these win.

- Build all the phases, in order, without stopping for approval. The defaults in section 9 of the plan are confirmed.
- Push directly to `main`. No pull request, no Linear ticket. `main` was fast-forwarded to this work on 2026-11-24; the `studio-context` branch is kept at the same commit.
- Deploy when a phase works. Kiln runs on anton's Coolify (app `kiln`, built from `main` with `docker-compose.prod.yml`).
- Never add Claude as author or co-author, and add no "Generated with" footer. Commit as `fishuke <fishukee@gmail.com>`.
- ADR-019 is accepted. The server's agent writes the Yjs document itself (`packages/studio/src/context-ydoc.ts`); no `@blocknote/server-util`.
- Kiln stays MIT. BlockNote core, react and shadcn only (0.57.0). Never add an `@blocknote/xl-*` package (GPL or commercial). The inline "Ask the agent" is built on Kiln's own agent.
- No mode picker. Permissions are editor or viewer; a viewer's prompt or answer becomes a proposal.
- The new page is behind `KILN_STUDIO_CONTEXT=1`; the current Studio page must keep working without it.
- The owner allowed `apps/api/src/app.ts` to export its session check for the Context socket. It turned out not to be needed (ADR-019, Transport); the other protected paths still need asking.
- Use the `design-taste-frontend` skill for the visual and motion pass when it is available, and hold the page to the principles table in section 4.10 of the plan.
- anton has been unstable (random crashes, an out-of-memory kill on 2026-11-24). Keep builds and test runs light there: one directory at a time, no parallel suites.

## Phase 1 (web only, on the fake): built and checked in a browser

Run it: `NEXT_PUBLIC_KILN_STUDIO_FAKE=1 KILN_STUDIO_CONTEXT=1 pnpm --filter @kiln/web dev`, then open `/studio/sa_demo` (a written Context) or `/studio/sa_demo?seed=empty` (first run). "View as" in the top bar switches between the owner, an editor and a viewer.

- `lib/studio/flag.ts` (`studioContextEnabled`, read in `app/studio/[app]/page.tsx`) and the switch in `components/studio/app-page.tsx`. The Context page loads with `next/dynamic`, so the current page's bundle is unchanged. Without the flag, or with a client that has no `context` (the API client, until Phase 2), the current page renders.
- `lib/studio/types.ts`, `client.ts`, `context-model.ts`, `context-doc.ts`, `context-sync.ts`, `fake-context.ts`, `fake.ts`: types, client methods, pure logic, the shared document and the fake's scripted agent.
- `components/studio/context/`:
  - `context-workspace.tsx`: the page. Top bar, draggable split (default 46/54, saved per person, ⌥1 and ⌥2 give a pane the full width), tabs below `lg`, first-run state with three example prompts, catch-up.
  - `document.tsx`: BlockNote on the shared Yjs document with `schema.tsx`, the slash menu with typed fragments, the agent's cursor, follow and "jump to where the agent is writing", "Ask the agent" on a selection (`ask-agent.tsx`, `suggestions.ts`) with Accept and Reject.
  - `dock.tsx`: the one-row activity line with Stop and this turn's steps, "N questions waiting", Continue, Build or Update prototype. The composer is `composer.tsx` without the mode picker.
  - `brief.tsx`, `freshness.tsx`, `panels.tsx` (Proposals, Activity), `people.tsx` (presence), `use-context.ts`.
  - `blocks/fragment-block.tsx`, `blocks/question-block.tsx`, `doc-writer.ts`, `fragment-meta.tsx`, `context-ui.tsx`.
- `preview-pane.tsx` takes a controlled route, `tabs={false}`, `actions` and a `footer` (the freshness chip). `composer.tsx` makes the mode picker and Model Selector optional. `globals.css` has the `ctx-*` styles.
- Tests: `context-model.test.ts` (25), `fake-context.test.ts` (9), `context-sync.test.ts` (4), `flag.test.ts` (1) and `components/studio/context/doc-writer.test.ts` (7), which runs the real BlockNote editor without a browser: the document writer, the scripted agent from first prompt to a built prototype, stale and fresh, and suggestions.
- Passing on 2026-11-23: `tsc --noEmit` and `vitest run` in `apps/web` (310 tests), `eslint` on the Studio code, `next build`.

### Checked in a browser (2026-11-24)

Headless Chrome 158 driven with `puppeteer-core`, on the dev server with the fake. All of these passed with no console or page errors:

- First run: the centred composer and examples, the first prompt, the title and problem streaming in with the agent's cursor on the last character, three questions of different kinds.
- Answering by keyboard (`1`–`4`, `Enter`, focus moving to the next question) and by mouse; each answer settles into a decision; Change answer, Decide yourself and Skip.
- The fragments written from the answers, the build, the prototype in the frame, "Up to date with the Context"; a hand edit gives "1 change behind" and Update clears it; changing an answer rewrites its fragments.
- Ask the agent on a fragment and on a selection, the suggestion marks, Accept and Reject; the slash menu with the typed fragments.
- A second tab shows the same document and receives typing from the first.
- The split by drag and arrow keys (saved per person), ⌥1 and ⌥2, tabs below `lg`.
- A viewer lands on the open Brief with "since your last visit", can't edit, and their prompt becomes a proposal; the owner accepts it and it is in the Context. Activity lists the turns.
- With `prefers-reduced-motion`, the CSS transitions and the arrival tint are off.
- Without `KILN_STUDIO_CONTEXT`, the current Studio page renders as before.

Found and fixed by this pass: the agent cursor lagged the text; the prototype pane offered Build while the agent was still writing; the gutter icons were oversized; a suggestion glued to the old text became a link ("device.It") and its colours didn't show; the selection toolbar was wider than the pane; a tooltip's arrow covered "Change answer" and took the click; a rewrite after a changed answer was appended to the old sentence.

### Still open in Phase 1

- Checked with scripts and screenshots, not by a person using it. Not checked: dark theme, Firefox and Safari, a real phone, the feel of the animations (question to decision, composer to dock), dragging blocks, a question batch larger than three (the stepper).
- In the app shell the sidebar stays open at phone width, so the page is cramped there. The sidebar belongs to the shell, not to this page; whether the current Studio page is cramped the same way was not checked.
- The Accept and Reject pill sits just under the end of a suggestion and covers part of the next line while it is there.
- The `design-taste-frontend` skill was not available in the sessions that built and checked the page, so the visual and motion pass against section 4.10 has not been done with it.
- Not built in Phase 1 by design (later phases): comment threads, My review, Threads, members and invites, Inspect and prototype links beyond the route, export.

## Phase 2 (server truth): started

Done:

- `docs/adr/0019-studio-context.md` (status: proposed, like ADR-012) and its line in `docs/adr/README.md`.
- `packages/studio/src/context-types.ts`, `context-doc.ts`, `context-model.ts` (+ `context-types.test.ts`, `context-model.test.ts`, 28 passing), exported from the package: the same shapes and rules as the web's, for the server to enforce. The web keeps its own copy because the page doesn't depend on `packages/studio`.

Not done: store collections, the Yjs endpoint with viewer enforcement, the six tools, the new turn instructions, answers starting the follow-up turn, events, routes, SDK and MCP additions, `ApiStudioClient`'s `context`.

Three things need the owner before the rest of Phase 2:

1. **Authenticating the WebSocket upgrade.** `apps/api/src/main.ts` only upgrades preview hosts today. The Context socket needs the session check the routes use, which lives behind `apps/api/src/app.ts` and `packages/auth/**` (protected). New routes fit in `apps/api/src/routes/studio.ts` (`register`) without touching `app.ts`; the upgrade check may not. Say whether `app.ts` or `packages/auth` may export what the upgrade needs.
2. **How the server's agent peer writes BlockNote's document.** The Context is BlockNote's ProseMirror tree in a `Y.XmlFragment`. BlockNote's editor only binds to Yjs once it has a DOM view (checked: two headless editors on synced documents don't see each other), so the server can't use a headless editor as the agent peer. The choices are `@blocknote/server-util` (a new dependency that brings jsdom; check its licence first, per the plan), or Kiln writing the `Y.XmlFragment` itself for the block types in `schema.tsx`. `apps/api` and `packages/studio` also need `yjs` and `y-protocols` (both MIT).
3. **ADR-019 is proposed.** Accept it or change it.

## Tests on the machine this was built on (2026-11-23)

- `pnpm typecheck` and `pnpm lint`: clean. `next build`: passes.
- `apps/web`: 310 passing. `apps/api`: 194. `e2e`: 55. `scripts`: 17 (1 skipped). `packages`: 817 passing, 2 failing, both in `packages/studio/src/studio.test.ts`; that file also fails on `main` at `827afa5` (3 failures there in one run; which tests fail varies between runs), and this branch doesn't touch it or what it tests. The cause was not looked into.
- `pnpm test` in one go often dies at start with vitest's "Channel closed" (a worker crash before any test reports; it comes and goes between identical runs, and was not seen or ruled out on `main`). Running the directories one at a time, with a retry, gets through.
