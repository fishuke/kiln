import { HttpError, type RouteContext } from "../app";
import { currentTeam } from "./platform-helpers";
import * as PS from "./platform-schemas";

/** "MCPs and apps": team-wide MCP server configs plus the built-in integration servers. */
export function mcpServerRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/mcp-servers", (c) => {
    const { team } = currentTeam(ctx, c);
    return c.json({ servers: kiln.mcp.list(team.id), builtins: kiln.mcp.builtins(team.id) });
  });
  app.post("/api/v1/mcp-servers", async (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    const body = PS.CreateMcpServer.parse(await c.req.json());
    return c.json(kiln.mcp.create(team.id, body, ctx.who(c)), 201);
  });
  // One check for every scope: the team's servers, a factory's agents, or one agent.
  app.post("/api/v1/mcp-servers/test", async (c) => {
    const body = PS.TestMcpServers.parse(await c.req.json().catch(() => ({})));
    if (body.agent && !body.factory) throw new HttpError(400, "agent needs factory");
    if (body.factory) {
      const f = kiln.defs.get(body.factory);
      if (!f) throw new HttpError(404, `unknown factory ${body.factory}`);
      ctx.need(c, "send", f.id);
      return c.json({ results: await kiln.mcp.testServers(undefined, { factory: f.id, agent: body.agent, servers: body.servers }) });
    }
    const { team } = currentTeam(ctx, c, "admin");
    return c.json({ results: await kiln.mcp.testServers(team.id, { servers: body.servers }) });
  });
  app.get("/api/v1/mcp-servers/:id", (c) => {
    const { team } = currentTeam(ctx, c);
    const s = kiln.mcp.get(team.id, c.req.param("id"));
    if (!s) throw new HttpError(404, `unknown MCP server ${c.req.param("id")}`);
    return c.json(s);
  });
  app.patch("/api/v1/mcp-servers/:id", async (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    const body = PS.UpdateMcpServer.parse(await c.req.json());
    return c.json(kiln.mcp.update(team.id, c.req.param("id"), body, ctx.who(c)));
  });
  app.delete("/api/v1/mcp-servers/:id", (c) => {
    const { team } = currentTeam(ctx, c, "admin");
    kiln.mcp.delete(team.id, c.req.param("id"), ctx.who(c));
    return c.json({ ok: true });
  });
}
