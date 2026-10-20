import { KEY_EXPIRY } from "@kiln/auth";
import { avatarContentType, LINK_PROVIDERS, publicUser, type LinkProvider } from "@kiln/engine";
import { HttpError, type RouteContext } from "../app";
import { readImage, serveObject } from "./platform-helpers";
import * as PS from "./platform-schemas";

/** The signed-in user: profile, preferences, linked accounts and API keys. */
export function meRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/me", (c) => {
    const a = ctx.access(c);
    const t = a.token;
    const user = a.user;
    return c.json({
      ...(c.get("run") ? { run: c.get("run") } : {}),
      subject: t.subject,
      name: user?.name ?? t.name,
      grants: t.grants,
      tokenType: t.type ?? "scoped",
      user: user ? publicUser(user) : undefined,
      teams: user ? kiln.teams.teamsOf(user.id).map(({ settings: _s, avatarKey: _k, ...team }) => team) : [],
      currentTeam: a.team ? { id: a.team.id, name: a.team.name, slug: a.team.slug, avatar: a.team.avatar } : undefined,
      role: a.teamRole,
      factoryRoles: user ? kiln.teams.factoryRoles(user.id) : {},
    });
  });

  app.patch("/api/v1/me", async (c) => {
    const body = PS.UpdateMe.parse(await c.req.json());
    return c.json(publicUser(kiln.users.update(ctx.user(c).id, body)));
  });

  app.put("/api/v1/me/password", async (c) => {
    const body = PS.ChangePassword.parse(await c.req.json());
    kiln.users.setPassword(ctx.user(c).id, body.next, body.current);
    return c.json({ ok: true });
  });

  app.put("/api/v1/me/avatar", async (c) => {
    const { bytes, contentType } = await readImage(c);
    return c.json(publicUser(await kiln.users.setAvatar(ctx.user(c).id, bytes, contentType)));
  });

  app.get("/api/v1/users/:id/avatar", async (c) => {
    ctx.access(c);
    const u = kiln.users.get(c.req.param("id"));
    return serveObject(ctx, u?.avatarKey, u?.avatarKey ? avatarContentType(u.avatarKey) : undefined);
  });

  // linked accounts: how Kiln recognizes you in Slack, GitHub, Linear, Jira, Discord, Teams, GitLab, Azure DevOps
  app.get("/api/v1/me/linked-accounts", (c) => c.json(ctx.user(c).linkedAccounts));
  app.post("/api/v1/me/linked-accounts", async (c) => {
    const body = PS.LinkAccount.parse(await c.req.json());
    return c.json(kiln.users.link(ctx.user(c).id, body.provider, body.externalId, body.handle).linkedAccounts, 201);
  });
  app.delete("/api/v1/me/linked-accounts/:provider", (c) => {
    const provider = c.req.param("provider") as LinkProvider;
    if (!LINK_PROVIDERS.includes(provider)) throw new HttpError(404, `unknown provider ${provider}`);
    return c.json(kiln.users.unlink(ctx.user(c).id, provider).linkedAccounts);
  });

  // what Kiln sent you, and whether it arrived
  app.get("/api/v1/me/notifications", (c) => c.json(kiln.notifications.history(ctx.user(c).id, Number(c.req.query("limit") ?? 50))));

  // API keys
  app.get("/api/v1/api-keys", (c) => c.json(kiln.accounts.listApiKeys(ctx.user(c), ctx.team(c).id)));
  app.post("/api/v1/api-keys", async (c) => {
    const body = PS.ApiKey.parse(await c.req.json());
    const issued = kiln.accounts.createApiKey({ name: body.name, type: body.type, ttlHours: KEY_EXPIRY[body.expiresIn], user: ctx.user(c), teamId: ctx.team(c).id });
    return c.json(issued, 201);
  });
  app.delete("/api/v1/api-keys/:id", (c) => {
    kiln.accounts.revokeApiKey(ctx.user(c), c.req.param("id"));
    return c.json({ ok: true });
  });
}
