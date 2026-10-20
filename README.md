# Kiln

Kiln is a self-hostable software-factory platform. It is built with the factory it describes.

- Plan: [docs/plan/PLAN.md](docs/plan/PLAN.md)
- Rules for Claude Code: [CLAUDE.md](CLAUDE.md)
- Warp factory definition: [factory/](factory/)
- Our docs: [docs/](docs/)

## Layout

```text
apps/web/      Next.js + shadcn/ui dashboard
factory/       Warp Factories definition tree (schema v1alpha1)
docs/          plan, setup record, and reference docs
```

## Run

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build
```

Node 22 and pnpm 10 are required.
