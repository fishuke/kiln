import { KilnError, OAuthError } from "@kiln/engine";
import type { RouteContext } from "../app";

/**
 * Kiln as an OAuth server for MCP clients (MCP authorization spec): discovery, dynamic client
 * registration, authorize (the person approves in the web app) and the token endpoint. Public.
 */
export function registerOAuthServer({ app, kiln }: RouteContext) {
  const api = () => (kiln.options.publicUrl ?? "").replace(/\/$/, "");
  const web = () => (kiln.options.webUrl ?? kiln.options.publicUrl ?? "").replace(/\/$/, "");
  const cors = { "access-control-allow-origin": "*" };

  const resource = () => ({ resource: `${api()}/mcp`, authorization_servers: [api()], bearer_methods_supported: ["header"], resource_name: "Kiln" });
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resource(), 200, cors));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(resource(), 200, cors));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json(
      {
        issuer: api(),
        authorization_endpoint: `${api()}/oauth/authorize`,
        token_endpoint: `${api()}/oauth/token`,
        registration_endpoint: `${api()}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
      200,
      cors,
    ),
  );

  app.post("/oauth/register", async (c) => {
    try {
      return c.json(kiln.oauth.register(await c.req.json()), 201, cors);
    } catch (err) {
      return c.json({ error: "invalid_client_metadata", error_description: err instanceof Error ? err.message : String(err) }, 400, cors);
    }
  });

  // Checked here, then the person decides on the web app's consent page (where they are signed in).
  app.get("/oauth/authorize", (c) => {
    const params = c.req.query();
    try {
      kiln.oauth.validate(params);
    } catch (err) {
      return c.json({ error: "invalid_request", error_description: err instanceof KilnError ? err.message : String(err) }, 400);
    }
    return c.redirect(`${web()}/oauth/consent?${new URLSearchParams(params)}`, 302);
  });

  app.post("/oauth/token", async (c) => {
    const type = c.req.header("content-type") ?? "";
    const form: Record<string, string> = type.includes("application/json") ? await c.req.json() : Object.fromEntries(new URLSearchParams(await c.req.text()));
    try {
      return c.json(kiln.oauth.token(form), 200, { ...cors, "cache-control": "no-store" });
    } catch (err) {
      if (err instanceof OAuthError) return c.json({ error: err.error, error_description: err.message }, 400, cors);
      throw err;
    }
  });
}

/** The web app's consent page: who is asking, and the person's answer. Signed-in users only. */
export function registerOAuthConsent({ app, kiln, user }: RouteContext) {
  app.get("/api/v1/oauth/clients/:id", (c) => {
    user(c);
    const client = kiln.oauth.client(c.req.param("id"));
    if (!client) throw new KilnError("resource_not_found", "unknown client");
    return c.json({ client_id: client.client_id, client_name: client.client_name, redirect_uris: client.redirect_uris });
  });
  app.post("/api/v1/oauth/approve", async (c) => c.json({ redirect: kiln.oauth.approve(user(c).id, await c.req.json()) }));
  app.post("/api/v1/oauth/deny", async (c) => {
    user(c);
    return c.json({ redirect: kiln.oauth.deny(await c.req.json()) });
  });
}
