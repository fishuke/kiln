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
  /** Runner image with the harness CLIs and the template baked in (defaults to the server's runner image). */
  image?: string;
  egress: string[];
};

export const TEMPLATES: Record<string, Template> = {
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    scaffold: [
      "test -d /opt/kiln/templates/nextjs && cp -a /opt/kiln/templates/nextjs/. . || pnpm dlx create-next-app@15 . --ts --tailwind --app --eslint --use-pnpm --yes --skip-install",
    ],
    install: ["pnpm install --prefer-offline"],
    dev: "pnpm next dev --port {port} --hostname 0.0.0.0",
    egress: ["registry.npmjs.org"],
  },
};
