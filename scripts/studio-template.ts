// Studio's App templates (templates/templates.json) and a boot check for the Studio runner image.
//   pnpm tsx scripts/studio-template.ts [image]   boots the Next.js template in the image and prints the timings
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** Where the Studio runner image keeps the Next.js template (the "studio" stage of runners/images/node/Dockerfile). */
export const TEMPLATES_DIR = "/opt/kiln/templates";
export const TEMPLATE_DIR = `${TEMPLATES_DIR}/nextjs`;

/** The `Template` shape from docs/specs/studio.md. */
export const Template = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    scaffold: z.array(z.string().min(1)).min(1),
    install: z.array(z.string().min(1)),
    dev: z
      .string()
      .refine((s) => s.includes("{port}"), "dev must contain {port}")
      .refine((s) => s.includes("0.0.0.0"), "dev must bind 0.0.0.0"),
    /** The preview is ready when GET `path` on the dev port answers with any status. */
    ready: z
      .object({ path: z.string().startsWith("/"), timeoutMs: z.number().int().positive() })
      .strict()
      .optional(),
    image: z.string().min(1).optional(),
    egress: z.array(z.string().min(1)),
  })
  .strict();
export type Template = z.infer<typeof Template>;

export function loadTemplates(file = join(import.meta.dirname, "../templates/templates.json")): Record<string, Template> {
  return z.record(z.string(), Template).parse(JSON.parse(readFileSync(file, "utf8")));
}

export function devCommand(template: Template, port: number): string {
  return template.dev.replaceAll("{port}", String(port));
}

/** Polls `url` until it answers with any HTTP status; resolves with the milliseconds it took. */
export async function waitForHttp(url: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<number> {
  const start = performance.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.ceil(Math.max(1000, opts.timeoutMs - (performance.now() - start)))) });
      await res.body?.cancel();
      return Math.round(performance.now() - start);
    } catch {
      if (performance.now() - start >= opts.timeoutMs) throw new Error(`${url} did not answer within ${opts.timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 200));
    }
  }
}

export type BootResult = { scaffoldMs: number; worktreeMs: number; installMs: number; devMs: number; totalMs: number; status: number };

/**
 * Does what Studio does for a new App and its first chat, in a container of `image`: scaffold
 * <workdir>/project, commit, add the chats/<id> worktree, install, start the dev server and wait
 * for it to answer. The registry is pointed at a closed port, so an install that needs the network fails.
 */
export async function bootCheck(opts: { image: string; template: Template; port?: number }): Promise<BootResult> {
  const port = opts.port ?? 4101;
  const ready = opts.template.ready ?? { path: "/", timeoutMs: 60_000 };
  const { stdout } = await run("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    `127.0.0.1::${port}`,
    "-e",
    "npm_config_registry=http://127.0.0.1:9/",
    opts.image,
    "sleep",
    "infinity",
  ]);
  const id = stdout.trim();
  const sh = async (cwd: string, script: string) => {
    const t = performance.now();
    await run("docker", ["exec", "-w", cwd, id, "sh", "-ec", script], { maxBuffer: 16 * 1024 * 1024 });
    return Math.round(performance.now() - t);
  };
  try {
    const mapped = (await run("docker", ["port", id, String(port)])).stdout.trim().split("\n")[0]!;
    const start = performance.now();
    const scaffoldMs = await sh("/workspace", ["mkdir -p project && cd project", ...opts.template.scaffold.map((c) => c.replaceAll("{templates}", TEMPLATES_DIR))].join("\n"));
    const worktreeMs = await sh(
      "/workspace/project",
      [
        "git init -q -b main",
        "printf '.kiln/\\n' >> .git/info/exclude",
        "git add -A",
        "git -c user.name=kiln -c user.email=kiln@localhost commit -qm 'New app'",
        "git worktree add -q ../chats/sc_boot -b chat/sc_boot",
      ].join("\n"),
    );
    const installMs = await sh("/workspace/chats/sc_boot", opts.template.install.join("\n") || "true");
    await run("docker", ["exec", "-d", "-w", "/workspace/chats/sc_boot", id, "sh", "-c", `${devCommand(opts.template, port)} > /tmp/dev.log 2>&1`]);
    const url = `http://${mapped}${ready.path}`;
    const devMs = await waitForHttp(url, { timeoutMs: ready.timeoutMs });
    const totalMs = Math.round(performance.now() - start);
    const res = await fetch(url);
    return { scaffoldMs, worktreeMs, installMs, devMs, totalMs, status: res.status };
  } finally {
    await run("docker", ["rm", "-f", id]).catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await bootCheck({ image: process.argv[2] ?? "kiln-runner-studio:local", template: loadTemplates().nextjs! });
  console.log(JSON.stringify(result, null, 2));
}
