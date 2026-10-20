import { createHash } from "node:crypto";
import { importV1alpha1, parseTree, validateTree, type DefinitionTree } from "@kiln/definitions";
import { jsonSchemaFor, SCHEMA_VERSION, type FileKind } from "@kiln/schema";
import { KilnError } from "./errors";

/** Published schema documents, by file name. */
export const SCHEMA_DOCUMENTS: Record<string, { kind: FileKind; path: string }> = {
  "factory.schema.json": { kind: "factory", path: "factory.yaml" },
  "agent.schema.json": { kind: "agent", path: "agents/<name>/agent.md (frontmatter)" },
  "automation.schema.json": { kind: "automation", path: "automations/<name>/automation.md (frontmatter)" },
  "runner.schema.json": { kind: "runner", path: "runners/<name>.yaml" },
  "router.schema.json": { kind: "router", path: "routers/<slug>.yaml" },
  "scorer.schema.json": { kind: "scorer", path: "scorers/<slug>/scorer.md (frontmatter)" },
  "benchmark_suite.schema.json": { kind: "benchmark-suite", path: "benchmarks/<suite>/suite.yaml" },
  "benchmark_suite_task.schema.json": { kind: "benchmark-task", path: "benchmarks/<suite>/tasks/<task>.yaml" },
  "skill.schema.json": { kind: "skill", path: "skills/<name>/SKILL.md (frontmatter)" },
  "webhook.schema.json": { kind: "webhook", path: "webhooks/<name>.yaml" },
  "pipeline.schema.json": { kind: "pipeline", path: "pipelines/<name>.yaml" },
  "gate.schema.json": { kind: "gate", path: "gates/<name>.yaml" },
  "policy.schema.json": { kind: "policy", path: "policies/<name>.yaml" },
  "decision.schema.json": { kind: "decision", path: "decisions/<name>.yaml" },
  "memory.schema.json": { kind: "memory", path: "memories/<slug>.md (frontmatter)" },
};

export const SCHEMA_VERSION_ID = "v1";
export const VALIDATE_LIMITS = { maxFiles: 256, maxFileBytes: 256 * 1024, maxTotalBytes: 2 * 1024 * 1024 } as const;

export function etagOf(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}"`;
}

export function schemaIndex(baseUrl: string) {
  return {
    currentVersion: SCHEMA_VERSION_ID,
    schemaVersion: SCHEMA_VERSION,
    versions: [{ schemaVersion: SCHEMA_VERSION_ID, schemaVersionField: SCHEMA_VERSION, schemaUrl: `${baseUrl.replace(/\/$/, "")}/api/v1/factory-files/schemas/${SCHEMA_VERSION_ID}` }],
    imports: ["v1alpha1"],
  };
}

function checkVersion(version: string) {
  if (version !== SCHEMA_VERSION_ID && version !== SCHEMA_VERSION) throw new KilnError("resource_not_found", `unknown schema version ${version}; current is ${SCHEMA_VERSION_ID} (v1alpha1 trees are imported, not published)`);
}

export function schemaDocument(version: string, name: string) {
  checkVersion(version);
  const doc = SCHEMA_DOCUMENTS[name] ?? SCHEMA_DOCUMENTS[`${name}.schema.json`];
  if (!doc) throw new KilnError("resource_not_found", `unknown schema document ${name}`);
  return { $id: name.endsWith(".schema.json") ? name : `${name}.schema.json`, title: doc.path, ...jsonSchemaFor(doc.kind) };
}

export function schemaBundle(version: string) {
  checkVersion(version);
  return { schemaVersion: SCHEMA_VERSION_ID, documents: Object.fromEntries(Object.keys(SCHEMA_DOCUMENTS).map((n) => [n, schemaDocument(version, n)])) };
}

export type Diagnostic = { path: string; line: number; code: string; message: string; severity: "error" | "warning" | "info" };
export type DeferredResolution = { path: string; field: string; kind: "model" | "secret" | "mcp_server" | "worker_host" | "alias" | "runner" | "integration"; value: string };

