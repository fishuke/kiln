/** How a Studio app starts and how its dev server runs. */
export type Template = {
  id: string;
  name: string;
  /** Run in <workdir>/app, an empty directory, to create the app. Trusted commands. */
  scaffold: string[];
  /** Run in each worktree before its dev server starts. */
  install: string[];
  /** Dev server command; {port} is replaced. It must bind 0.0.0.0 (or 127.0.0.1 on the local backend). */
  dev: string;
  /** The preview is ready when GET `path` on the dev port answers with any status; it fails after `timeoutMs`. */
  ready?: { path: string; timeoutMs: number };
  /** Runner image with the harness CLIs and the template baked in (defaults to the server's runner image). */
  image?: string;
  egress: string[];
};

/** The ready check for imported apps and templates that set none. */
export const DEFAULT_READY = { path: "/", timeoutMs: 60_000 };

/** Must match templates/templates.json, which the studio runner image is built from (a test checks it). */
export const TEMPLATES: Record<string, Template> = {
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    scaffold: [
      "test -d /opt/kiln/templates/nextjs && cp -a /opt/kiln/templates/nextjs/. . || pnpm dlx create-next-app@15 . --ts --tailwind --app --eslint --use-pnpm --yes --skip-install",
    ],
    install: [
      // A worktree hard-links the app's node_modules (0.2 s) instead of copying it out of the image's store (20 s).
      'test -d node_modules || cp -al "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/node_modules" node_modules 2>/dev/null || true',
      "pnpm install --prefer-offline",
    ],
    dev: "pnpm next dev --turbopack --port {port} --hostname 0.0.0.0",
    ready: { path: "/", timeoutMs: 60000 },
    egress: ["registry.npmjs.org"],
  },
};
