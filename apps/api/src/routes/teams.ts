import { avatarContentType, MODEL_KEYS, STORAGE_CATEGORIES, type ModelKeyProvider, type StorageCategory, type Team } from "@kiln/engine";
import { HttpError, type RouteContext } from "../app";
import { actor, readImage, serveObject, teamFor } from "./platform-helpers";
import * as PS from "./platform-schemas";

const summary = (t: Team) => {
  const { settings: _s, avatarKey: _k, ...rest } = t;
  return rest;
};

/** Teams: profile, members and roles, invites, settings and team-managed model keys. */
export function teamRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/teams", (c) => {
    const a = ctx.access(c);
    if (a.user) return c.json(kiln.teams.teamsOf(a.user.id).map((t) => ({ ...summary(t), role: t.role })));
    return c.json(a.superuser ? kiln.teams.list().map((t) => ({ ...summary(t), role: "owner" })) : a.team ? [{ ...summary(a.team), role: a.teamRole }] : []);
  });

  app.post("/api/v1/teams", async (c) => {
    const body = PS.CreateTeam.parse(await c.req.json());
    const team = kiln.teams.create(body, ctx.user(c).id);
    return c.json({ ...summary(team), role: "owner" }, 201);
  });

  app.get("/api/v1/teams/:team", (c) => {
    const { team, role } = teamFor(ctx, c, c.req.param("team"));
    return c.json({ ...summary(team), role, settings: kiln.teams.settings(team.id), members: kiln.teams.members(team.id).length, factories: kiln.teams.factoriesOf(team.id).map((f) => ({ id: f.id, name: f.name, alias: f.alias })) });
  });

  app.patch("/api/v1/teams/:team", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const body = PS.UpdateTeam.parse(await c.req.json());
    return c.json(summary(kiln.teams.update(team.id, body, ctx.who(c))));
  });

  app.put("/api/v1/teams/:team/avatar", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const { bytes, contentType } = await readImage(c);
    return c.json(summary(await kiln.teams.setAvatar(team.id, bytes, contentType, ctx.who(c))));
  });
  app.get("/api/v1/teams/:team/avatar", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"));
    return serveObject(ctx, team.avatarKey, team.avatarKey ? avatarContentType(team.avatarKey) : undefined);
  });

  // members
  app.get("/api/v1/teams/:team/members", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"));
    return c.json(
      kiln.teams.members(team.id).map((m) => {
        const u = kiln.users.get(m.userId);
        return { userId: m.userId, role: m.role, joinedAt: m.createdAt, user: u ? { id: u.id, name: u.name, email: u.email, avatar: u.avatar } : undefined };
      }),
    );
  });
  app.patch("/api/v1/teams/:team/members/:userId", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const { role } = PS.MemberRole.parse(await c.req.json());
    return c.json(kiln.teams.setRole(team.id, c.req.param("userId"), role, actor(ctx, c)));
  });
  app.delete("/api/v1/teams/:team/members/:userId", (c) => {
    const userId = c.req.param("userId");
    const self = ctx.access(c).user?.id === userId;
    const { team } = teamFor(ctx, c, c.req.param("team"), self ? "member" : "admin");
    kiln.teams.removeMember(team.id, userId, actor(ctx, c));
    return c.json({ ok: true });
  });

  // invites
  app.get("/api/v1/teams/:team/invites", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    return c.json(kiln.teams.invites(team.id));
  });
  app.post("/api/v1/teams/:team/invites", async (c) => {
    const { team, role } = teamFor(ctx, c, c.req.param("team"), "admin");
    const body = PS.CreateInvite.parse(await c.req.json());
    if (body.role === "owner" && role !== "owner") throw new HttpError(403, "only owners invite owners");
    return c.json(kiln.teams.invite(team.id, body, ctx.who(c)), 201);
  });
  app.post("/api/v1/teams/:team/invites/:inviteId/resend", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    return c.json(kiln.teams.resend(team.id, c.req.param("inviteId"), ctx.who(c)));
  });
  app.delete("/api/v1/teams/:team/invites/:inviteId", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    kiln.teams.revoke(team.id, c.req.param("inviteId"), ctx.who(c));
    return c.json({ ok: true });
  });

  // settings
  app.get("/api/v1/teams/:team/settings", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"));
    return c.json(kiln.teams.settings(team.id));
  });
  app.patch("/api/v1/teams/:team/settings", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const body = PS.TeamSettingsPatch.parse(await c.req.json());
    return c.json(kiln.teams.updateSettings(team.id, body, ctx.who(c)));
  });

  // storage check: write and read back a small object in the category's target
  app.post("/api/v1/teams/:team/storage/:category/test", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const category = c.req.param("category");
    if (!(STORAGE_CATEGORIES as readonly string[]).includes(category)) throw new HttpError(404, `unknown storage category ${category}; use ${STORAGE_CATEGORIES.join(", ")}`);
    return c.json(await kiln.storage.test(team.id, category as StorageCategory));
  });

  // team-managed model keys (stored as team secrets; values are never returned)
  const provider = (p: string): ModelKeyProvider => {
    if (!(p in MODEL_KEYS)) throw new HttpError(404, `unknown model provider ${p}; use ${Object.keys(MODEL_KEYS).join(", ")}`);
    return p as ModelKeyProvider;
  };
  app.get("/api/v1/teams/:team/model-keys", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"));
    return c.json(kiln.vault.modelKeys(team.id));
  });
  app.put("/api/v1/teams/:team/model-keys/:provider", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    const { value } = PS.ModelKey.parse(await c.req.json());
    return c.json(kiln.vault.setModelKey(team.id, provider(c.req.param("provider")), value, ctx.who(c)));
  });
  // pooled Claude subscription tokens: health and usage per token (values are never returned)
  app.get("/api/v1/teams/:team/claude-tokens", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"));
    return c.json(kiln.credentialPool.list(team.id));
  });
  app.post("/api/v1/teams/:team/claude-tokens/:name/check", async (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    return c.json(await kiln.credentialPool.check({ teamId: team.id }, c.req.param("name")));
  });
  app.delete("/api/v1/teams/:team/model-keys/:provider", (c) => {
    const { team } = teamFor(ctx, c, c.req.param("team"), "admin");
    kiln.vault.delete("team", team.id, MODEL_KEYS[provider(c.req.param("provider"))].name, ctx.who(c));
    return c.json({ ok: true });
  });
}
