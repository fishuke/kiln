import { WebhookError } from "@kiln/engine";
import { HttpError, type RouteContext } from "../app";
import { WebhookCreate, WebhookPatch, WebhookRotate, WebhookSecret } from "./integration-schemas";

const wrap = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof WebhookError) throw new HttpError(err.status, err.message);
    throw err;
  }
};

export function registerWebhookSourceRoutes({ app, kiln, need, who }: RouteContext) {
  const owned = (uid: string) => {
    const w = kiln.webhookSources.get(uid);
    if (!w) throw new HttpError(404, "unknown webhook");
    return w;
  };

  app.get("/api/v1/factories/:id/webhooks", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    kiln.defs.require(id);
    return c.json(kiln.webhookSources.list(id).map((w) => ({ ...w, url: kiln.webhookSources.url(w) })));
  });
  app.post("/api/v1/factories/:id/webhooks", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const body = WebhookCreate.parse(await c.req.json());
    return wrap(() => c.json(kiln.webhookSources.create(id, body, who(c)), 201));
  });
  app.get("/api/v1/webhooks/:uid", (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "read", w.factory);
    return c.json({ ...w, url: kiln.webhookSources.url(w) });
  });
  app.patch("/api/v1/webhooks/:uid", async (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "definitions:write", w.factory);
    const patch = WebhookPatch.parse(await c.req.json());
    return wrap(() => c.json(kiln.webhookSources.update(w.id, patch, who(c))));
  });
  app.delete("/api/v1/webhooks/:uid", (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "definitions:write", w.factory);
    return wrap(() => {
      kiln.webhookSources.delete(w.id, who(c));
      return c.json({ ok: true });
    });
  });
  app.post("/api/v1/webhooks/:uid/rotate", async (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "definitions:write", w.factory);
    const { secret } = WebhookRotate.parse(await c.req.json().catch(() => ({})));
    return wrap(() => c.json(kiln.webhookSources.rotate(w.id, who(c), secret)));
  });
  app.post("/api/v1/webhooks/:uid/finish", async (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "definitions:write", w.factory);
    const { secret } = WebhookSecret.parse(await c.req.json());
    return wrap(() => c.json(kiln.webhookSources.finish(w.id, secret, who(c))));
  });
  app.get("/api/v1/webhooks/:uid/deliveries", (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "read", w.factory);
    // The list omits payloads; open one delivery to read it.
    return c.json(kiln.webhookSources.deliveries(w.id).map(({ payload: _p, ...d }) => ({ ...d, hasPayload: _p !== undefined })));
  });
  app.get("/api/v1/webhooks/:uid/deliveries/:delivery", (c) => {
    const w = owned(c.req.param("uid"));
    need(c, "read", w.factory);
    const d = kiln.webhookSources.delivery(c.req.param("delivery"));
    if (!d || d.webhookId !== w.id) throw new HttpError(404, "unknown delivery");
    return c.json(d);
  });
}
