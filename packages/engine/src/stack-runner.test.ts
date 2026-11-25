import { Stack } from "@kiln/schema";
import type { Sandbox } from "@kiln/sandbox";
import { FakeSandboxProvider } from "@kiln/sandbox/testing";
import { afterEach, describe, expect, it } from "vitest";
import { FakeStackRunner, SandboxStackRunner, type StackRunner } from "./stack-runner";

/** A tiny HTTP server: answers GET / with its env as JSON, after an optional delay. */
const server = (delayMs = 0) =>
  `setTimeout(() => require("node:http").createServer((q, s) => { s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ env: process.env, url: q.url })); }).listen(Number(process.argv[2]), () => console.log("listening on " + process.argv[2])), ${delayMs});\n`;

// Every stack gets ports of its own, so a test never reaches another test's servers.
let next = 42000 + Math.floor(Math.random() * 1000) * 3;
let ports = { db: 0, api: 0, web: 0 };

const stack = () => {
  ports = { db: next, api: next + 1, web: next + 2 };
  next += 3;
  return stackAt();
};
const stackAt = () =>
  Stack.parse({
    name: "shop",
    services: {
      db: { kind: "datastore", start: `node db.js ${ports.db}`, port: ports.db, seed: "echo seeded > seeded.txt" },
      api: { repo: "acme/api", install: "echo installed >> installs.txt", migrate: "echo migrated > migrated.txt", start: `node server.js ${ports.api}`, port: ports.api, health: "/health", depends_on: ["db"], env: { DB: "${services.db.url}" } },
      web: {
        repo: "acme/web",
        surface: "Customer site",
        start: `node server.js ${ports.web}`,
        port: ports.web,
        depends_on: ["api"],
        env: { NEXT_PUBLIC_API_URL: "${services.api.url}", API_URL: "${services.api.url}" },
        env_public: ["NEXT_PUBLIC_API_URL"],
      },
    },
  });

async function sandboxWith(files: Record<string, string>): Promise<Sandbox> {
  const sb = await new FakeSandboxProvider().create({ runner: { image: "node:22", setupCommands: [], workspaceSetupCommands: [], egress: [] } as never, repos: [] } as never);
  for (const [path, content] of Object.entries(files)) await sb.writeFile(path, content);
  return sb;
}

const open: StackRunner[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.down();
});

