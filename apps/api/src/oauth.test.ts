import { createHash, randomBytes } from "node:crypto";
import { createTestKiln } from "@kiln/engine";
import { createMcpHandler } from "@kiln/mcp";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const API = "https://kiln-api.acme.test";
const pw = "correct horse battery";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response) => r.json() as Promise<Record<string, any>>;

function setup() {
  const t = createTestKiln({ preview: false, publicUrl: API, webUrl: "https://kiln.acme.test" });
  let app: ReturnType<typeof createApp>;
  const inProcess = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init));
  app = createApp(t.kiln, { mcp: createMcpHandler(API, inProcess, { resourceMetadata: `${API}/.well-known/oauth-protected-resource/mcp` }) });
  const req = (path: string, init?: RequestInit) => app.request(path, init) as unknown as Promise<Response>;
  const owner = t.kiln.accounts.signup({ email: "olga@acme.test", password: pw });
  const asOwner = new KilnClient({ baseUrl: API, token: owner.token, fetch: inProcess as typeof fetch });
  return { ...t, req, asOwner, inProcess };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe("MCP sign-in (OAuth)", () => {
  it("points an unauthenticated MCP client at Kiln's authorization server", async () => {
    const { req } = setup();
    const r = await req("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${API}/.well-known/oauth-protected-resource/mcp"`);
    expect((await req("/mcp", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).status).toBe(401);
    const resource = await json(await req("/.well-known/oauth-protected-resource/mcp"));
    expect(resource).toMatchObject({ resource: `${API}/mcp`, authorization_servers: [API] });
    const meta = await json(await req("/.well-known/oauth-authorization-server"));
    expect(meta).toMatchObject({
      issuer: API,
      authorization_endpoint: `${API}/oauth/authorize`,
      token_endpoint: `${API}/oauth/token`,
      registration_endpoint: `${API}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("registers a client, sends the person to consent, and trades the code for a token that works on MCP", async () => {
    const { req, asOwner, kiln } = setup();
    const reg = await json(await req("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://localhost:53412/callback"], token_endpoint_auth_method: "none" }),
      }));
    expect(reg).toMatchObject({ client_id: expect.any(String), client_name: "Claude Code", token_endpoint_auth_method: "none" });
    const bad = await req("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Evil", redirect_uris: ["http://evil.test/cb"] }),
    });
    expect(bad.status).toBe(400);

    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: "http://localhost:53412/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource: `${API}/mcp`,
    });
    const auth = await req(`/oauth/authorize?${q}`);
    expect(auth.status).toBe(302);
    const consent = new URL(auth.headers.get("location")!);
    expect(consent.origin + consent.pathname).toBe("https://kiln.acme.test/oauth/consent");
    expect(Object.fromEntries(consent.searchParams)).toMatchObject({ client_id: reg.client_id, state: "xyz" });
    // A redirect URI the client did not register is refused before anyone is asked.
    expect((await req(`/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: "http://localhost:1/other" })}`)).status).toBe(400);

    expect(await asOwner.request("GET", `/api/v1/oauth/clients/${reg.client_id}`)).toMatchObject({ client_name: "Claude Code" });
    const { redirect } = await asOwner.request<{ redirect: string }>("POST", "/api/v1/oauth/approve", Object.fromEntries(consent.searchParams));
    const back = new URL(redirect);
    expect(back.origin + back.pathname).toBe("http://localhost:53412/callback");
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const exchange = (body: Record<string, string>) =>
      req("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    expect(
      (
        await exchange({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://localhost:53412/callback",
          client_id: reg.client_id,
          code_verifier: "wrong",
        })
      ).status,
    ).toBe(400);
    // A failed attempt burns the code too.
    const { redirect: again } = await asOwner.request<{ redirect: string }>("POST", "/api/v1/oauth/approve", Object.fromEntries(consent.searchParams));
    const code2 = new URL(again).searchParams.get("code")!;
    const tok = await json(await exchange({
        grant_type: "authorization_code",
        code: code2,
        redirect_uri: "http://localhost:53412/callback",
        client_id: reg.client_id,
        code_verifier: verifier,
      }));
    expect(tok).toMatchObject({ token_type: "Bearer", access_token: expect.any(String), refresh_token: expect.any(String), expires_in: expect.any(Number) });
    expect(
      (
        await exchange({
          grant_type: "authorization_code",
          code: code2,
          redirect_uri: "http://localhost:53412/callback",
          client_id: reg.client_id,
          code_verifier: verifier,
        })
      ).status,
    ).toBe(400);

    const me = await new KilnClient({
      baseUrl: API,
      token: tok.access_token,
      fetch: ((i: string, init?: RequestInit) => req(i.replace(API, ""), init)) as typeof fetch,
    }).me();
    expect(me).toMatchObject({ subject: "olga@acme.test" });
    const mcp = await req("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    });
    expect(mcp.status).toBe(200);

    const refreshed = await json(await exchange({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }));
    expect(refreshed.access_token).not.toBe(tok.access_token);
    expect((await exchange({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id })).status).toBe(400);
    expect(kiln.store.list("audit").some((a) => (a as unknown as { action: string }).action === "oauth.approved")).toBe(true);
  });

  it("denies with access_denied", async () => {
    const { req, asOwner } = setup();
    const reg = await json(await req("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:9/cb"] }),
      }));
    const { challenge } = pkce();
    const params = {
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: "http://127.0.0.1:9/cb",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s1",
    };
    const { redirect } = await asOwner.request<{ redirect: string }>("POST", "/api/v1/oauth/deny", params);
    expect(redirect).toBe("http://127.0.0.1:9/cb?error=access_denied&state=s1");
  });
});
