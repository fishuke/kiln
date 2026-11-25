import { createTestKiln, FakeStackRunner, sampleTree } from "@kiln/engine";
import { FakeForge } from "@kiln/integrations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { ROUTES } from "./openapi";
import { getPreviewResolver } from "./routes/studio-preview";

function tree() {
  const t = sampleTree();
  t["factory.yaml"] = t["factory.yaml"]!.replace("  - { owner: acme, name: web }\n", "  - { owner: acme, name: web }\n  - { owner: acme, name: api }\n");
  t["stack.yaml"] = "name: shop\nservices:\n  api: { repo: acme/api, start: pnpm dev, port: 3000 }\n  web: { repo: acme/web, start: pnpm dev, port: 4000, depends_on: [api] }\n";
  return t;
}

async function setup() {
  vi.stubEnv("KILN_STUDIO_PREVIEW_DOMAIN", "preview.kiln.test");
  const forge = new FakeForge();
  forge.createRepo({ owner: "acme", name: "api" });
  const t = createTestKiln({ tree: tree(), forge, preview: false });
  t.kiln.stacks.useRunner(() => new FakeStackRunner());
  const app = createApp(t.kiln, {});
  const signup = await app.request("/api/v1/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@acme.test", password: "correct horse battery" }),
  });
  const { token } = (await signup.json()) as { token: string };
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, { method: init.method ?? "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined });
  return { ...t, app, call };
}

afterEach(() => vi.unstubAllEnvs());

describe("stack previews API", () => {
  it("boots a stack and answers with one preview URL per service on the preview domain", async () => {
    const t = await setup();
    const res = await t.call("/api/v1/factories/webapp/stacks", { method: "POST", body: { branch: "kiln/featured", changed: ["acme/api"] } });
    expect(res.status).toBe(201);
    const p = (await res.json()) as { id: string; services: { service: string; url: string }[] };
    const label = p.id.replace("_", "-");
    expect(p.services.map((s) => s.url)).toEqual([`https://${label}-api.preview.kiln.test`, `https://${label}-web.preview.kiln.test`]);
    expect(await getPreviewResolver(t.kiln)!.resolvePreview(`${p.id}.web`)).toEqual({ host: "127.0.0.1", port: 4000 });

    expect(((await (await t.call("/api/v1/factories/webapp/stacks")).json()) as { stacks: unknown[] }).stacks).toHaveLength(1);
    expect((await t.call(`/api/v1/stacks/${p.id}/services/web/logs`)).status).toBe(200);
    expect((await t.call(`/api/v1/stacks/${p.id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await t.call(`/api/v1/stacks/${p.id}`)).json()) as { state: string }).state).toBe("destroyed");
  });

  it("is in the OpenAPI document", () => {
    expect(ROUTES.some((r) => r.path === "/api/v1/factories/{id}/stacks" && r.method === "post")).toBe(true);
  });
});