/**
 * Validate a definition tree without saving it: schema and reference checks with file and line,
 * plus what can only be checked when the tree is applied on a server (models, secrets, MCP
 * servers, worker hosts, alias uniqueness).
 */
export function validateFiles(files: { path: string; content: string }[]): { ok: boolean; schemaVersion: string; diagnostics: Diagnostic[]; deferredResolutions: DeferredResolution[] } {
  if (files.length > VALIDATE_LIMITS.maxFiles) throw new KilnError("invalid_request", `at most ${VALIDATE_LIMITS.maxFiles} files`);
  let total = 0;
  const tree: DefinitionTree = {};
  for (const f of files) {
    if (f.path.startsWith("/") || f.path.split("/").includes("..")) throw new KilnError("invalid_request", `invalid path ${f.path}`);
    const size = Buffer.byteLength(f.content);
    if (size > VALIDATE_LIMITS.maxFileBytes) throw new KilnError("invalid_request", `${f.path} is larger than 256 KB`);
    total += size;
    tree[f.path] = f.content;
  }
  if (total > VALIDATE_LIMITS.maxTotalBytes) throw new KilnError("invalid_request", "the files are larger than 2 MB together");
  const diagnostics: Diagnostic[] = [];
  let input = tree;
  if (/schemaVersion:\s*v1alpha1/.test(tree["factory.yaml"] ?? "")) {
    const imported = importV1alpha1(tree);
    input = imported.tree;
    diagnostics.push({ path: "factory.yaml", line: 1, code: "import", message: "v1alpha1 tree: validated after import to kiln/v1", severity: "info" });
    for (const w of imported.warnings) diagnostics.push({ path: w.split(":")[0]!, line: 1, code: "import", message: w, severity: "warning" });
  }
  const v = validateTree(input);
  if (!v.ok) for (const e of v.errors) diagnostics.push({ path: e.file, line: e.line, code: e.code, message: e.message, severity: "error" });
  for (const w of v.warnings) diagnostics.push({ path: w.file, line: w.line, code: w.code, message: w.message, severity: "warning" });

  const parsed = v.parsed ?? parseTree(input);
  const deferred: DeferredResolution[] = [];
  const add = (path: string, field: string, kind: DeferredResolution["kind"], value: unknown) => {
    if (typeof value === "string" && value) deferred.push({ path, field, kind, value });
  };
  type Exec = { harness?: { model?: string; auth?: object | null } | null; model?: string | null; secrets?: string[] | null; mcpServers?: string[] | null; workerHost?: string | null; computerUseModel?: string | null };
  const execution = (path: string, prefix: string, e: Exec | undefined) => {
    if (!e) return;
    for (const [field, model] of [[`${prefix}model`, e.model], [`${prefix}harness.model`, e.harness?.model], [`${prefix}computerUseModel`, e.computerUseModel]] as const) if (model && !String(model).startsWith("router:")) add(path, field, "model", model);
    add(path, `${prefix}harness.auth.secretName`, "secret", (e.harness?.auth as { secretName?: string } | null | undefined)?.secretName);
    for (const s of e.secrets ?? []) add(path, `${prefix}secrets`, "secret", s);
    for (const m of e.mcpServers ?? []) add(path, `${prefix}mcpServers`, "mcp_server", m);
    add(path, `${prefix}workerHost`, "worker_host", e.workerHost);
  };
  if (parsed.factory) {
    execution("factory.yaml", "agentDefaults.", parsed.factory.agentDefaults);
    add("factory.yaml", "alias", "alias", parsed.factory.alias ?? parsed.factory.name);
    for (const i of parsed.factory.integrations) add("factory.yaml", "integrations", "integration", i);
  }
  for (const [name, a] of Object.entries(parsed.agents)) execution(`agents/${name}/agent.md`, "", a.frontmatter);
  for (const [name, a] of Object.entries(parsed.automations)) execution(`automations/${name}/automation.md`, "", a.frontmatter);
  for (const [name, s] of Object.entries(parsed.scorers)) add(`scorers/${name}/scorer.md`, "model", "model", s.frontmatter.model);
  return { ok: v.ok, schemaVersion: SCHEMA_VERSION_ID, diagnostics, deferredResolutions: deferred };
}
