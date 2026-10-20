/** Parsing and templates for the "Add MCP server" dialog. */

export type McpShape = { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };

export type ParsedMcp = { ok: true; name?: string; server: McpShape } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> | undefined => (isRecord(v) && Object.values(v).every((x) => typeof x === "string") ? (v as Record<string, string>) : undefined);

/**
 * Accepts `{ "name": { url, headers } }`, `{ "mcpServers": { "name": {...} } }` (the Claude Code
 * format) or a bare `{ url, headers }` / `{ command, args, env }` object.
 */
export function parseMcpJson(text: string): ParsedMcp {
  if (!text.trim()) return { ok: false, error: "Add a configuration." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
  }
  if (!isRecord(data)) return { ok: false, error: "The configuration must be a JSON object." };
  let name: string | undefined;
  let body: Record<string, unknown> = data;
  if (isRecord(data.mcpServers)) data = data.mcpServers;
  const keys = Object.keys(data as Record<string, unknown>);
  if (!("url" in (data as object)) && !("command" in (data as object))) {
    if (keys.length !== 1) return { ok: false, error: "Add exactly one MCP server." };
    name = keys[0];
    const inner = (data as Record<string, unknown>)[name!];
    if (!isRecord(inner)) return { ok: false, error: `${name} must be an object with url or command.` };
    body = inner;
  } else body = data as Record<string, unknown>;

  const server: McpShape = {};
  if (typeof body.url === "string") server.url = body.url;
  if (typeof body.command === "string") server.command = body.command;
  if (Boolean(server.url) === Boolean(server.command)) return { ok: false, error: "Use either url (with optional headers) or command (with optional args and env)." };
  if (server.url) {
    try {
      new URL(server.url);
    } catch {
      return { ok: false, error: `${server.url} is not a URL.` };
    }
    if (body.headers !== undefined) {
      const h = strMap(body.headers);
      if (!h) return { ok: false, error: "headers must map names to strings." };
      server.headers = h;
    }
    if (body.args !== undefined || body.env !== undefined) return { ok: false, error: "args and env only apply to command servers." };
  } else {
    if (body.args !== undefined) {
      if (!Array.isArray(body.args) || !body.args.every((a) => typeof a === "string")) return { ok: false, error: "args must be a list of strings." };
      server.args = body.args as string[];
    }
    if (body.env !== undefined) {
      const e = strMap(body.env);
      if (!e) return { ok: false, error: "env must map names to strings." };
      server.env = e;
    }
    if (body.headers !== undefined) return { ok: false, error: "headers only apply to url servers." };
  }
  return { ok: true, name, server };
}

/** The `{{NAME}}` secrets a config refers to. */
export function secretRefs(s: McpShape): string[] {
  const all = [s.url ?? "", s.command ?? "", ...(s.args ?? []), ...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})].join("\n");
  return [...new Set([...all.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]!))];
}

/** MCP server names: lowercase letters, digits, dashes and underscores. */
export function toMcpName(display: string): string {
  return display
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 63);
}

export function toMcpJson(name: string, s: McpShape): string {
  const body: McpShape = s.url ? { url: s.url, ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}) } : { command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}) };
  return JSON.stringify({ [name || "server-name"]: body }, null, 2);
}

export type McpTemplate = { id: string; name: string; description: string; server: McpShape; mode: "managed" | "direct" };

export const MCP_TEMPLATES: McpTemplate[] = [
  { id: "github", name: "GitHub", description: "Manage issues, projects and code. Use a read-mostly token: agents never get merge rights.", server: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer {{GITHUB_MCP_TOKEN}}" } }, mode: "managed" },
  { id: "linear", name: "Linear", description: "Find, create and update Linear issues, projects and comments.", server: { url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer {{LINEAR_API_KEY}}" } }, mode: "managed" },
  { id: "sentry", name: "Sentry", description: "Look up issues, events and stack traces.", server: { command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_ACCESS_TOKEN: "{{SENTRY_TOKEN}}" } }, mode: "direct" },
  { id: "figma", name: "Figma", description: "Read frames, components and variables from Figma designs.", server: { url: "https://mcp.figma.com/mcp", headers: { Authorization: "Bearer {{FIGMA_TOKEN}}" } }, mode: "managed" },
  { id: "playwright", name: "Playwright", description: "Drive a headless browser: navigate, click, fill forms and take screenshots.", server: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] }, mode: "direct" },
  { id: "postgres", name: "Postgres", description: "Query a Postgres database. Point it at a read-only user.", server: { command: "uvx", args: ["postgres-mcp", "--access-mode=restricted"], env: { DATABASE_URI: "{{DATABASE_URL}}" } }, mode: "direct" },
  { id: "custom-stdio", name: "Custom stdio", description: "A server the sandbox starts as a command.", server: { command: "npx", args: ["-y", "your-mcp-server"], env: { API_KEY: "{{API_KEY}}" } }, mode: "direct" },
  { id: "custom-url", name: "Custom URL", description: "A remote server reached over streamable HTTP.", server: { url: "https://example.com/mcp", headers: { Authorization: "Bearer {{secret_name}}" } }, mode: "managed" },
];

export const CUSTOM_SUGGESTION = `{
  "server-name": {
    "url": "https://example.com/mcp",
    "headers": {
      "Authorization": "Bearer {{secret_name}}"
    }
  }
}`;
