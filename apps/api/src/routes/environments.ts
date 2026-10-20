import { HttpError, type RouteContext } from "../app";
import { currentTeam } from "./platform-helpers";
import * as PS from "./platform-schemas";

/** Team environment templates referenced by `environmentId` in agentDefaults, agents and automations. */
export function environmentRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/environments", (c) => c.json(kiln.environments.list(currentTeam(ctx, c).team.id)));
  app.post("/api/v1/environments", async (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    const body = PS.CreateEnvironment.parse(await c.req.json());
    return c.json(kiln.environments.create(team.id, body, ctx.who(c)), 201);
  });
  app.get("/api/v1/environments/:id", (c) => {
    const e = kiln.environments.get(currentTeam(ctx, c).team.id, c.req.param("id"));
    if (!e) throw new HttpError(404, `unknown environment ${c.req.param("id")}`);
    return c.json(e);
  });
  app.patch("/api/v1/environments/:id", async (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    const body = PS.UpdateEnvironment.parse(await c.req.json());
    return c.json(kiln.environments.update(team.id, c.req.param("id"), body, ctx.who(c)));
  });
  app.delete("/api/v1/environments/:id", (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    kiln.environments.delete(team.id, c.req.param("id"), ctx.who(c));
    return c.json({ ok: true });
  });
}
