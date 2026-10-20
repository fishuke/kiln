/**
 * Generates the reference pages that must not drift from the code: CLI (from the CLI's help),
 * API (from the route table), MCP (from the registered tools), definition files (from the
 * schemas), plus the docs index, llms.txt and llms-full.txt. CI fails if the output changes.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fileKinds, jsonSchemaFor, type FileKind } from "@kiln/schema";
import { KilnClient } from "@kiln/sdk-ts";
import { createKilnMcpServer } from "../apps/mcp/src/index";
import { ROUTES } from "../apps/api/src/openapi";
import { HELP } from "../packages/cli/src/main";

const SITE = fileURLToPath(new URL("../docs/site/", import.meta.url));
const BASE_URL = "https://github.com/fishuke/klin/blob/main/docs/site";

function page(title: string, description: string, section: string, body: string) {
  return `---\ntitle: ${title}\ndescription: ${description}\nowner: docs\nsection: ${section}\ngenerated: true\n---\n\n${body.trim()}\n`;
}

function write(path: string, content: string) {
  const full = join(SITE, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

// CLI
write(
  "developer-tools/cli.md",
  page(
    "CLI reference",
    "Every kiln command, generated from the CLI's help text.",
    "Developer tools",
    `The \`kiln\` CLI validates and applies factory definitions locally and talks to a Kiln server for everything else.

Set \`KILN_URL\` (default \`http://localhost:4000\`) and \`KILN_TOKEN\`, or put \`{ "url": "...", "token": "..." }\` in \`~/.kiln/config.json\`. In this repository run it as \`pnpm kiln <command>\`; paths resolve from the directory you ran pnpm in.

\`\`\`text
${HELP.trim()}
\`\`\`

## Exit codes

- \`0\` success.
- \`1\` validation errors (printed as \`file:line: message\`), API errors (\`error <status>: <message>\`) or bad arguments.

## Related pages

- [API reference](api.md)
- [Kiln MCP](mcp.md)
- [Definitions as code](../configuration/definitions-as-code.md)
`,
  ),
);

// API
const tags = [...new Set(ROUTES.map((r) => r.tag))];
write(
  "developer-tools/api.md",
  page(
    "API reference",
    "Every REST endpoint with its scope, generated from the route table.",
    "Developer tools",
    `Kiln's REST API lives under \`/api/v1\`. Send \`Authorization: Bearer <token>\`; each route needs the scope shown for the factory it touches (\`admin\` grants every scope). The machine-readable document is at \`/api/v1/openapi.json\`, and the TypeScript SDK (\`@kiln/sdk-ts\`) wraps every route.

${tags
  .map(
    (tag) => `## ${tag}

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
${ROUTES.filter((r) => r.tag === tag)
  .map((r) => `| ${r.method.toUpperCase()} | \`${r.path}\` | ${r.scope ? `\`${r.scope}\`` : "—"} | ${r.summary} |`)
  .join("\n")}`,
  )
  .join("\n\n")}

## Errors

Errors are JSON: \`{ "error": "message" }\` with status 400 (invalid request; \`issues\` lists the fields), 401 (missing or invalid token), 403 (token lacks the scope), 404 (unknown resource) or 409 (wrong state).

## Related pages

- [CLI reference](cli.md)
- [Kiln MCP](mcp.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
`,
  ),
);

// MCP
const server = createKilnMcpServer(new KilnClient({ baseUrl: "http://localhost" }));
const tools = Object.entries((server as unknown as { _registeredTools: Record<string, { description?: string; inputSchema?: unknown }> })._registeredTools).sort(([a], [b]) => a.localeCompare(b));
write(
  "developer-tools/mcp.md",
  page(
    "Kiln MCP",
    "Connect coding agents to Kiln over MCP; every tool and its arguments, generated from the server.",
    "Developer tools",
    `The Kiln MCP server is served at \`<public URL>/mcp\` over streamable HTTP. Agents use it to send tasks, take them to a local worktree, hand them back, decide gates and query metrics. Every call goes through the API with the caller's token, so per-factory scopes apply: a token with only \`decide:preview\` cannot write definitions.

## Connect

\`\`\`bash
claude mcp add --transport http kiln https://kiln.example.com/mcp --header "Authorization: Bearer $KILN_TOKEN"
\`\`\`

\`\`\`toml
# ~/.codex/config.toml
[mcp_servers.kiln]
url = "https://kiln.example.com/mcp"
bearer_token_env_var = "KILN_TOKEN"
\`\`\`

## Setup prompt for an agent

\`\`\`text
Connect to the Kiln MCP server at https://kiln.example.com/mcp with the bearer token in $KILN_TOKEN.
List my factories, then help me send a task to the right one and follow it through the inbox.
\`\`\`

## Tools

| Tool | What it does |
| --- | --- |
${tools.map(([name, t]) => `| \`${name}\` | ${t.description ?? ""} |`).join("\n")}

## Related pages

- [API reference](api.md)
- [Admin, RBAC and audit](../management/admin-rbac-audit.md)
`,
  ),
);

// Definition files
type JSONSchema = { type?: string | string[]; properties?: Record<string, JSONSchema>; required?: string[]; enum?: unknown[]; const?: unknown; items?: JSONSchema; anyOf?: JSONSchema[]; oneOf?: JSONSchema[]; default?: unknown; description?: string; minimum?: number; maximum?: number; pattern?: string };
function typeOf(s: JSONSchema | undefined): string {
  if (!s) return "any";
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (s.enum) return s.enum.map((e) => `\`${String(e)}\``).join(" \\| ");
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return alts.map(typeOf).join(" \\| ");
  if (s.type === "array") return `list of ${typeOf(s.items)}`;
  if (s.type === "object" && s.properties) return "object";
  return Array.isArray(s.type) ? s.type.join(" \\| ") : (s.type ?? "any");
}
function rows(schema: JSONSchema, prefix = ""): string[] {
  const props = schema.properties ?? (schema.anyOf ?? schema.oneOf)?.find((a) => a.properties)?.properties ?? {};
  const req = new Set(schema.required ?? []);
  const out: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const notes = [v.default !== undefined ? `default \`${JSON.stringify(v.default)}\`` : "", v.minimum !== undefined ? `min ${v.minimum}` : "", v.maximum !== undefined ? `max ${v.maximum}` : "", v.pattern ? `pattern \`${v.pattern}\`` : ""].filter(Boolean).join(", ");
    out.push(`| \`${prefix}${k}\` | ${typeOf(v)} | ${req.has(k) ? "yes" : ""} | ${notes} |`);
    const inner = v.type === "object" || v.properties ? v : (v.anyOf ?? v.oneOf)?.find((a) => a.properties);
    if (inner?.properties) out.push(...rows(inner, `${prefix}${k}.`));
    if (v.type === "array" && v.items?.properties) out.push(...rows(v.items, `${prefix}${k}[].`));
  }
  return out;
}
const PATHS: Record<FileKind, string> = {
  factory: "factory.yaml",
  agent: "agents/<name>/agent.md (frontmatter)",
  automation: "automations/<name>/automation.md (frontmatter)",
  pipeline: "pipelines/<name>.yaml",
  gate: "gates/<name>.yaml",
  policy: "policies/<name>.yaml",
  runner: "runners/<name>.yaml",
  router: "routers/<name>.yaml",
  scorer: "scorers/<name>/scorer.md (frontmatter)",
  "benchmark-suite": "benchmarks/<suite>/suite.yaml",
  "benchmark-task": "benchmarks/<suite>/tasks/<task>.yaml",
  skill: "skills/<name>/SKILL.md (frontmatter)",
  webhook: "webhooks/<name>.yaml",
  decision: "decisions/<name>.yaml",
  memory: "memories/<slug>.md (frontmatter)",
};
write(
  "configuration/definitions-reference.md",
  page(
    "Definition file reference",
    "Every key of every definition file, generated from the schemas (kiln/v1).",
    "Factory configuration",
    `Generated from \`packages/schema\`. Unknown keys are errors. Run \`kiln schema <kind>\` for the JSON Schema of a file kind, for editor completion.

${(Object.keys(fileKinds) as FileKind[])
  .map(
    (kind) => `## ${kind}

\`${PATHS[kind]}\`

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
${rows(jsonSchemaFor(kind) as JSONSchema).join("\n")}`,
  )
  .join("\n\n")}

## Related pages

- [Definitions as code](definitions-as-code.md)
- [Agents](agents.md)
- [Automations](automations.md)
`,
  ),
);

// Index, llms.txt and llms-full.txt
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : e.endsWith(".md") && e !== "index.md" ? [full] : [];
  });
}
type Page = { path: string; title: string; description: string; section: string; body: string };
const pages: Page[] = walk(SITE)
  .map((full) => {
    const src = readFileSync(full, "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(src)?.[1] ?? "";
    const get = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(fm)?.[1]?.trim() ?? "";
    return { path: relative(SITE, full), title: get("title"), description: get("description"), section: get("section"), body: src.replace(/^---\n[\s\S]*?\n---\n/, "").trim() };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const ORDER = ["Overview", "Factory configuration", "Infrastructure", "Code forges and integrations", "Integrations", "Product owners", "Measure and improve", "Developer tools", "Management", "Guides"];
const sections = [...new Set(pages.map((p) => p.section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
write(
  "index.md",
  page(
    "Kiln documentation",
    "Self-hostable, open source software factories: agents turn issues and requests into reviewed pull requests, and people approve specs, previews and merges.",
    "Overview",
    `Kiln turns issues, Slack threads and tracker tickets into reviewed pull requests with a team of agents, and people stay in charge of specs, previews and merges. It is open source (MIT), runs on your own machines, and uses your own model keys or a Claude subscription.

${sections.map((s) => `## ${s}\n\n${pages.filter((p) => p.section === s).map((p) => `- [${p.title}](${p.path}): ${p.description}`).join("\n")}`).join("\n\n")}
`,
  ),
);
writeFileSync(
  join(SITE, "llms.txt"),
  `# Kiln\n\n> Self-hostable, open source software factories. Agents (Claude Code, Codex, OpenCode) turn issues and requests into reviewed pull requests; people approve specs, previews and merges. Factories are defined as code and stored in GitHub repos you own.\n\n${sections
    .map((s) => `## ${s}\n\n${pages.filter((p) => p.section === s).map((p) => `- [${p.title}](${BASE_URL}/${p.path}): ${p.description}`).join("\n")}`)
    .join("\n\n")}\n`,
);
writeFileSync(join(SITE, "llms-full.txt"), pages.map((p) => `# ${p.title}\n\nSource: ${BASE_URL}/${p.path}\n\n${p.body}`).join("\n\n---\n\n") + "\n");
console.log(`Generated reference pages; indexed ${pages.length} pages.`);
