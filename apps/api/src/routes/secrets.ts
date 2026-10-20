import type { Context } from "hono";
import { HttpError, type Env, type RouteContext } from "../app";
import { currentTeam } from "./platform-helpers";
import * as PS from "./platform-schemas";

/**
 * Managed secrets in the current team: team secrets (owners and admins change them) and the
 * caller's personal secrets. Values are write-only; responses carry metadata only.
 */
export function secretRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;
  const owner = (c: Context<Env>, scope: "team" | "personal") => (scope === "team" ? currentTeam(ctx, c, "admin").team.id : ctx.user(c).id);
  const scopeParam = (s: string) => {
    if (s !== "team" && s !== "personal") throw new HttpError(404, "scope is team or personal");
    return s;
  };

  app.get("/api/v1/managed-secrets", (c) => {
    const { team } = currentTeam(ctx, c);
    return c.json(kiln.vault.list({ teamId: team.id, userId: ctx.access(c).user?.id }));
  });
  app.post("/api/v1/managed-secrets", async (c) => {
    const body = PS.CreateSecret.parse(await c.req.json());
    const o = owner(c, body.scope);
    if (kiln.vault.getMeta(body.scope, o, body.name)) throw new HttpError(409, `a ${body.scope} secret named ${body.name} exists`);
    return c.json(kiln.vault.set({ ...body, owner: o }, ctx.who(c)), 201);
  });
  app.patch("/api/v1/managed-secrets/:scope/:name", async (c) => {
    const scope = scopeParam(c.req.param("scope"));
    const name = c.req.param("name");
    const body = PS.UpdateSecret.parse(await c.req.json());
    const o = owner(c, scope);
    if (!kiln.vault.getMeta(scope, o, name)) throw new HttpError(404, `unknown secret ${name}`);
    return c.json(kiln.vault.set({ scope, owner: o, name, value: body.value, description: body.description }, ctx.who(c)));
  });
  app.delete("/api/v1/managed-secrets/:scope/:name", (c) => {
    const scope = scopeParam(c.req.param("scope"));
    kiln.vault.delete(scope, owner(c, scope), c.req.param("name"), ctx.who(c));
    return c.json({ ok: true });
  });
}
