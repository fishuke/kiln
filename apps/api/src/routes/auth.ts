import { publicUser } from "@kiln/engine";
import { HttpError, type RouteContext } from "../app";
import * as PS from "./platform-schemas";

/** Signup, password login, logout, GitHub login and invite links. */
export function authRoutes(ctx: RouteContext) {
  const { app, kiln, options } = ctx;
  const session = (r: { user: Parameters<typeof publicUser>[0]; token: string; record: { expiresAt?: string } }) => ({
    token: r.token,
    expiresAt: r.record.expiresAt,
    user: publicUser(r.user),
    teams: kiln.teams.teamsOf(r.user.id).map((t) => ({ id: t.id, name: t.name, slug: t.slug, role: t.role })),
  });

  app.get("/api/v1/auth/providers", (c) => c.json({ password: true, github: Boolean(options.github), openSignup: Boolean(options.openSignup), needsOwner: kiln.accounts.needsOwner() }));

  app.post("/api/v1/auth/signup", async (c) => {
    const body = PS.Signup.parse(await c.req.json());
    return c.json(session(kiln.accounts.signup(body, { openSignup: options.openSignup })), 201);
  });

  app.post("/api/v1/auth/login", async (c) => {
    const body = PS.Login.parse(await c.req.json());
    return c.json(session(kiln.accounts.login(body.email, body.password)));
  });

  app.post("/api/v1/auth/logout", (c) => {
    kiln.accounts.logout(ctx.access(c).token);
    return c.json({ ok: true });
  });

  const callbackUrl = (c: { req: { url: string } }) => `${(kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "")}/api/v1/auth/github/callback`;
  /** Only send tokens back to Kiln's own web app or API, never to an arbitrary site. */
  const safeRedirect = (redirect: string | undefined) => {
    if (!redirect) return undefined;
    const allowed = [kiln.options.webUrl, kiln.options.publicUrl].filter((u): u is string => Boolean(u)).map((u) => new URL(u).origin);
    let origin: string;
    try {
      origin = new URL(redirect).origin;
    } catch {
      throw new HttpError(400, "redirect must be an absolute URL");
    }
    if (!allowed.includes(origin)) throw new HttpError(400, "redirect must point at this Kiln's web app");
    return redirect;
  };

  app.get("/api/v1/auth/github/start", (c) => {
    if (!options.github) throw new HttpError(404, "GitHub login is not configured (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)");
    const state = kiln.accounts.oauthState({ redirect: safeRedirect(c.req.query("redirect")), invite: c.req.query("invite") || undefined });
    const url = options.github.authorizeUrl(state, callbackUrl(c));
    return c.req.header("accept")?.includes("application/json") || c.req.query("json") ? c.json({ url, state }) : c.redirect(url, 302);
  });

  app.get("/api/v1/auth/github/callback", async (c) => {
    if (!options.github) throw new HttpError(404, "GitHub login is not configured");
    const code = c.req.query("code");
    const stateId = c.req.query("state");
    if (!code || !stateId) throw new HttpError(400, "code and state are required");
    const state = kiln.accounts.takeState(stateId);
    const identity = await options.github.exchange(code, callbackUrl(c));
    const r = kiln.accounts.githubLogin(identity, { invite: state.invite, openSignup: options.openSignup });
    if (state.redirect) return c.redirect(`${state.redirect}#token=${encodeURIComponent(r.token)}`, 302);
    return c.json({ ...session(r), created: r.created });
  });

  // Invite links: anyone holding the link may look at it; accepting needs an account.
  app.get("/api/v1/invites/:token", (c) => c.json(kiln.teams.previewInvite(c.req.param("token"))));
  app.post("/api/v1/invites/accept", async (c) => {
    const { token } = PS.AcceptInvite.parse(await c.req.json());
    const m = kiln.teams.accept(token, ctx.user(c).id);
    const team = kiln.teams.require(m.teamId);
    return c.json({ team: { id: team.id, name: team.name, slug: team.slug }, role: m.role });
  });
}
