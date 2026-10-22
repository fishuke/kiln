import { createTestKiln } from "@kiln/engine";
import { createMcpHandler } from "@kiln/mcp";
import { KilnClient } from "@kiln/sdk-ts";
import { COLLECTIONS, type App } from "@kiln/studio";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const pw = "correct horse battery";

async function setup() {
  const t = createTestKiln({ preview: false });
  let app: ReturnType<typeof createApp>;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch;
  app = createApp(t.kiln, { mcp: createMcpHandler("http://kiln.test", fetcher) });
  const client = (token?: string, team?: string) => new KilnClient({ baseUrl: "http://kiln.test", token, team, fetch: fetcher });
  const owner = await client().signup({ name: "Olga", email: "olga@acme.test", password: pw });
  const o = client(owner.token);
  const inv = await o.inviteMember("default", "max@acme.test", "member");
  const member = client((await client().signup({ email: "max@acme.test", password: pw, invite: inv.token })).token);
  const team = (await o.me()).currentTeam!.id;
  const studioApp = (id: string, teamId: string, projectId?: string): App => {
    const now = new Date().toISOString();
    const a: App = {
      id,
      team: teamId,
      ...(projectId ? { projectId } : {}),
      name: id,
      source: { kind: "template", template: "nextjs" },
      shipMode: "cowboy",
      harness: "claude-code",
      status: "ready",
      createdBy: "olga",
      createdAt: now,
      updatedAt: now,
    };
    t.kiln.store.put(COLLECTIONS.apps, a);
    return a;
  };
  return { ...t, o, member, team, studioApp, client, fetcher, ownerToken: owner.token };
}

describe("Studio definition API", () => {
  it("resolves an App from team and project defaults and edits its own layer", async () => {
    const s = await setup();
    const project = s.kiln.planning.createProject({ name: "Saba", owner: "olga", factories: [] });
    s.kiln.store.put("projects", { ...project, team: s.team });
    s.studioApp("sa_1", s.team, project.id);

    await s.o.studioEditDefinition("team", {
      agents: { general: { model: "claude-sonnet-5-5" } },
      skills: { upsert: [{ name: "house-style", description: "House style", body: "Named exports." }], mandatory: ["house-style"] },
    });
    await s.o.studioEditDefinition({ project: project.id }, { policy: { maxShipMode: "review" } });
    const saved = await s.member.studioEditDefinition({ app: "sa_1" }, { name: "Pricing", agents: { general: { mcpServers: ["figma"] } } });
    expect(saved.changed).toBe(true);

    const settings = await s.member.studioSettings({ app: "sa_1" });
    expect(settings.resolved).toMatchObject({
      name: "Pricing",
      maxShipMode: "review",
      mergeGate: true,
      agents: [{ name: "general", harness: "claude-code", model: "claude-sonnet-5-5", mcpServers: ["figma"] }],
    });
    expect(settings.resolved.skills).toEqual([{ name: "house-style", description: "House style", body: "Named exports.", mandatory: true, from: "team" }]);
    expect(settings.layer).toMatchObject({ kind: "app", sha: saved.sha });

    const exported = await s.member.studioExportApp("sa_1");
    expect(exported.sha).toBe(settings.sha);
    expect(Object.keys(exported.tree).sort()).toEqual(["agents/general/agent.md", "app.yaml", "policies/project-studio.yaml", "skills/house-style/SKILL.md"]);
    expect(Object.keys((await s.member.studioExportApp("sa_1", { resolved: false })).tree).sort()).toEqual(["agents/general/agent.md", "app.yaml"]);
  });

  it("keeps versions by sha and rejects invalid trees with file and line", async () => {
    const s = await setup();
    s.studioApp("sa_1", s.team);
    const first = await s.o.studioPutDefinition({ app: "sa_1" }, { "app.yaml": "schemaVersion: kiln/v1\nname: One\n" }, "first");
    await s.o.studioEditDefinition({ app: "sa_1" }, { name: "Two" });
    await s.o.studioUseDefinition({ app: "sa_1" }, first.sha);
    const layer = await s.o.studioDefinition({ app: "sa_1" });
    expect(layer.sha).toBe(first.sha);
    expect(layer.history.map((h) => h.message)).toEqual(["first", undefined, `Use ${first.sha.slice(0, 7)}`]);
    await expect(
      s.o.studioPutDefinition({ app: "sa_1" }, { "app.yaml": "schemaVersion: kiln/v1\n", "pipelines/feature.yaml": "stages: []\n" }),
    ).rejects.toMatchObject({
      status: 400,
      message: "pipelines/feature.yaml:1: pipelines don't apply to Apps",
    });
    expect((await s.o.studioDefinition({ app: "sa_1" })).sha).toBe(first.sha);
  });

  it("acts on the caller's team only, and only admins change team defaults", async () => {
    const s = await setup();
    s.studioApp("sa_other", "team_elsewhere");
    await expect(s.o.studioSettings({ app: "sa_other" })).rejects.toMatchObject({ status: 404 });
    await expect(s.o.studioEditDefinition({ app: "sa_other" }, { name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(s.member.studioEditDefinition("team", { name: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(s.o.studioSettings({ project: "proj_missing" })).rejects.toMatchObject({ status: 404 });
    expect((await s.member.studioSettings("team")).resolved.agents.map((a) => a.name)).toEqual(["general"]);
  });

  it("reads and changes App settings through the Kiln MCP", async () => {
    const s = await setup();
    s.studioApp("sa_1", s.team);
    const mcp = new Client({ name: "test", version: "1.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("http://kiln.test/mcp"), {
        fetch: s.fetcher,
        requestInit: { headers: { authorization: `Bearer ${s.ownerToken}` } },
      }),
    );
    const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
    expect(text(await mcp.callTool({ name: "update_app_settings", arguments: { app: "sa_1", patch: { policy: { maxShipMode: "safe" } } } }))).toMatchObject({
      changed: true,
    });
    expect(text(await mcp.callTool({ name: "get_app_settings", arguments: { app: "sa_1" } })).resolved.maxShipMode).toBe("safe");
  });
});
