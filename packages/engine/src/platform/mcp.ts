import type { Kiln } from "../kiln";
import { newId } from "../types";
import { BUILTIN_MCP, P, PlatformError, type BuiltinMcp, type McpServer } from "./types";
import type { McpProbeResult } from "./mcp-probe";
import type { SecretResolver } from "./vault";

/** One server's test: `untested` for command servers, which only start inside a run's sandbox. */
export type McpTestResult = { name: string; status: "ok" | "error" | "untested"; tools?: string[]; message: string; agents?: string[] };

/** What the harness writes into its MCP config. */
export type HarnessMcpServer =
  | { name: string; url: string; headers?: Record<string, string> }
  | { name: string; command: string; args?: string[]; env?: Record<string, string> };

type ServerShape = Pick<McpServer, "command" | "args" | "env" | "url" | "headers">;

/** Built-in integration servers, referenced as `kiln_id` (or by name). They appear once their credentials exist. */
export const BUILTIN_MCP_SERVERS: Record<BuiltinMcp, ServerShape & { description: string }> = {
  linear: { description: "Linear issues and projects", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer {{LINEAR_API_KEY}}" } },
  slack: { description: "Slack channels and threads", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], env: { SLACK_BOT_TOKEN: "{{SLACK_BOT_TOKEN}}" } },
  jira: { description: "Jira issues", command: "uvx", args: ["mcp-atlassian"], env: { JIRA_URL: "{{JIRA_BASE_URL}}", JIRA_USERNAME: "{{JIRA_EMAIL}}", JIRA_API_TOKEN: "{{JIRA_API_TOKEN}}" } },
  github: { description: "GitHub repositories, issues and pull requests (read-mostly token)", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer {{GITHUB_MCP_TOKEN}}" } },
  discord: { description: "Discord channels", command: "npx", args: ["-y", "mcp-discord"], env: { DISCORD_TOKEN: "{{DISCORD_BOT_TOKEN}}" } },
};

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function placeholders(s: ServerShape): string[] {
  const all = [s.url ?? "", s.command ?? "", ...(s.args ?? []), ...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})].join("\n");
  return [...new Set([...all.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

const NAME = /^[a-z0-9][a-z0-9-_]{0,62}$/;

/** "MCPs and apps": team-wide MCP server configs that agents reference by id or name. */
export class McpRegistry {
  constructor(private readonly k: Kiln) {}

  list(teamId: string): McpServer[] {
    return this.k.store.list<McpServer>(P.mcpServers, (s) => s.teamId === teamId).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(teamId: string, idOrName: string): McpServer | undefined {
    const s = this.k.store.get<McpServer>(P.mcpServers, idOrName);
    if (s && s.teamId === teamId) return s;
    return this.list(teamId).find((x) => x.name === idOrName);
  }

  /** Built-ins with whether their credentials resolve for this team. */
  builtins(teamId: string) {
    const r = this.k.vault.resolver({ teamId });
    return BUILTIN_MCP.map((id) => {
      const s = BUILTIN_MCP_SERVERS[id];
      const missing = placeholders(s).filter((n) => r.get(n) === undefined);
      return { kiln_id: id, name: id, description: s.description, connected: missing.length === 0, missing };
    });
  }

  private check(input: Partial<ServerShape>) {
    const hasCmd = Boolean(input.command);
    const hasUrl = Boolean(input.url);
    if (hasCmd === hasUrl) throw new PlatformError(400, "an MCP server needs either command (+args, env) or url (+headers)");
    if (hasCmd && input.headers && Object.keys(input.headers).length) throw new PlatformError(400, "headers only apply to url servers");
    if (hasUrl && ((input.args?.length ?? 0) > 0 || Object.keys(input.env ?? {}).length > 0)) throw new PlatformError(400, "args and env only apply to command servers");
  }

  create(teamId: string, input: { name: string; description?: string; mode?: McpServer["mode"] } & ServerShape, by: string): McpServer {
    if (!NAME.test(input.name)) throw new PlatformError(400, "MCP server names use lowercase letters, digits, dashes and underscores");
    if ((BUILTIN_MCP as readonly string[]).includes(input.name)) throw new PlatformError(409, `${input.name} is a built-in server`);
    if (this.list(teamId).some((s) => s.name === input.name)) throw new PlatformError(409, `an MCP server named ${input.name} exists`);
    this.check(input);
    const now = this.k.clock.now().toISOString();
    const server: McpServer = {
      id: newId("mcp"),
      teamId,
      name: input.name,
      description: input.description,
      mode: input.mode ?? (input.url ? "managed" : "direct"),
      command: input.command,
      args: input.command ? (input.args ?? []) : undefined,
      env: input.command ? (input.env ?? {}) : undefined,
      url: input.url,
      headers: input.url ? (input.headers ?? {}) : undefined,
      createdBy: by,
      createdAt: now,
      updatedAt: now,
    };
    this.k.store.put(P.mcpServers, server);
    this.k.audit(by, "mcp.created", server.id, { name: server.name, team: teamId });
    return server;
  }

  update(teamId: string, id: string, patch: Partial<Omit<McpServer, "id" | "teamId" | "createdBy" | "createdAt" | "updatedAt">>, by: string): McpServer {
    const s = this.get(teamId, id);
    if (!s) throw new PlatformError(404, `unknown MCP server ${id}`);
    if (patch.name && patch.name !== s.name && this.list(teamId).some((x) => x.name === patch.name)) throw new PlatformError(409, `an MCP server named ${patch.name} exists`);
    const next: McpServer = { ...s, ...patch, updatedAt: this.k.clock.now().toISOString() };
    if (patch.url) Object.assign(next, { command: undefined, args: undefined, env: undefined });
    if (patch.command) Object.assign(next, { url: undefined, headers: undefined });
    this.check(next);
    this.k.store.put(P.mcpServers, next);
    this.k.audit(by, "mcp.updated", s.id, { fields: Object.keys(patch) });
    return next;
  }

  delete(teamId: string, id: string, by: string) {
    const s = this.get(teamId, id);
    if (!s) throw new PlatformError(404, `unknown MCP server ${id}`);
    this.k.store.delete(P.mcpServers, s.id);
    this.k.audit(by, "mcp.deleted", s.id, { name: s.name });
  }

  /**
   * Turn an agent's `mcpServers` references into harness config. Managed servers get `{{NAME}}`
   * replaced by secret values; direct servers keep `${NAME}` references and the values go into the
   * run's environment, so they are never written to disk. Unknown or unconnected servers are skipped.
   */
  resolve(teamId: string | undefined, refs: string[], secrets: SecretResolver): { servers: HarnessMcpServer[]; env: Record<string, string>; skipped: string[] } {
    const servers: HarnessMcpServer[] = [];
    const env: Record<string, string> = {};
    const skipped: string[] = [];
    for (const raw of refs) {
      const ref = raw.replace(/^kiln:/, "");
      const builtin = (BUILTIN_MCP as readonly string[]).includes(ref) ? BUILTIN_MCP_SERVERS[ref as BuiltinMcp] : undefined;
      const custom = !builtin && teamId ? this.get(teamId, ref) : undefined;
      const shape: (ServerShape & { mode?: McpServer["mode"] }) | undefined = builtin ? { ...builtin, mode: "managed" } : custom;
      if (!shape) {
        skipped.push(`${raw}: unknown MCP server`);
        continue;
      }
      const values: Record<string, string> = {};
      const missing: string[] = [];
      for (const n of placeholders(shape)) {
        const v = secrets.get(n);
        if (v === undefined) missing.push(n);
        else values[n] = v;
      }
      if (missing.length) {
        skipped.push(`${raw}: missing secret ${missing.join(", ")}`);
        continue;
      }
      const direct = shape.mode === "direct";
      const sub = (s: string) => s.replace(PLACEHOLDER, (_m, n: string) => (direct ? `\${${n}}` : values[n]!));
      const subAll = (o?: Record<string, string>) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sub(v)])) : undefined);
      if (direct) Object.assign(env, values);
      const name = custom?.name ?? ref;
      if (shape.url) servers.push({ name, url: sub(shape.url), headers: subAll(shape.headers) });
      else servers.push({ name, command: sub(shape.command!), args: (shape.args ?? []).map(sub), env: subAll(shape.env) });
    }
    return { servers, env, skipped };
  }

  /** Tests one server with the team's secrets: a URL server is connected to and its tools listed. */
  private async test(teamId: string | undefined, ref: string, secrets: SecretResolver): Promise<McpTestResult> {
    const r = this.resolve(teamId, [ref], secrets);
    const name = ref.replace(/^kiln:/, "");
    if (r.skipped.length) return { name, status: "error", message: r.skipped[0]!.replace(/^[^:]+: /, "").replace(/^missing secret/, "Missing secret") };
    const s = r.servers[0]!;
    if (!("url" in s)) return { name, status: "untested", message: "Its secrets are set. Command servers start inside each run's sandbox, so a run is the test." };
    const p: McpProbeResult = await this.k.mcpProbe.probe(s.url, s.headers ?? {});
    if (!p.ok) return { name, status: "error", message: p.error };
    return { name, status: "ok", tools: p.tools, message: `Connected${p.server ? ` to ${p.server}` : ""}: ${p.tools.length} tool${p.tools.length === 1 ? "" : "s"}.` };
  }

  /**
   * Tests MCP servers in one scope: a factory's agents (or one agent) with the factory team's
   * secrets, or the team's own servers. `servers` narrows either to the named ones.
   */
  async testServers(teamId: string | undefined, scope: { factory?: string; agent?: string; servers?: string[] } = {}): Promise<McpTestResult[]> {
    const users = new Map<string, string[]>();
    let team = teamId;
    if (scope.factory) {
      const f = this.k.defs.require(scope.factory);
      team = this.k.teams.factoryTeam(f);
      const agents = f.appliedSha ? this.k.defs.resolved(f.appliedSha).agents : {};
      if (scope.agent && !agents[scope.agent]) throw new PlatformError(404, `factory ${scope.factory} has no agent ${scope.agent}`);
      for (const [name, a] of Object.entries(agents)) if (!scope.agent || name === scope.agent) for (const ref of a.mcpServers) users.set(ref, [...(users.get(ref) ?? []), name]);
    } else {
      for (const s of team ? this.list(team) : []) users.set(s.name, []);
      for (const b of team ? this.builtins(team) : []) if (b.connected) users.set(b.kiln_id, []);
    }
    const refs = scope.servers ?? [...users.keys()];
    const secrets = this.k.vault.resolver({ teamId: team });
    return Promise.all(refs.map(async (ref) => ({ ...(await this.test(team, ref, secrets)), ...(scope.factory ? { agents: users.get(ref) ?? [] } : {}) })));
  }

  /**
   * Hosts a run must reach for the servers it gets: a URL server's own host, and the host of every
   * URL-valued secret a server uses (such as JIRA_BASE_URL). Servers the run skips add none.
   */
  hosts(teamId: string | undefined, refs: string[], secrets: SecretResolver): string[] {
    const hosts = new Set<string>();
    const hostOf = (v: string) => {
      try {
        const u = new URL(v);
        if (u.protocol === "https:" || u.protocol === "http:") hosts.add(u.hostname);
      } catch {
        // not a URL
      }
    };
    for (const s of this.resolve(teamId, refs, secrets).servers) {
      if ("url" in s) hostOf(s.url);
    }
    for (const raw of refs) {
      const ref = raw.replace(/^kiln:/, "");
      const shape = (BUILTIN_MCP as readonly string[]).includes(ref) ? BUILTIN_MCP_SERVERS[ref as BuiltinMcp] : teamId ? this.get(teamId, ref) : undefined;
      if (!shape) continue;
      const values = placeholders(shape).map((n) => secrets.get(n));
      if (values.some((v) => v === undefined)) continue;
      for (const v of values) hostOf(v!);
    }
    return [...hosts];
  }
}
