# Working in this app

This is a Kiln Studio app: Next.js 15 (App Router), TypeScript, Tailwind CSS 4 and shadcn/ui. A person watches the preview while you work, so every change should show up there quickly and nothing should break it.

## The dev server

- Studio already runs `next dev` for this directory and shows it in the preview. It reloads on every save.
- Never stop it, restart it, or start a second one. Never run `next build` or `next start`; they fight the dev server over `.next/`.
- If the preview breaks, read the error, fix the code, and save. Don't restart anything.

## How to make changes

- Keep turns small: do what was asked, then stop. Prefer a working small step over a large unfinished one.
- Pages live in `app/` (`app/page.tsx` is `/`; `app/about/page.tsx` is `/about`). Shared pieces go in `components/`.
- Use the components in `components/ui/` (Button, Card, Input, Label, Badge, Separator) before writing your own. The shadcn CLI can't reach its registry from here, so write a new shadcn component by hand in `components/ui/`, in the same style, on the primitives from `radix-ui` (already installed: `import { Dialog } from "radix-ui"`).
- Style with Tailwind classes and the theme colors (`bg-background`, `text-muted-foreground`, `bg-primary` and so on) from `app/globals.css`, not hard-coded hex values.
- Icons come from `lucide-react`. Fonts are Geist (`font-sans`, `font-mono`), loaded locally.
- Components are server components by default; add `"use client"` only to files that need state, effects or event handlers.
- Don't add dependencies unless the task needs one. The network may only reach the npm registry; don't fetch fonts, images or APIs from other hosts.
- Check types with `pnpm typecheck` when you've changed more than one file.
- Don't push or create branches, and don't commit unless Studio's instructions for the turn ask you to. Studio checkpoints your changes after each turn.

## At the end of a turn

Write `.kiln/studio.json` with a one-line `title` of what changed (for the version history), a two-sentence `summary`, and a `question` only if you need the person to decide something:

```json
{ "title": "Add a pricing page", "summary": "Added /pricing with three plan cards. The middle plan is highlighted." }
```
