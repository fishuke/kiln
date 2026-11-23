# Studio Context: handover

Read [studio-context.md](studio-context.md) first (the plan), then [studio.md](studio.md) (the current contract), then `CLAUDE.md`.

Repository: `fishuke/kiln`. Branch: `studio-context` (cut from `main` at `827afa5`). Work was paused mid Phase 1 on 2026-11-23 and committed as work in progress.

## Standing instructions from the owner

- Finish Phase 1, then continue with Phases 2, 3, 4 and 5 of the plan, in order. Do not stop for approval between phases; the defaults in section 9 of the plan are confirmed.
- Kiln stays MIT. BlockNote core, react and shadcn only (0.57.0 is installed). Never add an `@blocknote/xl-*` package (GPL or commercial). The inline "Ask the agent" with Accept and Reject is built on Kiln's own agent, not on `@blocknote/xl-ai`.
- No mode picker. Permissions are editor or viewer; a viewer's prompt or answer becomes a proposal.
- The new page is behind `KILN_STUDIO_CONTEXT=1`; the current Studio page must keep working without it.
- Commit on this branch only. Do not push `main`, do not open a pull request. No Linear ticket. Never add Claude as author or co-author, and add no "Generated with" footer.
- Phase 2 touches the server. `apps/api/src/app.ts` and `packages/auth/**` are protected paths: ask before editing them. Phase 2 also needs a new ADR ("Studio Context") before the server work.
- Use the `design-taste-frontend` skill for the visual and motion pass, and hold the page to the principles table in section 4.10 of the plan.

## Phase 1 (web only, on the fake): built, not yet seen in a browser

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

### Still open in Phase 1

- **Nobody has looked at the page.** The machine it was built on has no browser. Everything in the "Done when" list of the plan that is about what a person sees is unchecked: the layout and the block handle's column, BlockNote's shadcn styles next to the app's own, the question-to-decision morph, the agent cursor's position, the composer's move to the dock, the split, the two-tab sync in real tabs, reduced motion. Expect visual fixes.
- The `design-taste-frontend` skill was not available in the session that built the page, so the visual and motion pass against section 4.10 has not been done with it.
- Not built in Phase 1 by design (later phases): comment threads, My review, Threads, members and invites, Inspect and prototype links beyond the route, export.
