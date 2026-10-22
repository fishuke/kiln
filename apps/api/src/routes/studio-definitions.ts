import type { Kiln } from "@kiln/engine";
import { AppDefinitionError, AppDefinitions, AppSettingsPatch, COLLECTIONS, StudioError, targetOf, type App, type DefinitionTarget } from "@kiln/studio";
import type { Context } from "hono";
import { z } from "zod";
import { HttpError, type Env, type RouteContext } from "../app";
import type { Route } from "../openapi";
import { currentTeam } from "./platform-helpers";

/** One `AppDefinitions` per Kiln, so `routes/studio.ts` can hand the same instance to `Studio`. */
const instances = new WeakMap<Kiln, AppDefinitions>();
export function appDefinitionsFor(kiln: Kiln): AppDefinitions {
  let d = instances.get(kiln);
  if (!d) instances.set(kiln, (d = new AppDefinitions({ store: kiln.store, clock: kiln.clock })));
  return d;
}

export const PutDefinition = z.object({ tree: z.record(z.string().min(1), z.string()), message: z.string().max(200).optional() }).strict();
export const UseDefinition = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/, "a 40-character definition sha") }).strict();

const SCOPES = ["apps/{id}", "projects/{id}", "team"] as const;
const LAYER = { "apps/{id}": "an App's own", "projects/{id}": "a Kiln Project's", team: "the team's" } as const;

export const routes: Route[] = [
  ...SCOPES.flatMap((s): Route[] => [
    { method: "get", path: `/api/v1/studio/${s}/definition`, summary: `${cap(LAYER[s])} Studio definition layer: tree, sha and history`, tag: "Studio" },
    {
      method: "put",
      path: `/api/v1/studio/${s}/definition`,
      summary: `Replace ${LAYER[s]} definition layer (kiln/v1 App tree)`,
      body: PutDefinition,
      tag: "Studio",
    },
    {
      method: "patch",
      path: `/api/v1/studio/${s}/definition`,
      summary: `Change ${LAYER[s]} definition layer from settings`,
      body: AppSettingsPatch,
      tag: "Studio",
    },
    {
      method: "post",
      path: `/api/v1/studio/${s}/definition/use`,
      summary: `Point ${LAYER[s]} definition layer at an earlier sha`,
      body: UseDefinition,
      tag: "Studio",
    },
  ]),
  { method: "get", path: "/api/v1/studio/apps/{id}/settings", summary: "An App's resolved settings and its own values", tag: "Studio" },
  { method: "get", path: "/api/v1/studio/team/settings", summary: "The team's Studio defaults, resolved", tag: "Studio" },
  { method: "get", path: "/api/v1/studio/projects/{id}/settings", summary: "A Kiln Project's Studio defaults, resolved", tag: "Studio" },
  {
    method: "get",
    path: "/api/v1/studio/apps/{id}/definition/export",
    summary: "An App's definition in kiln/v1 layout (?resolved=false for its own layer)",
    tag: "Studio",
  },
];

function cap(s: string) {
  return s[0]!.toUpperCase() + s.slice(1);
}

export function register(ctx: RouteContext) {
  const { app, kiln } = ctx;
  const defs = appDefinitionsFor(kiln);

  /** The layer a request names, checked against the caller's team. Changing team or project defaults needs a team admin. */
  const target = (c: Context<Env>, write: boolean): DefinitionTarget => {
    const path = c.req.path;
    if (path.startsWith("/api/v1/studio/apps/")) {
      ctx.user(c);
      const team = ctx.team(c).id;
      const a = kiln.store.get<App>(COLLECTIONS.apps, c.req.param("id")!);
      if (!a || a.team !== team) throw new HttpError(404, `unknown app ${c.req.param("id")}`);
      return targetOf(a);
    }
    const { team } = currentTeam(ctx, c, write ? "admin" : "member");
    if (path.startsWith("/api/v1/studio/projects/")) {
      const p = kiln.planning.project(c.req.param("id")!);
      if (!p || kiln.planning.projectTeam(p) !== team.id) throw new HttpError(404, `unknown project ${c.req.param("id")}`);
      return { team: team.id, projectId: p.id };
    }
    return { team: team.id };
  };

  /** App policies (ship mode caps, default-branch pushes, the merge gate) are changed by team owners and admins only. */
  const policyEditor = (c: Context<Env>, t: DefinitionTarget, change: Parameters<typeof defs.policyChanges>[1]) => {
    if (t.appId && defs.policyChanges(t, change).length) currentTeam(ctx, c, "admin");
  };

  /** Saves a layer; an invalid tree answers 400 with each error as `file:line: message`. */
  const write = (c: Context<Env>, fn: () => { sha: string; changed: boolean }) => {
    try {
      return c.json(fn());
    } catch (err) {
      if (err instanceof AppDefinitionError) return c.json({ error: err.message, errors: err.errors }, 400);
      if (err instanceof StudioError && err.code === "not_found") throw new HttpError(404, err.message);
      throw err;
    }
  };

  for (const s of SCOPES) {
    const base = `/api/v1/studio/${s.replace("{id}", ":id")}`;
    app.get(`${base}/definition`, (c) => {
      const { sha, tree, history } = defs.layer(target(c, false));
      return c.json({ ...(sha ? { sha } : {}), tree, history });
    });
    app.put(`${base}/definition`, async (c) => {
      const t = target(c, true);
      const body = PutDefinition.parse(await c.req.json());
      policyEditor(c, t, { tree: body.tree });
      return write(c, () => defs.save(t, body.tree, ctx.who(c), body.message));
    });
    app.patch(`${base}/definition`, async (c) => {
      const t = target(c, true);
      const body = AppSettingsPatch.parse(await c.req.json());
      policyEditor(c, t, { patch: body });
      return write(c, () => defs.edit(t, body, ctx.who(c)));
    });
    app.post(`${base}/definition/use`, async (c) => {
      const t = target(c, true);
      const body = UseDefinition.parse(await c.req.json());
      if (defs.layer(t).history.some((h) => h.sha === body.sha)) policyEditor(c, t, { sha: body.sha });
      return write(c, () => defs.use(t, body.sha, ctx.who(c)));
    });
    app.get(`${base}/settings`, (c) => c.json(defs.settings(target(c, false))));
  }
  app.get("/api/v1/studio/apps/:id/definition/export", (c) => {
    const t = target(c, false);
    const resolved = c.req.query("resolved") !== "false";
    return c.json({ sha: resolved ? defs.resolve(t).sha : defs.layer(t).sha, tree: defs.export(t, { resolved }) });
  });
}
