import type { Kiln } from "@kiln/engine";
import { z } from "zod";
import type { RouteContext } from "../app";
import type { Route } from "../openapi";

export const CreateFactory = z.object({
  name: z.string().min(1).max(100),
  alias: z.string().optional(),
  description: z.string().optional(),
  /** An uploaded image key (POST /api/v1/uploads). */
  avatar: z.string().optional(),
  repos: z.array(z.object({ owner: z.string().min(1), name: z.string().min(1), forge: z.enum(["github", "gitlab"]).optional(), deferred: z.boolean().optional() })).min(1),
  agents: z.object({ triage: z.boolean().optional(), spec: z.boolean().optional(), implement: z.boolean().optional(), review: z.boolean().optional() }).optional(),
  communications: z.object({ slack: z.boolean().optional() }).optional(),
  tracker: z.object({ type: z.enum(["linear", "jira"]), scopes: z.array(z.string()).optional() }).optional(),
  costPreset: z.enum(["quality", "efficient"]).optional(),
  harness: z.enum(["claude-code", "codex", "opencode", "gemini", "pi"]).optional(),
  selfImprovement: z.boolean().optional(),
  automationTemplates: z.array(z.string()).optional(),
  runner: z.object({ image: z.string().optional(), setupCommands: z.array(z.string()).optional() }).optional(),
  workerHost: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export const routes: Route[] = [
  { method: "post", path: "/api/v1/factories", summary: "Create a factory (the setup wizard in one call): repos, agents, communications, tracker, cost preset, self-improvement, automation templates", scope: "definitions:write", body: CreateFactory, tag: "Factories" },
  { method: "post", path: "/api/v1/factories/{id}/learning", summary: "Enable learning: a run that studies the repos and tools and proposes memories and prompt changes", scope: "definitions:write", tag: "Factories" },
  { method: "get", path: "/api/v1/forge/repositories", summary: "Repositories the code forge can reach (for the wizard and list_forge_repositories)", tag: "Factories" },
  { method: "get", path: "/api/v1/tracker/scopes", summary: "Tracker teams or projects (for the wizard and list_tracker_scopes)", tag: "Factories" },
];

/** Repositories the forge exposes when it can list them; otherwise the ones factories already use. */
export async function forgeRepositories(kiln: Kiln): Promise<{ owner: string; name: string; forge: string }[]> {
  const f = kiln.forge as { listRepositories?: () => Promise<{ owner: string; name: string }[]> };
  const listed = f.listRepositories ? await f.listRepositories().catch(() => []) : [];
  const used = kiln.defs.list().flatMap((b) => (b.appliedSha ? kiln.defs.resolved(b.appliedSha).factory.repositories : []));
  const all = [...listed, ...used].map((r) => ({ owner: r.owner, name: r.name, forge: kiln.forge.name }));
  return all.filter((r, i) => all.findIndex((x) => x.owner === r.owner && x.name === r.name) === i).sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
}

export async function trackerScopes(kiln: Kiln): Promise<{ tracker: string; scopes: { id: string; name: string }[] }> {
  const t = kiln.tracker as (Kiln["tracker"] & { listScopes?: () => Promise<{ id: string; name: string }[]> }) | undefined;
  if (!t) return { tracker: "none", scopes: [] };
  const scopes = t.listScopes ? await t.listScopes().catch(() => []) : [];
  return { tracker: t.name, scopes };
}

/** Factory creation, learning and onboarding lookups. */
export function register({ app, kiln, need, who, adopt, checkOrgs }: RouteContext) {
  app.post("/api/v1/factories", async (c) => {
    need(c, "definitions:write", "*");
    const { avatar, ...body } = CreateFactory.parse(await c.req.json());
    checkOrgs(c, body.repos);
    const files = avatar ? kiln.files.resolveAttachments([avatar], who(c), "") : [];
    const before = new Set(kiln.defs.list().map((f) => f.id));
    const r = await kiln.wizard.create({ ...body, avatar: files[0] }, who(c));
    if (!body.dryRun) adopt(c, before);
    return c.json(r, body.dryRun ? 200 : 201);
  });
  app.post("/api/v1/factories/:id/learning", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(kiln.runQuery.view(await kiln.wizard.enableLearning(id, who(c))), 201);
  });
  app.get("/api/v1/forge/repositories", async (c) => c.json({ forge: kiln.forge.name, repositories: await forgeRepositories(kiln) }));
  app.get("/api/v1/tracker/scopes", async (c) => c.json(await trackerScopes(kiln)));
}
