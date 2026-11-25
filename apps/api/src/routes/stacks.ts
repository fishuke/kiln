import { z } from "zod";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { addPreviewResolver, previewUrlFor } from "./studio-preview";

const StackUp = z.object({
  /** The change set's branch; changed services run it, the others their base. */
  branch: z.string().min(1).optional(),
  /** owner/name of the repositories that changed. */
  changed: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/)).optional(),
});

export const routes: Route[] = [
  { method: "post", path: "/api/v1/factories/{id}/stacks", summary: "Boot the factory's stack (stack.yaml) in one sandbox: one preview URL per service, every frontend on this stack's API (ADR-020)", scope: "send", body: StackUp, tag: "Stacks" },
  { method: "get", path: "/api/v1/factories/{id}/stacks", summary: "The factory's stack previews, newest first", scope: "read", tag: "Stacks" },
  { method: "get", path: "/api/v1/stacks/{id}", summary: "One stack preview: its services, their URLs and health", scope: "read", tag: "Stacks" },
  { method: "get", path: "/api/v1/stacks/{id}/services/{service}/logs", summary: "A stack service's last output lines", scope: "read", tag: "Stacks" },
  { method: "delete", path: "/api/v1/stacks/{id}", summary: "Stop a stack preview and remove its sandbox", scope: "send", tag: "Stacks" },
];

/** Stack previews (ADR-020). Their hosts are `st-<id>-<service>.<preview domain>`, served by the preview proxy. */
export function register({ app, kiln, user, need }: RouteContext) {
  const toUrl = previewUrlFor();
  kiln.stacks.publicUrl = (target) => toUrl(target, { host: "127.0.0.1", port: 0 });
  addPreviewResolver(kiln, "st", kiln.stacks);

  const preview = (id: string) => {
    const p = kiln.stacks.get(id);
    if (!p) throw new HttpError(404, "unknown stack preview");
    return p;
  };

  app.post("/api/v1/factories/:id/stacks", async (c) => {
    const factory = c.req.param("id");
    need(c, "send", factory);
    const body = StackUp.parse(await c.req.json().catch(() => ({})));
    const p = await kiln.stacks.up({ factory, ...body, by: user(c).id });
    return c.json(p, p.healthy ? 201 : 200);
  });

  app.get("/api/v1/factories/:id/stacks", (c) => {
    const factory = c.req.param("id");
    need(c, "read", factory);
    return c.json({ stacks: kiln.stacks.list({ factory }) });
  });

  app.get("/api/v1/stacks/:id", (c) => {
    const p = preview(c.req.param("id"));
    need(c, "read", p.factory);
    return c.json(p);
  });

  app.get("/api/v1/stacks/:id/services/:service/logs", (c) => {
    const p = preview(c.req.param("id"));
    need(c, "read", p.factory);
    return c.json({ lines: kiln.stacks.logs(p.id, c.req.param("service")) });
  });

  app.delete("/api/v1/stacks/:id", async (c) => {
    const p = preview(c.req.param("id"));
    need(c, "send", p.factory);
    await kiln.stacks.destroy(p.id);
    return c.json({ ok: true });
  });
}
