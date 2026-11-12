import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepo } from "./scan";

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "kiln-scan-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("scanRepo", () => {
  it("profiles a pnpm + vitest repo on GitHub Actions", () => {
    const dir = repo({
      "package.json": JSON.stringify({
        scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", build: "next build" },
        dependencies: { next: "15", "@sentry/nextjs": "8" },
      }),
      "pnpm-lock.yaml": "",
      ".github/workflows/ci.yml": "on: push",
      "CLAUDE.md": "# rules",
    });
    const p = scanRepo(dir);
    expect(p.languages).toContain("typescript");
    expect(p.packageManager).toBe("pnpm");
    expect(p.commands).toMatchObject({
      install: "pnpm install --frozen-lockfile",
      test: "pnpm test",
      lint: "pnpm lint",
      typecheck: "pnpm typecheck",
      build: "pnpm build",
    });
    expect(p.ci).toEqual({ provider: "github-actions", files: [".github/workflows/ci.yml"] });
    expect(p.agentInstructions).toEqual(["CLAUDE.md"]);
    expect(p.mcpSuggestions.map((m) => m.server)).toContain("sentry");
    expect(p.mcpSuggestions.find((m) => m.server === "sentry")?.evidence).toBe("dependency @sentry/nextjs");
  });

  it("uses language defaults for a Python repo without scripts", () => {
    const p = scanRepo(repo({ "pyproject.toml": "[project]\nname='x'\ndependencies=['pytest','sentry-sdk']", "uv.lock": "" }));
    expect(p.languages).toEqual(["python"]);
    expect(p.packageManager).toBe("uv");
    expect(p.commands.install).toBe("uv sync");
    expect(p.commands.test).toBe("uv run pytest");
    expect(p.mcpSuggestions.map((m) => m.server)).toContain("sentry");
  });

  it("suggests a runner with setup commands", () => {
    const p = scanRepo(repo({ "package.json": "{}", "package-lock.json": "{}" }));
    expect(p.packageManager).toBe("npm");
    expect(p.runner).toContain("npm ci");
    expect(p.runner).toContain("backend: docker");
  });

  it("returns an empty profile for an empty folder", () => {
    const p = scanRepo(repo({}));
    expect(p.languages).toEqual([]);
    expect(p.packageManager).toBeUndefined();
    expect(p.ci).toBeUndefined();
  });
});
