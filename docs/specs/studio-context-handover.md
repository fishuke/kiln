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

## Done so far (Phase 1, web only)

- `apps/web/package.json`: BlockNote 0.57.0, `yjs`, `y-protocols`, `y-prosemirror`.
- `apps/web/src/lib/studio/types.ts`, `client.ts`: the Context types and client methods.
- `apps/web/src/lib/studio/context-model.ts` (+ test, 25 passing): pure logic.
- `apps/web/src/lib/studio/fake-context.ts` (+ test, 9 passing), `fake.ts`: the fake's Context state and scripted agent.
- `apps/web/src/lib/studio/context-doc.ts`, `context-sync.ts`: the shared document and its sync.
- `apps/web/src/components/studio/context/`: `schema.tsx`, `blocks/fragment-block.tsx`, `blocks/question-block.tsx`, `doc-writer.ts`, `suggestions.ts`, `fragment-meta.tsx`, `context-ui.tsx`.
- The two new test files pass and `tsc --noEmit` in `apps/web` is clean at this commit.

## Not done yet (Phase 1)

- The workspace itself: Context left, prototype right, draggable split, tabs below `lg`.
- The document component that mounts BlockNote with the schema and the shared doc, and the agent cursor.
- The dock: composer without a mode picker, the one-row activity line with Stop, "N questions waiting".
- The inline "Ask the agent" UI on a selection, and Accept and Reject for suggestions (`suggestions.ts` exists; nothing renders it yet).
- The Brief, the freshness chip on the prototype pane, the viewer state and proposals UI, the Activity panel.
- The `KILN_STUDIO_CONTEXT` flag in `lib/studio/flag.ts` and the switch in `components/studio/app-page.tsx`.
- Not run yet: `pnpm lint`, `pnpm build`, the full `pnpm test`. Nothing has been opened in a browser.

Check each existing file before relying on it: the session that wrote them was stopped mid-turn, so the last file it touched may be incomplete even though it typechecks.
