import type { RouteContext } from "../app";

/** Deleting a factory needs the Admin role on it (team owners and admins have it). Irreversible. */
export function factoryDeleteRoutes({ app, kiln, need, who }: RouteContext) {
  app.delete("/api/v1/factories/:id", async (c) => {
    const id = c.req.param("id");
    need(c, "admin", id);
    kiln.defs.require(id);
    return c.json({ ok: true, ...(await kiln.defs.remove(id, who(c))) });
  });
}
