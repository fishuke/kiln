import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Runner } from "@kiln/schema";
import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootCheck, devCommand, loadTemplates, Template, TEMPLATE_DIR, TEMPLATES_DIR, waitForHttp } from "./studio-template.js";

const ROOT = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("Studio's Next.js template", () => {
  const nextjs = loadTemplates().nextjs!;

  it("validates against the Template schema", () => {
    expect(Template.parse(nextjs)).toEqual(nextjs);
    expect(nextjs.id).toBe("nextjs");
  });

  it("rejects a template whose dev command has no {port} or doesn't bind 0.0.0.0", () => {
    expect(Template.safeParse({ ...nextjs, dev: "pnpm next dev --hostname 0.0.0.0" }).success).toBe(false);
    expect(Template.safeParse({ ...nextjs, dev: "pnpm next dev --port {port}" }).success).toBe(false);
  });

  it("fills in the dev server port", () => {
    expect(devCommand(nextjs, 4101)).toBe("pnpm next dev --turbopack --port 4101 --hostname 0.0.0.0");
  });

  it("hard-links the project's node_modules into a worktree before installing", () => {
    expect(nextjs.install[0]).toMatch(/^test -d node_modules \|\| cp -al .*--git-common-dir.*\|\| true$/);
    expect(nextjs.install.at(-1)).toBe("pnpm install --prefer-offline --ignore-workspace");
  });

  it("allows the preview domain's hosts as dev origins, without the port", async () => {
    const config = join(ROOT, "templates/nextjs/next.config.ts");
    const load = async (domain?: string) => {
      if (domain) process.env.KILN_STUDIO_PREVIEW_DOMAIN = domain;
      else delete process.env.KILN_STUDIO_PREVIEW_DOMAIN;
      vi.resetModules();
      const mod = await import(config);
      return mod.default as { allowedDevOrigins?: string[] };
    };
    try {
      expect((await load("preview.kiln.example.com")).allowedDevOrigins).toEqual(["*.preview.kiln.example.com"]);
      expect((await load("preview.localhost:4000")).allowedDevOrigins).toEqual(["*.preview.localhost"]);
      expect((await load()).allowedDevOrigins).toBeUndefined();
    } finally {
      delete process.env.KILN_STUDIO_PREVIEW_DOMAIN;
    }
  });

  it("copies the directory the Studio image installs", () => {
    const dockerfile = readFileSync(join(ROOT, "runners/images/node/Dockerfile"), "utf8");
    expect(nextjs.scaffold[0]!.replaceAll("{templates}", TEMPLATES_DIR)).toContain(`cp -a ${TEMPLATE_DIR}/. .`);
    expect(dockerfile).toContain(`WORKDIR ${TEMPLATE_DIR}`);
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
  });

  it("is a Next.js 15 app with a lockfile, shadcn and agent instructions", () => {
    const dir = join(ROOT, "templates/nextjs");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies.next).toMatch(/^15\./);
    expect(pkg.packageManager).toMatch(/^pnpm@/);
    for (const f of ["pnpm-lock.yaml", "components.json", "lib/utils.ts", "components/ui/button.tsx", "components/ui/card.tsx", "app/page.tsx", "AGENTS.md"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8").trim()).toBe("@AGENTS.md");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(".kiln/studio.json");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/node_modules/);
  });

  it("needs no host but the npm registry at run time", () => {
    // next/font/google downloads fonts when the dev server starts; the sandbox can't reach Google.
    const sources = files(join(ROOT, "templates/nextjs")).filter((f) => /\.(tsx?|css|mjs)$/.test(f));
    for (const f of sources) expect(readFileSync(f, "utf8"), f).not.toMatch(/next\/font\/google|https?:\/\//);
  });

  it("has a runner definition for the Studio image with the template's egress", () => {
    const runner = Runner.parse(parse(readFileSync(join(ROOT, "runners/studio.yaml"), "utf8")));
    expect(runner.image).toBe("kiln-runner-studio:local");
    expect(runner.egress).toEqual(nextjs.egress);
  });
});

describe("waitForHttp", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("waits until the port answers, whatever the status", async () => {
    const probe = createServer().listen(0);
    await new Promise((r) => probe.once("listening", r));
    const port = (probe.address() as AddressInfo).port;
    probe.close();
    setTimeout(() => {
      server = createServer((_, res) => res.writeHead(500).end()).listen(port, "127.0.0.1");
    }, 300);
    const ms = await waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 5000, intervalMs: 50 });
    expect(ms).toBeGreaterThanOrEqual(250);
  });

  it("fails with the URL when nothing answers in time", async () => {
    await expect(waitForHttp("http://127.0.0.1:9/", { timeoutMs: 200, intervalMs: 50 })).rejects.toThrow(/127\.0\.0\.1:9.*200 ms/);
  });
});

const image = process.env.KILN_STUDIO_BOOT_IMAGE;
const docker = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Opt in with KILN_STUDIO_BOOT_IMAGE=kiln-runner-studio:local; skipped without Docker or the variable (CI).
describe.skipIf(!image || !docker)("Studio image boot", () => {
  it("creates a project and a chat worktree and answers on the dev port within 30 s", { timeout: 120_000 }, async () => {
    const result = await bootCheck({ image: image!, template: loadTemplates().nextjs! });
    console.log(`studio boot: ${JSON.stringify(result)}`);
    expect(result.status).toBeLessThan(500);
    expect(result.totalMs).toBeLessThan(30_000);
  });
});