describe("SandboxStackRunner", () => {
  it("starts datastores, seeds, installs, migrates and starts services in dependency order, each with its URL", async () => {
    const sb = await sandboxWith({ "db/db.js": server(), "api/server.js": server(150), "web/server.js": server() });
    const runner = new SandboxStackRunner(sb, { readyTimeoutMs: 10_000 });
    open.push(runner);
    const up = await runner.up({
      stack: stack(),
      dirs: { db: "db", api: "api", web: "web" },
      publicUrl: (svc) => `https://pr-7-${svc}.preview.test`,
    });
    expect(up.healthy).toBe(true);
    expect(up.services.map((s) => [s.service, s.status, s.url])).toEqual([
      ["db", "ready", "https://pr-7-db.preview.test"],
      ["api", "ready", "https://pr-7-api.preview.test"],
      ["web", "ready", "https://pr-7-web.preview.test"],
    ]);
    expect(up.services.find((s) => s.service === "web")!.surface).toBe("Customer site");
    expect(await sb.readFile("db/seeded.txt")).toBe("seeded\n");
    expect(await sb.readFile("api/migrated.txt")).toBe("migrated\n");
    const res = (await (await fetch(`http://127.0.0.1:${ports.web}/`)).json()) as { env: Record<string, string> };
    expect(res.env.NEXT_PUBLIC_API_URL).toBe("https://pr-7-api.preview.test");
    expect(res.env.API_URL).toBe(`http://localhost:${ports.api}`);
    expect(runner.logs("web").join("\n")).toContain(`listening on ${ports.web}`);
  });

  it("stops every process a service started, so its port is free again", async () => {
    const sb = await sandboxWith({ "db/db.js": server(), "api/server.js": server(), "web/server.js": server() });
    const runner = new SandboxStackRunner(sb, { readyTimeoutMs: 10_000 });
    const s = stack();
    // A start command with more after it runs node as a child of sh, as dash and yarn do.
    s.services.web!.start = `node server.js ${ports.web}; echo stopped`;
    expect((await runner.up({ stack: s, dirs: { db: "db", api: "api", web: "web" }, publicUrl: (svc) => `https://${svc}.test` })).healthy).toBe(true);
    await runner.down();
    for (const port of [ports.db, ports.api, ports.web]) await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();
  });

  it("installs once per lockfile", async () => {
    const sb = await sandboxWith({ "db/db.js": server(), "api/server.js": server(), "api/pnpm-lock.yaml": "a", "web/server.js": server() });
    const runner = new SandboxStackRunner(sb, { readyTimeoutMs: 10_000 });
    open.push(runner);
    const input = { stack: stack(), dirs: { db: "db", api: "api", web: "web" }, publicUrl: (svc: string) => `https://${svc}.test` };
    await runner.up(input);
    await runner.down();
    await runner.up(input);
    expect(await sb.readFile("api/installs.txt")).toBe("installed\n");
  });

  it("names the service that failed its health check, with its last log lines, and starts nothing after it", async () => {
    const sb = await sandboxWith({ "db/db.js": server(), "api/server.js": 'console.log("boom: no DATABASE_URL"); process.exit(1);\n', "web/server.js": server() });
    const runner = new SandboxStackRunner(sb, { readyTimeoutMs: 3_000 });
    open.push(runner);
    const up = await runner.up({ stack: stack(), dirs: { db: "db", api: "api", web: "web" }, publicUrl: (svc) => `https://${svc}.test` });
    expect(up.healthy).toBe(false);
    expect(up.failed).toMatchObject({ service: "api" });
    expect(up.failed!.reason).toMatch(/exited with code 1/);
    expect(up.failed!.log.join("\n")).toContain("boom: no DATABASE_URL");
    expect(up.services.find((s) => s.service === "web")!.status).toBe("skipped");
  });

  it("checks out the change set's branch in changed services and the base branch elsewhere", async () => {
    const sb = await sandboxWith({ "db/db.js": server(), "api/server.js": server(), "web/server.js": server() });
    for (const dir of ["api", "web"]) {
      await sb.exec("git init -q -b main && git add -A && git -c user.email=a@b -c user.name=a commit -q -m init && git branch kiln/feature", { cwd: dir, trusted: true });
    }
    const runner = new SandboxStackRunner(sb, { readyTimeoutMs: 10_000 });
    open.push(runner);
    const up = await runner.up({ stack: stack(), dirs: { db: "db", api: "api", web: "web" }, publicUrl: (svc) => `https://${svc}.test`, branch: "kiln/feature", changed: ["acme/api"], local: true });
    expect(up.services.map((s) => [s.service, s.ref])).toEqual([
      ["db", undefined],
      ["api", "kiln/feature"],
      ["web", "main"],
    ]);
    expect((await sb.exec("git branch --show-current", { cwd: "api", trusted: true })).stdout.trim()).toBe("kiln/feature");
  });
});

describe("FakeStackRunner", () => {
  it("reports every service ready with its URL and records what it was asked", async () => {
    const runner = new FakeStackRunner();
    const up = await runner.up({ stack: stack(), dirs: {}, publicUrl: (svc) => `https://${svc}.test` });
    expect(up.healthy).toBe(true);
    expect(up.services.map((s) => s.url)).toEqual(["https://db.test", "https://api.test", "https://web.test"]);
    expect(runner.calls).toHaveLength(1);
  });

  it("can fail a service", async () => {
    const up = await new FakeStackRunner({ fail: { api: "no seed" } }).up({ stack: stack(), dirs: {}, publicUrl: (svc) => `https://${svc}.test` });
    expect(up.failed).toMatchObject({ service: "api", reason: "no seed" });
  });
});
