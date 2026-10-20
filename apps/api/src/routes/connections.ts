import { ConnectionError } from "@kiln/engine";
import { githubOAuthUrl, registerDiscordCommands, teamsAppPackage } from "@kiln/integrations";
import { parseDocument } from "yaml";
import { HttpError, type RouteContext } from "../app";
import { ApprovalLinkCreate, ConnectionComplete, Directory, DiscordCommandsBody, FactoryIntegrationsBody, IdentityClaim, TeamsPackageQuery } from "./integration-schemas";
import { credential, installation, serverSecret, urls } from "./util";

const wrap = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConnectionError) throw new HttpError(400, err.message);
    throw err;
  }
};

export function registerConnectionRoutes({ app, kiln, need, who, user }: RouteContext) {
  // Workspace connections (admin)
  app.get("/api/v1/connections", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.connections.list().map((p) => ({ ...p, connection: p.connection ? { ...p.connection, secretNames: Object.keys(p.connection.secretNames) } : undefined })));
  });
  app.post("/api/v1/connections/:provider/start", (c) => {
    need(c, "admin", "*");
    const provider = c.req.param("provider");
    return wrap(() => c.json(kiln.connections.start(provider, who(c), urls(kiln, c, provider))));
  });
  app.post("/api/v1/connections/:provider/complete", async (c) => {
    need(c, "admin", "*");
    const provider = c.req.param("provider");
    const body = ConnectionComplete.parse(await c.req.json());
    const conn = await wrap(() => kiln.connections.complete(provider, { ...body, by: who(c), ...urls(kiln, c, provider) }));
    return c.json({ ...conn, secretNames: Object.keys(conn.secretNames) });
  });
  app.post("/api/v1/connections/:provider/test", async (c) => {
    need(c, "admin", "*");
    return c.json(await wrap(() => kiln.connections.test(c.req.param("provider"))));
  });
  app.delete("/api/v1/connections/:provider", (c) => {
    need(c, "admin", "*");
    if (!kiln.connections.disconnect(c.req.param("provider"), who(c))) throw new HttpError(404, `${c.req.param("provider")} is not connected`);
    return c.json({ ok: true });
  });
  app.put("/api/v1/connections/:provider/directory", async (c) => {
    need(c, "admin", "*");
    const provider = c.req.param("provider");
    if (!kiln.connections.list().some((p) => p.provider === provider)) throw new HttpError(404, `unknown provider ${provider}`);
    kiln.connections.setDirectory(provider as never, Directory.parse(await c.req.json()));
    return c.json(kiln.connections.get(provider)?.directory ?? {});
  });

  // "Someone else" approval links
  app.get("/api/v1/connections/:provider/approval-links", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.connections.approvalLinks(c.req.param("provider")).map(({ token: _t, ...l }) => l));
  });
  app.post("/api/v1/connections/:provider/approval-links", async (c) => {
    need(c, "admin", "*");
    const { email } = ApprovalLinkCreate.parse(await c.req.json().catch(() => ({})));
    const link = await wrap(() => kiln.connections.createApprovalLink(c.req.param("provider"), who(c), email));
    return c.json({ ...link, url: `${(kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "")}/connect/approve/${link.token}` }, 201);
  });
  app.post("/api/v1/approval-links/:id/resend", async (c) => {
    need(c, "admin", "*");
    const link = await wrap(() => kiln.connections.resendApprovalLink(c.req.param("id"), who(c)));
    return c.json({ ...link, url: `${(kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "")}/connect/approve/${link.token}` });
  });
  app.delete("/api/v1/approval-links/:id", (c) => {
    need(c, "admin", "*");
    return wrap(() => {
      kiln.connections.revokeApprovalLink(c.req.param("id"), who(c));
      return c.json({ ok: true });
    });
  });

  // Sign-in flows that add to the user's linked accounts (GET/POST/DELETE /api/v1/me/linked-accounts)
  app.post("/api/v1/me/linked-accounts/github/start", (c) => {
    const clientId = serverSecret(kiln, "GITHUB_CLIENT_ID");
    if (!clientId) throw new HttpError(400, "GitHub account linking needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");
    const state = kiln.identities.startOAuthLink("github", user(c).id);
    const base = (kiln.options.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
    return c.json({ url: githubOAuthUrl({ clientId, redirectUri: `${base}/oauth/github-user/callback`, state }) });
  });
  app.post("/api/v1/me/linked-accounts/claim", async (c) => {
    const { token } = IdentityClaim.parse(await c.req.json());
    return wrap(() => c.json(kiln.identities.claim(token, user(c).id).linkedAccounts, 201));
  });

  // Per-factory opt-in
  app.get("/api/v1/factories/:id/integrations", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const def = kiln.defs.current(id).factory;
    const forges = [...new Set(def.repositories.map((r) => r.forge))];
    return c.json({
      integrations: def.integrations,
      forges,
      cloudProviders: def.cloudProviders ?? def.providers ?? null,
      github: def.github ?? { factoryConfigChecks: "main" },
      connections: Object.fromEntries(kiln.connections.list().map((p) => [p.provider, p.connection?.status ?? "not_connected"])),
      editable: !kiln.defs.require(id).definitionRepo,
    });
  });
  app.put("/api/v1/factories/:id/integrations", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const b = kiln.defs.require(id);
    if (b.definitionRepo) throw new HttpError(409, `${id} is defined in ${b.definitionRepo.owner}/${b.definitionRepo.name}; change integrations there`);
    const { integrations } = FactoryIntegrationsBody.parse(await c.req.json());
    const tree = { ...kiln.defs.tree(b.appliedSha!)! };
    const doc = parseDocument(tree["factory.yaml"] ?? "");
    doc.set("integrations", integrations);
    tree["factory.yaml"] = doc.toString();
    const r = kiln.defs.apply(tree, { author: who(c), factory: id });
    if (!r.ok) return c.json(r, 400);
    return c.json({ ...r, integrations: kiln.defs.current(id).factory.integrations });
  });

  // Where the factory can reach a person
  app.get("/api/v1/notification-routes", (c) => {
    const factory = c.req.query("factory");
    const workItem = c.req.query("workItem");
    const wi = workItem ? kiln.workflow.get(workItem) : undefined;
    if (workItem && !wi) throw new HttpError(404, "unknown work item");
    const f = factory ?? wi?.factory;
    if (f) need(c, "read", f);
    const subject = c.req.query("subject") ?? who(c);
    if (subject !== who(c)) need(c, "admin", "*");
    return c.json(kiln.integrations.notificationRoutes({ subject, factory: f, workItemId: workItem }));
  });

  // Microsoft Teams app package (manifest + icons) for upload in the Teams admin center
  app.get("/api/v1/integrations/teams/app-package", (c) => {
    need(c, "admin", "*");
    const q = TeamsPackageQuery.parse(c.req.query());
    const botId = serverSecret(kiln, "TEAMS_APP_ID") ?? (installation(kiln, "microsoft-teams").appId as string | undefined);
    if (!botId) throw new HttpError(400, "connect Microsoft Teams (or set TEAMS_APP_ID) first");
    const website = q.website ?? kiln.options.webUrl ?? kiln.options.publicUrl ?? "https://github.com/fishuke/kiln";
    const zip = teamsAppPackage({ botId, name: q.name ?? "Kiln", developerName: q.developer ?? "Kiln", websiteUrl: website, accentColor: q.color ? `#${q.color.replace("#", "")}` : undefined, validDomains: kiln.options.publicUrl ? [new URL(kiln.options.publicUrl).host] : [] });
    return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="kiln-microsoft-teams-app.zip"' } });
  });

  // Discord: register /kiln globally or in one server
  app.post("/api/v1/integrations/discord/commands", async (c) => {
    need(c, "admin", "*");
    const { guildId } = DiscordCommandsBody.parse(await c.req.json().catch(() => ({})));
    const applicationId = serverSecret(kiln, "DISCORD_APPLICATION_ID") ?? (installation(kiln, "discord").applicationId as string | undefined);
    const botToken = credential(kiln, "discord", "botToken", "DISCORD_BOT_TOKEN");
    if (!applicationId || !botToken) throw new HttpError(400, "connect Discord (or set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN) first");
    const commands = await registerDiscordCommands({ applicationId, botToken, guildId: guildId ?? (installation(kiln, "discord").guildId as string | undefined) });
    return c.json({ registered: (commands ?? []).map((x) => x.name), scope: guildId ? `guild ${guildId}` : "global" });
  });
}
