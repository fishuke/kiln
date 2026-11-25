import { FakeForge } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { FakeStackRunner } from "./stack-runner";
import { createTestKiln, sampleTree } from "./testing";

const tree = () => {
  const t = sampleTree();
  t["factory.yaml"] = t["factory.yaml"]!.replace("  - { owner: acme, name: web }\n", "  - { owner: acme, name: web }\n  - { owner: acme, name: api }\n");
  t["stack.yaml"] = [
    "name: shop",
    "runner: { image: kiln-runner-stack:local }",
    "services:",
    "  db: { kind: datastore, start: postgres-start, port: 5432 }",
    "  api: { repo: acme/api, start: pnpm dev, port: 3000, depends_on: [db] }",
    "  web: { repo: acme/web, surface: Customer site, start: pnpm dev, port: 4000, depends_on: [api] }",
    "",
  ].join("\n");
  return t;
};

function setup(runner = new FakeStackRunner()) {
  const forge = new FakeForge();
  forge.createRepo({ owner: "acme", name: "api" }, { "README.md": "# api\n" });
  const { kiln } = createTestKiln({ tree: tree(), forge, preview: false });
  kiln.stacks.useRunner(() => runner);
  kiln.stacks.publicUrl = (target) => `https://${target.replace("_", "-").replace(".", "-")}.preview.test`;
  return { kiln, runner };
}

describe("stack previews", () => {
  it("boots the factory's stack in one sandbox and lists one URL per service", async () => {
    const { kiln, runner } = setup();
    const p = await kiln.stacks.up({ factory: "webapp", branch: "kiln/featured", changed: ["acme/api"], by: "dev@acme.test" });
    expect(p.id).toMatch(/^st_[a-z0-9]{24}$/);
    expect(p.healthy).toBe(true);
    const label = p.id.replace("_", "-");
    expect(p.services.map((s) => [s.service, s.url])).toEqual([
      ["db", `https://${label}-db.preview.test`],
      ["api", `https://${label}-api.preview.test`],
      ["web", `https://${label}-web.preview.test`],
    ]);
    expect(runner.calls[0]).toMatchObject({ branch: "kiln/featured", changed: ["acme/api"], dirs: { api: "api", web: "web" } });
    expect(kiln.stacks.get(p.id)).toMatchObject({ factory: "webapp", state: "running" });
  });

  it("resolves a service's address for the preview proxy, and nothing once destroyed", async () => {
    const { kiln, runner } = setup();
    const p = await kiln.stacks.up({ factory: "webapp", by: "dev@acme.test" });
    expect(await kiln.stacks.resolvePreview(`${p.id}.web`)).toEqual({ host: "127.0.0.1", port: 4000 });
    expect(await kiln.stacks.resolvePreview(`${p.id}.nope`)).toBeUndefined();
    await kiln.stacks.destroy(p.id);
    expect(runner.downs).toBe(1);
    expect(kiln.stacks.get(p.id)!.state).toBe("destroyed");
    expect(await kiln.stacks.resolvePreview(`${p.id}.web`)).toBeUndefined();
  });

  it("reports the service that failed and keeps the sandbox for its logs", async () => {
    const { kiln } = setup(new FakeStackRunner({ fail: { api: "migrate failed (exit 1): relation does not exist" } }));
    const p = await kiln.stacks.up({ factory: "webapp", by: "dev@acme.test" });
    expect(p).toMatchObject({ healthy: false, state: "failed", failed: { service: "api" } });
  });

  it("refuses a factory without a stack", async () => {
    const { kiln } = createTestKiln({ preview: false });
    await expect(kiln.stacks.up({ factory: "webapp", by: "dev@acme.test" })).rejects.toThrow("has no stack.yaml");
  });

  it("destroys the stack previews of a work item when it closes", async () => {
    const { kiln, runner } = setup();
    const p = await kiln.stacks.up({ factory: "webapp", by: "dev@acme.test", workItemId: "wi_1" });
    await kiln.stacks.destroyFor("wi_1");
    expect(kiln.stacks.get(p.id)!.state).toBe("destroyed");
    expect(runner.downs).toBe(1);
  });
});
