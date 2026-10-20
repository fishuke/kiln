import { isTeamAdmin } from "@kiln/auth";
import { HttpError, type RouteContext } from "../app";
import * as PS from "./platform-schemas";

/** Per-factory roles: User, Editor, Admin. Team owners and admins are always Admin. */
export function factoryMemberRoutes(ctx: RouteContext) {
  const { app, kiln, need } = ctx;

  const factoryOf = (id: string) => {
    const f = kiln.defs.get(id);
    if (!f) throw new HttpError(404, `unknown factory ${id}`);
    return f;
  };

  app.get("/api/v1/factories/:id/members", (c) => {
    const f = factoryOf(c.req.param("id"));
    need(c, "read", f.id);
    const team = kiln.teams.factoryTeam(f)!;
    const explicit = new Map(kiln.teams.factoryMembers(f.id).map((m) => [m.userId, m]));
    return c.json(
      kiln.teams.members(team).flatMap((m) => {
        const role = kiln.teams.factoryRole(m.userId, f.id);
        if (!role) return [];
        const u = kiln.users.get(m.userId);
        const source = isTeamAdmin(m.role) ? "team" : explicit.has(m.userId) ? "factory" : "default";
        return [{ userId: m.userId, role, source, teamRole: m.role, user: u ? { id: u.id, name: u.name, email: u.email, avatar: u.avatar } : undefined }];
      }),
    );
  });

  app.post("/api/v1/factories/:id/members", async (c) => {
    const f = factoryOf(c.req.param("id"));
    need(c, "admin", f.id);
    const body = PS.FactoryMemberInput.parse(await c.req.json());
    const userId = body.userId ?? kiln.users.byEmail(body.email!)?.id;
    if (!userId) throw new HttpError(404, `no account for ${body.email}; invite them to the team first`);
    return c.json(kiln.teams.setFactoryMember(f.id, userId, body.role, ctx.who(c)), 201);
  });

  app.patch("/api/v1/factories/:id/members/:userId", async (c) => {
    const f = factoryOf(c.req.param("id"));
    need(c, "admin", f.id);
    const { role } = PS.FactoryRoleInput.parse(await c.req.json());
    return c.json(kiln.teams.setFactoryMember(f.id, c.req.param("userId"), role, ctx.who(c)));
  });

  app.delete("/api/v1/factories/:id/members/:userId", (c) => {
    const f = factoryOf(c.req.param("id"));
    need(c, "admin", f.id);
    kiln.teams.removeFactoryMember(f.id, c.req.param("userId"), ctx.who(c));
    return c.json({ ok: true });
  });
}
