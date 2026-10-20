import { readFrontmatter } from "@kiln/engine";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { restOf } from "./util";

const Harness = z.object({ type: z.enum(["claude-code", "codex", "opencode", "gemini", "pi"]), model: z.string().optional(), reasoningLevel: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(), auth: z.record(z.string(), z.unknown()).nullable().optional() });
export const AgentBody = z.object({
  prompt: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  agentType: z.enum(["FOREMAN", "TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "VERIFY", "PLAN", "PO_ASSISTANT", "CUSTOM"]).optional(),
  harness: Harness.nullable().optional(),
  model: z.string().nullable().optional(),
  runner: z.string().nullable().optional(),
  workerHost: z.string().nullable().optional(),
  mcpServers: z.array(z.string()).nullable().optional(),
  secrets: z.array(z.string()).nullable().optional(),
  spawnableBy: z.array(z.string()).nullable().optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(60).nullable().optional(),
  computerUseModel: z.string().nullable().optional(),
  credentialStrategy: z.enum(["EXECUTOR", "CREATOR"]).nullable().optional(),
  networkPolicy: z.object({ allowedHosts: z.array(z.string()).optional(), deniedHosts: z.array(z.string()).optional() }).nullable().optional(),
  required_repos: z.array(z.object({ owner: z.string(), name: z.string() })).nullable().optional(),
});
export const AutomationBody = z.object({
  enabled: z.boolean().optional(),
  agent: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  triggers: z.array(z.record(z.string(), z.unknown())).min(1).optional(),
  prompt: z.string().optional(),
  harness: Harness.nullable().optional(),
  model: z.string().nullable().optional(),
  runner: z.string().nullable().optional(),
  workerHost: z.string().nullable().optional(),
  secrets: z.array(z.string()).nullable().optional(),
  mcpServers: z.array(z.string()).nullable().optional(),
});
export const SkillBody = z.object({ description: z.string().min(1), body: z.string().min(1), owner: z.string().optional(), version: z.string().optional(), agent: z.string().optional() });
const Repo = z.object({ owner: z.string().min(1), name: z.string().min(1), forge: z.enum(["github", "gitlab"]).optional(), deferred: z.boolean().optional() });
export const SettingsBody = z.object({
  name: z.string().min(1).max(100).optional(),
  alias: z.string().optional(),
  description: z.string().nullable().optional(),
  repositories: z.array(Repo).min(1).optional(),
  addRepositories: z.array(Repo).optional(),
  removeRepositories: z.array(Repo.pick({ owner: true, name: true })).optional(),
  integrations: z.array(z.string()).optional(),
  credentialStrategy: z.enum(["EXECUTOR", "CREATOR"]).nullable().optional(),
  agentDefaults: z.record(z.string(), z.unknown()).optional(),
  scorerDefaults: z.record(z.string(), z.unknown()).nullable().optional(),
  selfImprovement: z.record(z.string(), z.unknown()).nullable().optional(),
  benchmarkingModel: z.string().nullable().optional(),
  networkPolicy: z.record(z.string(), z.unknown()).nullable().optional(),
  budgets: z.record(z.string(), z.unknown()).nullable().optional(),
  blueprint: z.record(z.string(), z.unknown()).nullable().optional(),
  experimental: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultPipeline: z.string().nullable().optional(),
});
export const SelfImprovementBody = z.object({
  enabled: z.boolean().optional(),
  failedRunThreshold: z.number().int().min(1).max(50).optional(),
  maxAgeDays: z.number().int().min(1).max(90).optional(),
  reviewers: z.object({ type: z.enum(["admins", "team", "custom", "none"]), emails: z.array(z.string().email()).optional() }).optional(),
  model: z.string().nullable().optional(),
  scorers: z.record(z.string(), z.boolean()).optional(),
});
export const PutFile = z.object({ content: z.string(), message: z.string().optional() });
export const Commit = z.object({ message: z.string().min(1), files: z.record(z.string().min(1), z.string().nullable()).refine((f) => Object.keys(f).length > 0, "change at least one file"), dryRun: z.boolean().optional() });
export const Batch = z.object({
  changes: z.array(z.object({ path: z.string().min(1), content: z.string().nullable() })).min(1).max(256),
  message: z.string().min(1),
  dryRun: z.boolean().optional(),
});
export const Migrate = z.object({ owner: z.string().min(1), name: z.string().min(1), ref: z.string().optional(), dir: z.string().optional() });
export const Avatar = z.object({ file: z.string().min(1) });

const F = "/api/v1/factories/{id}";
export const routes: Route[] = [
  { method: "get", path: `${F}/files`, summary: "Every file of the applied definition (path and size)", scope: "read", tag: "Definitions" },
  { method: "get", path: `${F}/files/{path}`, summary: "One definition file", scope: "read", tag: "Definitions" },
  { method: "put", path: `${F}/files/{path}`, summary: "Write one file: managed factories validate and apply; repo-backed factories get a PR", scope: "definitions:write", body: PutFile, tag: "Definitions" },
  { method: "delete", path: `${F}/files/{path}`, summary: "Delete one file (same rules as PUT)", scope: "definitions:write", tag: "Definitions" },
  { method: "post", path: `${F}/files:batch`, summary: "Change several files in one commit: {changes:[{path, content|null}], message} → {applied: sha} or {pullRequest: url}", scope: "definitions:write", body: Batch, tag: "Definitions" },
  { method: "post", path: `${F}/files/commit`, summary: "Change several files in one commit with a message (null deletes); dryRun validates only", scope: "definitions:write", body: Commit, tag: "Definitions" },
  { method: "get", path: `${F}/agents`, summary: "Agents with their resolved settings and prompts", scope: "read", tag: "Definitions" },
  { method: "put", path: `${F}/agents/{name}`, summary: "Create or update an agent (prompt, harness, model, runner, workerHost, MCPs, secrets, spawnableBy, idle timeout, computer use, network policy)", scope: "definitions:write", body: AgentBody, tag: "Definitions" },
  { method: "delete", path: `${F}/agents/{name}`, summary: "Delete an agent (not the foreman)", scope: "definitions:write", tag: "Definitions" },
  { method: "put", path: `${F}/automations/{name}`, summary: "Create or update an automation", scope: "definitions:write", body: AutomationBody, tag: "Definitions" },
  { method: "delete", path: `${F}/automations/{name}`, summary: "Delete an automation", scope: "definitions:write", tag: "Definitions" },
  { method: "put", path: `${F}/runners/{name}`, summary: "Create or update a runner (image or platform, shape, setup commands, egress, failure retention)", scope: "definitions:write", tag: "Definitions" },
  { method: "delete", path: `${F}/runners/{name}`, summary: "Delete a runner", scope: "definitions:write", tag: "Definitions" },
  { method: "put", path: `${F}/routers/{name}`, summary: "Create or replace a model router (complexity or prompt)", scope: "definitions:write", tag: "Definitions" },
  { method: "delete", path: `${F}/routers/{name}`, summary: "Delete a router", scope: "definitions:write", tag: "Definitions" },
  { method: "put", path: `${F}/skills/{name}`, summary: "Create or update a skill (shared, or one agent's with `agent`)", scope: "definitions:write", body: SkillBody, tag: "Definitions" },
  { method: "delete", path: `${F}/skills/{name}`, summary: "Delete a skill (?agent= for an agent's own)", scope: "definitions:write", tag: "Definitions" },
  { method: "get", path: `${F}/settings`, summary: "Factory settings from factory.yaml plus the avatar and where the definition lives", scope: "read", tag: "Definitions" },
  { method: "patch", path: `${F}/settings`, summary: "Change name, alias, description, repositories, credential strategy, agent and scorer defaults, self-improvement, benchmarking model", scope: "definitions:write", body: SettingsBody, tag: "Definitions" },
  { method: "get", path: `${F}/self-improvement/settings`, summary: "Self-improvement toggle, threshold, reviewers, model and per-scorer toggles", scope: "read", tag: "Measure" },
  { method: "put", path: `${F}/self-improvement/settings`, summary: "Change self-improvement settings and per-scorer toggles in one change", scope: "definitions:write", body: SelfImprovementBody, tag: "Measure" },
  { method: "post", path: `${F}/avatar`, summary: "Set the avatar from an uploaded image (file key)", scope: "definitions:write", body: Avatar, tag: "Definitions" },
  { method: "post", path: `${F}/migrate`, summary: "Move a Kiln-managed factory to a GitHub repo (opens a PR; the merge switches it over)", scope: "definitions:write", body: Migrate, tag: "Definitions" },
  { method: "post", path: `${F}/migrate/complete`, summary: "Finish the move once the migration PR merged", scope: "definitions:write", tag: "Definitions" },
  { method: "delete", path: F, summary: "Delete the factory (irreversible; cancels active tasks)", scope: "admin", tag: "Definitions" },
];

/** Read and edit factory definitions file by file, and the high-level endpoints the UI uses. */
export function register({ app, kiln, need, who }: RouteContext) {
  const filePath = (c: Context<Env>) => {
    const path = restOf(c, /^\/api\/v1\/factories\/[^/]+\/files\//);
    if (!path || path.split("/").includes("..") || path.startsWith("/")) throw new HttpError(400, "invalid path");
    return path;
  };

  app.get("/api/v1/factories/:id/files", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const tree = kiln.editor.tree(id);
    const b = kiln.defs.require(id);
    return c.json({ sha: b.appliedSha, managed: !b.definitionRepo, files: Object.keys(tree).sort().map((path) => ({ path, size: Buffer.byteLength(tree[path]!) })) });
  });
  app.post("/api/v1/factories/:id/files/commit", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const body = Commit.parse(await c.req.json());
    const r = await kiln.editor.write(id, body.files, { message: body.message, by: who(c), dryRun: body.dryRun });
    return c.json(r, r.ok ? 200 : 400);
  });
  // The web UI's batch commit: {changes:[{path, content|null}], message} → {applied: sha} | {pullRequest: url}.
  app.post("/api/v1/factories/:id/:op{files:batch}", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const body = Batch.parse(await c.req.json());
    const r = await kiln.editor.write(id, Object.fromEntries(body.changes.map((ch) => [ch.path, ch.content])), { message: body.message, by: who(c), dryRun: body.dryRun });
    if (!r.ok) return c.json({ error: "the definition would be invalid", errors: r.errors }, 400);
    if (r.mode === "pull_request") return c.json({ pullRequest: r.prUrl, branch: r.branch, diff: r.diff });
    return c.json({ applied: r.sha, diff: r.diff, ...(r.mode === "dry_run" ? { dryRun: true } : {}) });
  });
  app.get("/api/v1/factories/:id/files/*", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const path = filePath(c);
    const content = kiln.editor.file(id, path);
    if (content === undefined) throw new HttpError(404, `no file ${path}`);
    return c.req.header("accept")?.includes("text/plain") ? c.text(content) : c.json({ path, content });
  });
  app.put("/api/v1/factories/:id/files/*", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const path = filePath(c);
    const isJson = (c.req.header("content-type") ?? "").includes("application/json");
    const body = isJson ? PutFile.parse(await c.req.json()) : { content: await c.req.text(), message: undefined };
    const r = await kiln.editor.write(id, { [path]: body.content }, { message: body.message ?? `Update ${path}`, by: who(c) });
    return c.json(r, r.ok ? 200 : 400);
  });
  app.delete("/api/v1/factories/:id/files/*", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const path = filePath(c);
    if (kiln.editor.file(id, path) === undefined) throw new HttpError(404, `no file ${path}`);
    const r = await kiln.editor.write(id, { [path]: null }, { message: c.req.query("message") ?? `Delete ${path}`, by: who(c) });
    return c.json(r, r.ok ? 200 : 400);
  });

  app.get("/api/v1/factories/:id/agents", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const r = kiln.defs.current(id);
    return c.json({ agents: Object.values(r.agents).map((a) => ({ ...a, file: `agents/${a.name}/agent.md`, frontmatter: readFrontmatter(kiln.editor.file(id, `agents/${a.name}/agent.md`)).front })) });
  });
  app.put("/api/v1/factories/:id/agents/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.upsertAgent(id, name, AgentBody.parse(await c.req.json()), who(c)));
  });
  app.delete("/api/v1/factories/:id/agents/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.deleteAgent(id, name, who(c)));
  });
  app.put("/api/v1/factories/:id/automations/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.upsertAutomation(id, name, AutomationBody.parse(await c.req.json()), who(c)));
  });
  app.delete("/api/v1/factories/:id/automations/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.deleteAutomation(id, name, who(c)));
  });
  for (const dir of ["runners", "routers"] as const) {
    app.put(`/api/v1/factories/:id/${dir}/:name`, async (c) => {
      const { id, name } = c.req.param();
      need(c, "definitions:write", id);
      return c.json(await kiln.editor.upsertYaml(id, dir, name, z.record(z.string(), z.unknown()).parse(await c.req.json()), who(c)));
    });
    app.delete(`/api/v1/factories/:id/${dir}/:name`, async (c) => {
      const { id, name } = c.req.param();
      need(c, "definitions:write", id);
      return c.json(await kiln.editor.deleteYaml(id, dir, name, who(c)));
    });
  }
  app.put("/api/v1/factories/:id/skills/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.upsertSkill(id, name, SkillBody.parse(await c.req.json()), who(c)));
  });
  app.delete("/api/v1/factories/:id/skills/:name", async (c) => {
    const { id, name } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.deleteSkill(id, name, who(c), c.req.query("agent")));
  });

  app.get("/api/v1/factories/:id/settings", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const b = kiln.defs.require(id);
    const r = kiln.defs.current(id);
    return c.json({
      factory: r.factory,
      alias: r.factory.alias ?? b.alias,
      avatarUrl: b.avatarKey ? `/api/v1/files/${b.avatarKey}` : undefined,
      definition: b.definitionRepo ? { mode: "github", repo: `${b.definitionRepo.owner}/${b.definitionRepo.name}`, ref: b.definitionRepo.ref, dir: b.definitionRepo.dir } : { mode: "managed", migration: b.migration },
      credentialStrategy: r.factory.credentialStrategy ?? "EXECUTOR",
      benchmarkingModel: r.factory.scoring?.defaultModel,
      creator: b.creator,
      createdAt: b.createdAt,
    });
  });
  app.patch("/api/v1/factories/:id/settings", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.updateSettings(id, SettingsBody.parse(await c.req.json()), who(c)));
  });
  app.get("/api/v1/factories/:id/self-improvement/settings", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json(kiln.improvement.settings(id));
  });
  app.put("/api/v1/factories/:id/self-improvement/settings", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.updateSelfImprovement(id, SelfImprovementBody.parse(await c.req.json()), who(c)));
  });
  app.post("/api/v1/factories/:id/avatar", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const { file } = Avatar.parse(await c.req.json());
    const [attachment] = kiln.files.resolveAttachments([file], who(c), id);
    const key = await kiln.editor.setAvatar(id, attachment!, who(c));
    return c.json({ avatarUrl: `/api/v1/files/${key}` });
  });
  app.post("/api/v1/factories/:id/migrate", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.editor.migrateToRepo(id, Migrate.parse(await c.req.json()), who(c)), 201);
  });
  app.post("/api/v1/factories/:id/migrate/complete", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const switched = await kiln.editor.completeMigration(id, who(c));
    return c.json({ switched, factory: kiln.defs.require(id) });
  });
  app.delete("/api/v1/factories/:id", async (c) => {
    const id = c.req.param("id");
    need(c, "admin", id);
    const result = await kiln.editor.deleteFactory(id, who(c));
    // Integrations remove what they set up for the factory (Slack app, factory labels) when they can.
    const hub = (kiln as unknown as { integrations?: { cleanupFactory?: (factory: string) => Promise<unknown> } }).integrations;
    if (hub?.cleanupFactory) await hub.cleanupFactory(id).catch((err: unknown) => kiln.audit(who(c), "factory.cleanup_failed", id, { error: String(err) }));
    return c.json(result);
  });
}
