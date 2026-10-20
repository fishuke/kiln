import { createTestKiln, waitFor } from "@kiln/engine";
import { FakeForge } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

async function setup(title: string) {
  const t = createTestKiln({ preview: false });
  const app = createApp(t.kiln, {});
  const signup = await app.request("/api/v1/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Lead", email: "lead@acme.test", password: "correct horse battery" }),
  });
  const { token } = (await signup.json()) as { token: string };
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const wi = await t.kiln.workflow.create({ factory: "webapp", title, body: "", source: { provider: "api" }, requester: "lead@acme.test" });
  void t.kiln.workflow.advance(wi.id);
  await waitFor(t.kiln, wi.id, ["handed_off"]);
  const link = () => {
    const user = t.kiln.users.byEmail("lead@acme.test")!;
    t.kiln.identities.completeOAuthLink(t.kiln.identities.startOAuthLink("github", user.id), "github", "lead", "lead", FakeForge.personToken("lead"));
  };
  return { ...t, call, wi, link };
}

describe("review API", () => {
  it("returns the diff and says when GitHub is not linked", async () => {
    const { call, wi } = await setup("Fix the login form");
    const res = await call(`/api/v1/tasks/${wi.id}/review`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string; patch: string }[]; account: { linked: boolean }; needsHuman: boolean; gateId?: string };
    expect(body.files.length).toBeGreaterThan(0);
    expect(body).toMatchObject({ account: { linked: false }, needsHuman: true });
    expect(body.gateId).toBeTruthy();
    const refused = await call(`/api/v1/tasks/${wi.id}/review`, { method: "POST", body: { event: "APPROVE" } });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Link your GitHub account/);
  });

  it("submits a review and merges as the linked account", async () => {
    const { call, wi, link, forge, kiln } = await setup("Fix the login form");
    link();
    expect((await call(`/api/v1/tasks/${wi.id}/review`, { method: "POST", body: { event: "APPROVE", body: "LGTM" } })).status).toBe(201);
    expect(forge.reviews.at(-1)).toMatchObject({ by: "lead", event: "APPROVE" });
    expect((await call(`/api/v1/tasks/${wi.id}/review`, { method: "POST", body: { event: "SHIP_IT" } })).status).toBe(400);
    const merged = await call(`/api/v1/tasks/${wi.id}/merge`, { method: "POST" });
    expect(merged.status).toBe(200);
    expect(kiln.workflow.get(wi.id)!.state).toBe("complete");
  });

  it("lists low-risk work as ready to merge, not in the inbox", async () => {
    const { call, wi } = await setup("Fix the checkout button");
    const ready = (await (await call("/api/v1/ready-to-merge")).json()) as { items: { taskId: string }[] };
    expect(ready.items.map((i) => i.taskId)).toEqual([wi.id]);
    const inbox = (await (await call("/api/v1/inbox/items?scope=team")).json()) as { items: { taskId: string }[] };
    expect(inbox.items.filter((i) => i.taskId === wi.id)).toEqual([]);
  });
});
