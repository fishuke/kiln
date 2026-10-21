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

/**
 * One value a server needs, asked for with a label and a hint on where to find it. A `secret` field is
 * saved as the team secret named `key`; any other field is written into the config in place of `{{key}}`.
 */
export type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  kind: "url" | "text" | "password";
  secret?: boolean;
  value?: string;
};

export type McpTemplate = {
  id: string;
  name: string;
  description: string;
  server: McpShape;
  mode: "managed" | "direct";
  docs?: string;
  fields?: TemplateField[];
};

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Manage issues, projects and code. Use a read-mostly token: agents never get merge rights.",
    server: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer {{GITHUB_MCP_TOKEN}}" } },
    mode: "managed",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Find, create and update Linear issues, projects and comments.",
    server: { url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer {{LINEAR_API_KEY}}" } },
    mode: "managed",
  },
  {
    id: "signoz",
    name: "SigNoz",
    description: "Query traces, logs and metrics, and read dashboards and alerts.",
    docs: "https://signoz.io/docs/ai/signoz-mcp-server/",
    server: { url: "{{SIGNOZ_MCP_URL}}", headers: { "SIGNOZ-API-KEY": "{{SIGNOZ_API_KEY}}", "X-SigNoz-URL": "{{SIGNOZ_URL}}" } },
    mode: "managed",
    fields: [
      {
        key: "SIGNOZ_URL",
        label: "SigNoz URL",
        placeholder: "https://signoz.example.com",
        hint: "The address you open SigNoz on in the browser, not the OTLP endpoint your app sends to.",
        kind: "url",
      },
      {
        key: "SIGNOZ_MCP_URL",
        label: "MCP endpoint",
        placeholder: "https://mcp.us.signoz.cloud/mcp",
        value: "https://mcp.us.signoz.cloud/mcp",
        hint: "SigNoz Cloud: https://mcp.<region>.signoz.cloud/mcp (us, eu, in). Self-hosted: where signoz-mcp-server runs in HTTP mode, ending in /mcp.",
        kind: "url",
      },
      {
        key: "SIGNOZ_API_KEY",
        label: "API key",
        placeholder: "Service account key",
        hint: "SigNoz → Settings → Service Accounts: create one with the Viewer role, then add a key.",
        kind: "password",
        secret: true,
      },
    ],
  },
  {
    id: "datadog",
    name: "Datadog",
    description: "Search logs, metrics, traces, monitors and incidents.",
    docs: "https://docs.datadoghq.com/bits_ai/mcp_server/setup/",
    server: { url: "{{DD_MCP_URL}}", headers: { DD_API_KEY: "{{DD_API_KEY}}", DD_APPLICATION_KEY: "{{DD_APPLICATION_KEY}}" } },
    mode: "managed",
    fields: [
      {
        key: "DD_MCP_URL",
        label: "MCP endpoint",
        placeholder: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
        value: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
        hint: "This is US1. Other sites have their own host: pick your site in Datadog's setup docs.",
        kind: "url",
      },
      {
        key: "DD_API_KEY",
        label: "API key",
        placeholder: "API key",
        hint: "Organization Settings → API Keys. Prefer a service account's key.",
        kind: "password",
        secret: true,
      },
      {
        key: "DD_APPLICATION_KEY",
        label: "Application key",
        placeholder: "Application key",
        hint: "Organization Settings → Application Keys, scoped to read access.",
        kind: "password",
        secret: true,
      },
    ],
  },
  {
    id: "newrelic",
    name: "New Relic",
    description: "Query NRQL, entities, alerts and incidents.",
    docs: "https://docs.newrelic.com/docs/agentic-ai/mcp/setup/",
    server: { url: "{{NEW_RELIC_MCP_URL}}", headers: { "api-key": "{{NEW_RELIC_API_KEY}}" } },
    mode: "managed",
    fields: [
      {
        key: "NEW_RELIC_MCP_URL",
        label: "MCP endpoint",
        placeholder: "https://mcp.newrelic.com/mcp/",
        value: "https://mcp.newrelic.com/mcp/",
        hint: "EU accounts use https://mcp.eu.newrelic.com/mcp/.",
        kind: "url",
      },
      {
        key: "NEW_RELIC_API_KEY",
        label: "User API key",
        placeholder: "NRAK-…",
        hint: "New Relic → your profile → API keys → Create a key of type User.",
        kind: "password",
        secret: true,
      },
    ],
  },
  {
    id: "betterstack",
    name: "Better Stack",
    description: "Read logs, uptime monitors and incidents.",
    docs: "https://betterstack.com/docs/getting-started/integrations/mcp/",
    server: { url: "https://mcp.betterstack.com", headers: { Authorization: "Bearer {{BETTERSTACK_API_TOKEN}}" } },
    mode: "managed",
    fields: [
      {
        key: "BETTERSTACK_API_TOKEN",
        label: "API token",
        placeholder: "API token",
        hint: "Better Stack → Settings → API tokens.",
        kind: "password",
        secret: true,
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Look up issues, events and stack traces.",
    server: { command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_ACCESS_TOKEN: "{{SENTRY_TOKEN}}" } },
    mode: "direct",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Read frames, components and variables from Figma designs.",
    server: { url: "https://mcp.figma.com/mcp", headers: { Authorization: "Bearer {{FIGMA_TOKEN}}" } },
    mode: "managed",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Drive a headless browser: navigate, click, fill forms and take screenshots.",
    server: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] },
    mode: "direct",
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Query a Postgres database. Point it at a read-only user.",
    server: { command: "uvx", args: ["postgres-mcp", "--access-mode=restricted"], env: { DATABASE_URI: "{{DATABASE_URL}}" } },
    mode: "direct",
  },
  {
    id: "custom-stdio",
    name: "Custom stdio",
    description: "A server the sandbox starts as a command.",
    server: { command: "npx", args: ["-y", "your-mcp-server"], env: { API_KEY: "{{API_KEY}}" } },
    mode: "direct",
  },
  {
    id: "custom-url",
    name: "Custom URL",
    description: "A remote server reached over streamable HTTP.",
    server: { url: "https://example.com/mcp", headers: { Authorization: "Bearer {{secret_name}}" } },
    mode: "managed",
  },
];

