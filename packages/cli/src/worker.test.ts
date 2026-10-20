import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";
import { runCli } from "./main";
import { parseDuration, readConfigFile, WorkerConfig } from "./worker";

describe("kiln worker configuration", () => {
  it("parses durations and a config file in the documented shape", () => {
    expect(parseDuration("45m")).toBe(45 * 60_000);
    expect(parseDuration("0s")).toBe(0);
    expect(() => parseDuration("soon")).toThrow(/bad duration/);
    const dir = mkdtempSync(join(tmpdir(), "kiln-worker-cfg-"));
    const file = join(dir, "worker.yaml");
    writeFileSync(file, "worker_id: farm\nmax_concurrent_tasks: 4\nidle_on_complete: 10m\ncleanup: false\nbackend:\n  docker:\n    volumes: [/cache:/cache:ro]\n    image_pull_policy: Never\n    environment:\n      - { name: NPM_TOKEN, value: abc }\n");
    const cfg = WorkerConfig.parse({ ...readConfigFile(file), apiUrl: "http://kiln.test", apiKey: "k" });
    expect(cfg).toMatchObject({ workerId: "farm", backend: "docker", maxConcurrentTasks: 4, idleOnCompleteMs: 600_000, cleanup: false, volumes: ["/cache:/cache:ro"], imagePullPolicy: "Never", env: { NPM_TOKEN: "abc" } });
    expect(WorkerConfig.safeParse({ workerId: "bad id!", apiUrl: "http://x", apiKey: "k" }).success).toBe(false);
  });

  it("kiln worker refuses --one-shot without the direct backend", async () => {
    const err: string[] = [];
    const code = await runCli(["worker", "--worker-id", "farm", "--api-key", "k", "--one-shot", "--backend", "docker"], { out: () => {}, err: (s) => err.push(s), cwd: tmpdir(), env: {} });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--one-shot works with --backend direct");
  });

  it("kiln files validate prints the server's diagnostics", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const cwd = mkdtempSync(join(tmpdir(), "kiln-cli-"));
    const fake = (async () => new Response(JSON.stringify({ ok: false, schemaVersion: "v1", diagnostics: [{ path: "factory.yaml", line: 3, code: "schema", message: "name: Required", severity: "error" }], deferredResolutions: [] }), { status: 200 })) as unknown as typeof fetch;
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd, env: {}, client: new KilnClient({ baseUrl: "http://kiln.test", fetch: fake }) };
    await runCli(["init", "f"], io);
    expect(await runCli(["files", "validate", "f"], io)).toBe(1);
    expect(err.join("\n")).toContain("error factory.yaml:3: name: Required [schema]");
  });
});
