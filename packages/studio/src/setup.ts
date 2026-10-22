import type { PackageManager, AppSetup } from "./types";

/** Files Studio looks for in an imported repository. */
export const ENV_EXAMPLES = [".env.example", ".env.sample", ".env.local.example"];

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** Package manager, install and dev command for an imported repository, from its files. */
export function detectSetup(input: { files: string[]; packageJson?: string }): Pick<AppSetup, "packageManager" | "install" | "devDetected"> {
  const lock = LOCKFILES.find(([file]) => input.files.includes(file));
  const pm = lock?.[1] ?? "npm";
  const install =
    pm === "pnpm"
      ? "pnpm install --prefer-offline"
      : pm === "yarn"
        ? "yarn install"
        : pm === "bun"
          ? "bun install"
          : // Without a lockfile, npm would write one, and the first turn would commit it.
            `npm install --no-audit --no-fund${lock ? "" : " --no-package-lock"}`;
  return { packageManager: pm, install: [install], devDetected: devScript(pm, input.packageJson) };
}

function devScript(pm: PackageManager, packageJson?: string): string | undefined {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(packageJson ?? "{}") as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return undefined;
  }
  const dev = scripts.dev;
  if (typeof dev !== "string" || !dev.trim()) return undefined;
  const run = `${pm} run dev`;
  // npm needs `--` to pass flags to the script; pnpm, yarn and bun pass them through.
  const sep = pm === "npm" ? " --" : "";
  if (/(^|\s)(-p|--port)(\s|=)/.test(dev)) return run;
  if (/\bnext dev\b/.test(dev)) return `${run}${sep} --port {port} --hostname 0.0.0.0`;
  if (/(^|\s)vite(\s|$)/.test(dev)) return `${run}${sep} --port {port} --host 0.0.0.0`;
  return run;
}

/** The keys an example env file declares (KEY=…, optionally `export KEY=…`). */
export function envKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && !keys.includes(m[1]!)) keys.push(m[1]!);
  }
  return keys;
}

export function devCommand(setup: Pick<AppSetup, "devDetected" | "devOverride">): string | undefined {
  return setup.devOverride ?? setup.devDetected;
}

/** The port in a dev server's "listening on" line, if it prints one. */
export function listenPort(line: string): number | undefined {
  const m = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d{2,5})\b/.exec(line);
  return m ? Number(m[1]) : undefined;
}