export const CUSTOM_SUGGESTION = `{
  "server-name": {
    "url": "https://example.com/mcp",
    "headers": {
      "Authorization": "Bearer {{secret_name}}"
    }
  }
}`;

/** What to ask for when connecting a built-in server, so nobody has to guess what a secret holds. */
export const BUILTIN_SETUP: Record<string, { name: string; docs?: string; fields: TemplateField[] }> = {
  linear: {
    name: "Linear",
    docs: "https://linear.app/settings/account/security",
    fields: [
      {
        key: "LINEAR_API_KEY",
        label: "API key",
        placeholder: "lin_api_…",
        hint: "Linear → Settings → Security & access → Personal API keys.",
        kind: "password",
        secret: true,
      },
    ],
  },
  slack: {
    name: "Slack",
    docs: "https://api.slack.com/apps",
    fields: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Bot token",
        placeholder: "xoxb-…",
        hint: "Your Slack app → OAuth & Permissions → Bot User OAuth Token.",
        kind: "password",
        secret: true,
      },
    ],
  },
  jira: {
    name: "Jira",
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      {
        key: "JIRA_BASE_URL",
        label: "Site URL",
        placeholder: "https://your-company.atlassian.net",
        hint: "The address you open Jira on.",
        kind: "url",
        secret: true,
      },
      {
        key: "JIRA_EMAIL",
        label: "Account email",
        placeholder: "you@company.com",
        hint: "The Atlassian account the API token belongs to.",
        kind: "text",
        secret: true,
      },
      { key: "JIRA_API_TOKEN", label: "API token", placeholder: "ATATT…", hint: "Atlassian account → Security → API tokens.", kind: "password", secret: true },
    ],
  },
  github: {
    name: "GitHub",
    docs: "https://github.com/settings/personal-access-tokens",
    fields: [
      {
        key: "GITHUB_MCP_TOKEN",
        label: "Personal access token",
        placeholder: "github_pat_…",
        hint: "A fine-grained token with read access. Agents never get merge rights.",
        kind: "password",
        secret: true,
      },
    ],
  },
  discord: {
    name: "Discord",
    docs: "https://discord.com/developers/applications",
    fields: [
      {
        key: "DISCORD_BOT_TOKEN",
        label: "Bot token",
        placeholder: "Bot token",
        hint: "Developer Portal → your app → Bot → Reset token.",
        kind: "password",
        secret: true,
      },
    ],
  },
};

/** A template's fields: its own, or one password field per `{{SECRET}}` its config refers to. */
export function templateFields(t: McpTemplate): TemplateField[] {
  if (t.fields) return t.fields;
  return secretRefs(t.server).map((key) => ({ key, label: key.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), placeholder: key, hint: `Saved as the team secret ${key}.`, kind: "password", secret: true }));
}

/** Templates for a real server (not the custom-JSON starters). */
export const SERVER_TEMPLATES = MCP_TEMPLATES.filter((t) => !t.id.startsWith("custom"));

/** Field values as typed, with each field's default filled in. */
export function withDefaults(fields: TemplateField[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? f.value ?? "").trim()]));
}

/**
 * Why a form can't be saved yet, or undefined when it can. A secret field that already exists
 * (not in `missing`) may stay empty; every other field needs a value.
 */
export function fieldsError(fields: TemplateField[], values: Record<string, string>, missing?: string[]): string | undefined {
  const v = withDefaults(fields, values);
  for (const f of fields) {
    if (!v[f.key]) {
      if (f.secret && missing && !missing.includes(f.key)) continue;
      return `Enter ${f.label.toLowerCase()}.`;
    }
    if (f.kind === "url" && !/^https?:\/\/[^/\s]+/.test(v[f.key]!)) return `${f.label} must start with https://`;
  }
  return undefined;
}

/** The config with every non-secret field written in; secret fields stay `{{KEY}}` references. */
export function fillTemplate(server: McpShape, fields: TemplateField[], values: Record<string, string>): McpShape {
  const v = withDefaults(fields, values);
  const plain = new Map(fields.filter((f) => !f.secret).map((f) => [f.key, v[f.key]!]));
  const sub = (x: string) => x.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (m, n: string) => plain.get(n) ?? m);
  const subAll = (o?: Record<string, string>) => (o ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, sub(x)])) : undefined);
  return {
    ...server,
    url: server.url && sub(server.url),
    command: server.command && sub(server.command),
    args: server.args?.map(sub),
    env: subAll(server.env),
    headers: subAll(server.headers),
  };
}
